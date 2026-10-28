"""text_split：把回复切成适合逐段 TTS 的短句。"""

from __future__ import annotations

from agent.text_split import split_tts_text


def test_empty_input_returns_empty_list() -> None:
    assert split_tts_text("") == []
    assert split_tts_text("   \n\t ") == []
    assert split_tts_text(None) == []  # type: ignore[arg-type]


def test_single_sentence_passes_through() -> None:
    assert split_tts_text("你好呀") == ["你好呀"]


def test_short_clauses_are_merged() -> None:
    # 第一段只有 3 个字（< 6），合并后仍不超长，应并成一段
    assert split_tts_text("你好。今天天气不错。") == ["你好。今天天气不错。"]


def test_long_text_is_hard_split_by_max_len() -> None:
    chunks = split_tts_text("啊" * 60, max_len=28)
    assert chunks == ["啊" * 28, "啊" * 28, "啊" * 4]
    assert all(len(c) <= 28 for c in chunks)


def test_segments_are_capped_and_tail_is_merged() -> None:
    # 10 个 5 字短句，每段都够长不会互相合并 → 必须收敛到 max_segments 段
    text = "。".join(["第一句话"] * 10) + "。"
    chunks = split_tts_text(text, max_len=12, max_segments=4)
    assert len(chunks) == 4
    # 尾部合并后总字数不能丢
    assert sum(len(c) for c in chunks) == sum(len(c) for c in split_tts_text(text, max_len=12, max_segments=99))


def test_whitespace_is_stripped() -> None:
    assert split_tts_text("  你好。  ") == ["你好。"]


def test_punctuation_variants_all_split() -> None:
    for mark in ("。", "！", "？", "!", "?", "；", ";", "，", ","):
        chunks = split_tts_text(f"第一句{mark}第二句{mark}")
        assert all(mark in c or c for c in chunks)
        assert "".join(chunks) == f"第一句{mark}第二句{mark}"
