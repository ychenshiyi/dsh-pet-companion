"""emotion：语音侧关系状态（好感/信任/心情/情节）的启发式更新与持久化。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent.emotion import (
    MOOD_LABEL,
    EmotionStore,
    apply_turn,
    default_state,
    prompt,
)


def test_default_state_shape() -> None:
    state = default_state()
    assert state["affection"] == 20
    assert state["trust"] == 15
    assert state["mood"] == "calm"
    assert state["turns"] == 0
    assert state["episodes"] == [] and state["facts"] == []


def test_positive_turn_raises_affection_and_trust() -> None:
    state = apply_turn(default_state(), "我很喜欢你", "我也喜欢你")
    assert state["affection"] == 22
    assert state["trust"] == 16
    assert state["familiarity"] == 11
    assert state["energy"] == 79
    assert state["turns"] == 1
    assert state["mood"] == "happy"


def test_negative_turn_lowers_affection() -> None:
    state = apply_turn(default_state(), "今天好累，有点难过", "抱抱")
    assert state["affection"] == 17
    assert state["trust"] == 13
    assert state["energy"] == 77
    assert state["mood"] == "sad"


def test_anger_is_stronger_than_sadness() -> None:
    state = apply_turn(default_state(), "闭嘴，别烦我", "……")
    assert state["mood"] == "angry"
    assert state["userMood"] == "angry"


def test_values_are_clamped_to_0_100() -> None:
    high = {**default_state(), "affection": 100, "trust": 100, "familiarity": 100, "energy": 100}
    state = apply_turn(high, "喜欢你", "嗯")
    assert state["affection"] == 100
    assert state["trust"] == 100
    assert state["familiarity"] == 100

    low = {**default_state(), "affection": 1, "trust": 0}
    state = apply_turn(low, "讨厌，滚", "…")
    assert state["affection"] == 0
    assert state["trust"] == 0


def test_low_energy_forces_tired_mood() -> None:
    # 精力 22 → 21，还没到阈值，情绪仍按"被夸"走 happy
    state = apply_turn({**default_state(), "energy": 22}, "喜欢你", "嗯")
    assert state["energy"] == 21
    assert state["mood"] == "happy"
    # 精力 21 → 20 触发疲惫，且优先于 happy
    state = apply_turn({**default_state(), "energy": 21}, "喜欢你", "嗯")
    assert state["mood"] == "tired"


def test_high_affection_and_trust_makes_happy() -> None:
    state = apply_turn({**default_state(), "affection": 69, "trust": 54}, "嗯", "嗯")
    assert state["affection"] == 69 and state["trust"] == 54
    state = apply_turn({**default_state(), "affection": 70, "trust": 56}, "嗯", "嗯")
    assert state["mood"] == "happy"


def test_partial_affection_with_low_trust_is_shy() -> None:
    state = apply_turn({**default_state(), "affection": 50, "trust": 20}, "嗯", "嗯")
    assert state["mood"] == "shy"


def test_acoustic_tag_overrides_text_heuristic() -> None:
    state = apply_turn(default_state(), "我没事", "", user_emotion="<|SAD|>")
    assert state["userMood"] == "sad"
    assert state["mood"] == "calm"


@pytest.mark.parametrize(
    ("tag", "expected"),
    [
        ("<|HAPPY|>", "happy"),
        ("<|ANGRY|>", "angry"),
        ("<|NEUTRAL|>", "calm"),
        ("<|FEARFUL|>", "sad"),
        ("<|SURPRISED|>", "happy"),
        ("<|WHATEVER|>", "calm"),
    ],
)
def test_acoustic_tag_mapping(tag: str, expected: str) -> None:
    assert apply_turn(default_state(), "嗯", "", user_emotion=tag)["userMood"] == expected


def test_short_neutral_line_creates_no_episode() -> None:
    assert apply_turn(default_state(), "嗯", "嗯")["episodes"] == []


def test_important_line_creates_weighted_episode() -> None:
    state = apply_turn(default_state(), "我喜欢你", "嗯")
    assert len(state["episodes"]) == 1
    episode = state["episodes"][0]
    assert episode["weight"] == 2
    assert episode["summary"] == "我喜欢你"
    assert episode["emotion"] == "happy"


def test_long_line_creates_episode_with_ellipsis() -> None:
    text = "今天" * 50  # 100 字，摘要截断到 80 字 + 省略号
    episode = apply_turn(default_state(), text, "嗯")["episodes"][0]
    assert episode["summary"].endswith("…")
    assert len(episode["summary"]) == 81


def test_episodes_are_capped_at_120() -> None:
    full = {
        **default_state(),
        "episodes": [{"ts": 0, "summary": f"旧{i}", "emotion": "calm", "weight": 1} for i in range(120)],
    }
    state = apply_turn(full, "我喜欢你", "嗯")
    assert len(state["episodes"]) == 120
    assert state["episodes"][-1]["summary"] == "我喜欢你"


def test_prompt_mentions_relationship_and_facts() -> None:
    state = {**default_state(), "affection": 42, "mood": "happy"}
    state["facts"] = [{"text": "喜欢喝冰美式"}, {"text": "生日是 3 月 8 日"}]
    text = prompt(state)
    assert "好感 42/100" in text
    assert MOOD_LABEL["happy"] in text
    assert "喜欢喝冰美式" in text and "生日是 3 月 8 日" in text


def test_prompt_without_facts_has_no_fact_section() -> None:
    assert "【已知事实】" not in prompt(default_state())


# ── EmotionStore ──────────────────────────────────────────────────────────


def test_store_is_disabled_without_file_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DSH_PET_EMOTION_FILE", raising=False)
    monkeypatch.chdir(tmp_path)  # 若实现错误会往 cwd 写文件，这里能抓到
    store = EmotionStore()
    assert store.enabled is False
    assert store.read() == default_state()
    assert store.apply("我喜欢你", "嗯") == default_state()
    assert list(tmp_path.iterdir()) == []  # 没有偷偷落盘


def test_store_is_disabled_by_switch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "emotion.json"
    monkeypatch.setenv("DSH_PET_EMOTION_FILE", str(target))
    monkeypatch.setenv("DSH_PET_EMOTION_ENABLED", "0")
    store = EmotionStore()
    assert store.enabled is False
    store.apply("我喜欢你", "嗯")
    assert not target.exists()


def test_store_roundtrip_persists_per_entry_and_pet(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "sub" / "emotion.json"
    monkeypatch.setenv("DSH_PET_EMOTION_FILE", str(target))
    monkeypatch.delenv("DSH_PET_EMOTION_ENABLED", raising=False)
    store = EmotionStore()
    state = store.apply("我很喜欢你", "嗯")
    assert state["affection"] == 22

    on_disk = json.loads(target.read_text(encoding="utf-8"))
    assert on_disk["main"]["main"]["affection"] == 22

    reloaded = EmotionStore().read()
    assert reloaded["affection"] == 22
    assert reloaded["turns"] == 1


def test_store_ignores_broken_json(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "emotion.json"
    target.write_text("{ 这不是 json", encoding="utf-8")
    monkeypatch.setenv("DSH_PET_EMOTION_FILE", str(target))
    assert EmotionStore().read() == default_state()


def test_store_skips_blank_text(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "emotion.json"
    monkeypatch.setenv("DSH_PET_EMOTION_FILE", str(target))
    store = EmotionStore()
    assert store.apply("   ", "嗯") == default_state()
    assert not target.exists()


def test_store_uses_other_pet_bucket(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "emotion.json"
    monkeypatch.setenv("DSH_PET_EMOTION_FILE", str(target))
    monkeypatch.setenv("DSH_PET_EMOTION_PET", "second")
    store = EmotionStore()
    store.apply("我喜欢你", "嗯")
    on_disk = json.loads(target.read_text(encoding="utf-8"))
    assert "second" in on_disk["main"]
    assert EmotionStore().read()["affection"] == 22
