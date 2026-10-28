"""prosody：情绪 → Edge rate/pitch 与 MeloTTS speed 的纯函数映射。"""

from __future__ import annotations

import pytest

from agent.prosody import MOOD_PROSODY, edge_prosody, melo_speed, parse_hz, parse_percent


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("+6%", 6), ("-8%", -8), ("0%", 0), ("+0%", 0), ("  +12%  ", 12)],
)
def test_parse_percent_valid(raw: str, expected: int) -> None:
    assert parse_percent(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "6", "6 %", "+6px", "abc"])
def test_parse_percent_invalid_uses_default(raw: str | None) -> None:
    assert parse_percent(raw, default=-3) == -3


@pytest.mark.parametrize(("raw", "expected"), [("+3Hz", 3), ("-4Hz", -4), ("0Hz", 0), (" +10Hz ", 10)])
def test_parse_hz_valid(raw: str, expected: int) -> None:
    assert parse_hz(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "3", "+3hz", "Hz"])
def test_parse_hz_invalid_uses_default(raw: str | None) -> None:
    assert parse_hz(raw, default=7) == 7


@pytest.mark.parametrize(
    ("mood", "want"),
    [("happy", ("+6%", "+3Hz")), ("sad", ("-8%", "-3Hz")), ("tired", ("-10%", "-4Hz")), ("calm", ("+0%", "+0Hz"))],
)
def test_edge_prosody_presets(mood: str, want: tuple[str, str]) -> None:
    assert edge_prosody("+0%", "+0Hz", mood) == want


def test_edge_prosody_stacks_on_base_values() -> None:
    # 基准语速 +10%、音调 -2Hz 之上再叠加 happy 的偏移
    assert edge_prosody("+10%", "-2Hz", "happy") == ("+16%", "+1Hz")


def test_edge_prosody_intensity_scales_offset() -> None:
    # happy: rate +6 * 0.5 = +3，pitch +3 * 0.5 = +1.5 → round() 取 2
    assert edge_prosody("+0%", "+0Hz", "happy", intensity=0.5) == ("+3%", "+2Hz")


def test_edge_prosody_zero_intensity_returns_base() -> None:
    assert edge_prosody("+4%", "+2Hz", "tired", intensity=0) == ("+4%", "+2Hz")


def test_edge_prosody_unknown_mood_behaves_like_calm() -> None:
    assert edge_prosody("+1%", "+1Hz", "excited") == ("+1%", "+1Hz")


def test_melo_speed_presets() -> None:
    assert melo_speed("+0%", "calm") == 1.0
    assert melo_speed("+0%", "happy") == 1.08
    assert melo_speed("+0%", "sad") == 0.9


def test_melo_speed_respects_base_rate() -> None:
    # 基准 +20% → 1.2 倍，再叠加 happy 的 1.08
    assert melo_speed("+20%", "happy") == pytest.approx(1.296, abs=1e-3)


def test_melo_speed_clamps_into_engine_range() -> None:
    assert melo_speed("-50%", "tired") == 0.7
    assert melo_speed("+50%", "happy") == 1.3


def test_melo_speed_zero_intensity_is_base() -> None:
    assert melo_speed("+10%", "tired", intensity=0) == pytest.approx(1.1)


def test_all_preset_moods_are_callable() -> None:
    for mood in MOOD_PROSODY:
        rate, pitch = edge_prosody("+0%", "+0Hz", mood)
        assert rate.endswith("%") and pitch.endswith("Hz")
        assert 0.7 <= melo_speed("+0%", mood) <= 1.3
