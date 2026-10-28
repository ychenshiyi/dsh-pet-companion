"""情绪 → 语音韵律：纯函数，方便单测。

Edge 用 rate/pitch 百分比与 Hz；Melo 只有 speed，用倍率表达。
基准值来自设置页，情绪偏移叠加在基准上，强度 1.0 为默认。
"""

from __future__ import annotations

import re

MOOD_PROSODY: dict[str, tuple[int, int, float]] = {
    # mood: (rate 百分比偏移, pitch Hz 偏移, Melo speed 倍率)
    "happy": (6, 3, 1.08),
    "shy": (-4, 1, 0.96),
    "sad": (-8, -3, 0.90),
    "angry": (5, 2, 1.05),
    "tired": (-10, -4, 0.85),
    "calm": (0, 0, 1.0),
}

_PERCENT = re.compile(r"^([+-]?\d+)%$")
_HZ = re.compile(r"^([+-]?\d+)Hz$")


def parse_percent(value: str, default: int = 0) -> int:
    match = _PERCENT.match((value or "").strip())
    return int(match.group(1)) if match else default


def parse_hz(value: str, default: int = 0) -> int:
    match = _HZ.match((value or "").strip())
    return int(match.group(1)) if match else default


def _signed(value: int, suffix: str) -> str:
    return f"{value:+d}{suffix}"


def edge_prosody(
    base_rate: str,
    base_pitch: str,
    mood: str,
    intensity: float = 1.0,
) -> tuple[str, str]:
    """返回 (rate, pitch)，格式与 Edge TTS 一致。"""
    delta_rate, delta_pitch, _ = MOOD_PROSODY.get(mood, MOOD_PROSODY["calm"])
    rate = parse_percent(base_rate) + round(delta_rate * intensity)
    pitch = parse_hz(base_pitch) + round(delta_pitch * intensity)
    return _signed(rate, "%"), _signed(pitch, "Hz")


def melo_speed(base_rate: str, mood: str, intensity: float = 1.0) -> float:
    _, _, factor = MOOD_PROSODY.get(mood, MOOD_PROSODY["calm"])
    base = 1.0 + parse_percent(base_rate) / 100.0
    # 强度 1.0 用满偏移，0 回到基准；限制在引擎可接受范围
    speed = base * (1.0 + (factor - 1.0) * intensity)
    return max(0.7, min(1.3, round(speed, 3)))
