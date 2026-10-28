"""语音侧情感状态：与宿主共用 emotion.json（只做轻量启发式，不调用 LLM）。"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import time
from pathlib import Path

MOOD_LABEL = {
    "happy": "开心",
    "calm": "平静",
    "shy": "有点害羞",
    "sad": "低落",
    "angry": "有点生气",
    "tired": "疲惫",
}

POSITIVE = ["喜欢", "爱", "谢谢", "开心", "高兴", "可爱", "厉害", "棒", "好耶", "抱抱", "亲亲", "想你", "辛苦了"]
NEGATIVE = ["讨厌", "滚", "烦", "生气", "难过", "伤心", "哭", "累", "分手", "别烦", "闭嘴", "失望"]
ANGER = ["滚", "烦", "生气", "闭嘴", "讨厌你"]


def _clamp(value: float) -> int:
    return max(0, min(100, round(value)))


def default_state() -> dict:
    return {
        "affection": 20,
        "trust": 15,
        "familiarity": 10,
        "energy": 80,
        "mood": "calm",
        "userMood": "calm",
        "turns": 0,
        "episodes": [],
        "facts": [],
        "insights": [],
        "updatedAt": 0,
    }


def _hits(text: str, words: list[str]) -> int:
    return sum(1 for word in words if word in text)


def apply_turn(state: dict, user_text: str, reply_text: str, user_emotion: str | None = None) -> dict:
    text = user_text.strip()
    positive = _hits(text, POSITIVE)
    negative = _hits(text, NEGATIVE)
    angry = _hits(text, ANGER) > 0
    next_state = dict(state)
    next_state["affection"] = _clamp(state["affection"] + (2 if positive else 0) - (3 if negative else 0))
    next_state["trust"] = _clamp(state["trust"] + (1 if positive else 0) - (2 if negative else 0))
    next_state["familiarity"] = _clamp(state["familiarity"] + 1)
    next_state["energy"] = _clamp(state["energy"] - (3 if negative else 1))
    next_state["turns"] = int(state.get("turns", 0)) + 1
    next_state["updatedAt"] = int(time.time() * 1000)
    if next_state["energy"] <= 20:
        mood = "tired"
    elif angry:
        mood = "angry"
    elif negative:
        mood = "sad"
    elif next_state["affection"] >= 70 and next_state["trust"] >= 55:
        mood = "happy"
    elif next_state["affection"] >= 45 and next_state["trust"] < 35:
        mood = "shy"
    elif positive:
        mood = "happy"
    else:
        mood = "calm"
    next_state["mood"] = mood
    tag = (user_emotion or "").upper()
    acoustic = {
        "<|HAPPY|>": "happy",
        "<|SAD|>": "sad",
        "<|ANGRY|>": "angry",
        "<|NEUTRAL|>": "calm",
        "<|FEARFUL|>": "sad",
        "<|SURPRISED|>": "happy",
    }.get(tag)
    next_state["userMood"] = acoustic or ("angry" if angry else "sad" if negative else "happy" if positive else "calm")

    important = (
        len(text) >= 20
        or positive
        or negative
        or any(word in text for word in ("生日", "名字", "喜欢", "讨厌", "分手", "工作", "学校"))
    )
    if important and text:
        episodes = list(state.get("episodes", []))
        episodes.append(
            {
                "ts": int(time.time() * 1000),
                "summary": text[:80] + ("…" if len(text) > 80 else ""),
                "emotion": mood,
                "weight": 2 if (positive or negative) else 1,
            }
        )
        next_state["episodes"] = episodes[-120:]
    next_state["facts"] = list(state.get("facts", []))
    next_state["insights"] = list(state.get("insights", []))
    void = reply_text  # 回复只用于调用方记录，不参与打分
    _ = void
    return next_state


def prompt(state: dict) -> str:
    facts = [fact["text"] for fact in state.get("facts", [])[-5:]]
    lines = [
        "【关系状态】",
        f"好感 {state['affection']}/100，信任 {state['trust']}/100，熟悉 {state['familiarity']}/100，"
        f"精力 {state['energy']}/100，当前心情：{MOOD_LABEL.get(state['mood'], state['mood'])}。",
        "请自然体现这层关系：熟悉度低时礼貌一点；好感/信任高时更亲近；心情低落或疲惫时不要强行活泼。",
    ]
    if facts:
        lines.append("【已知事实】" + "；".join(facts))
    return "\n".join(lines)


class EmotionStore:
    def __init__(self) -> None:
        # 没配路径时 Path("") 会解析成当前目录，进而把状态写进 cwd —— 必须显式关掉。
        raw = os.environ.get("DSH_PET_EMOTION_FILE", "").strip()
        self.file: Path | None = Path(raw) if raw else None
        self.enabled = self.file is not None and os.environ.get("DSH_PET_EMOTION_ENABLED", "1") != "0"
        self.entry = os.environ.get("DSH_PET_EMOTION_ENTRY", "main")
        self.pet = os.environ.get("DSH_PET_EMOTION_PET", "main")

    def _read_all(self) -> dict:
        if not self.enabled or self.file is None or not self.file.exists():
            return {}
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _write_all(self, data: dict) -> None:
        if self.file is None:
            return
        self.file.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix="emotion.", suffix=".tmp", dir=str(self.file.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
            os.replace(temp, self.file)
        finally:
            with contextlib.suppress(OSError):
                os.unlink(temp)

    def read(self) -> dict:
        data = self._read_all()
        return {**default_state(), **(data.get(self.entry, {}).get(self.pet, {}))}

    def apply(self, user_text: str, reply_text: str, user_emotion: str | None = None) -> dict:
        if not self.enabled or not user_text.strip():
            return self.read()
        data = self._read_all()
        bucket = data.setdefault(self.entry, {})
        current = {**default_state(), **bucket.get(self.pet, {})}
        next_state = apply_turn(current, user_text, reply_text, user_emotion)
        bucket[self.pet] = next_state
        self._write_all(data)
        return next_state
