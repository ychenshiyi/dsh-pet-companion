"""wake_gate：空闲后必须叫唤醒词，防止常开麦克风一直把对话送进模型。"""

from __future__ import annotations

import pytest

from agent import wake_gate


class FakeClock:
    """可手动推进的单调时钟，避免测试里 sleep。"""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture()
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    fake = FakeClock()
    monkeypatch.setattr(wake_gate.time, "monotonic", fake.monotonic)
    monkeypatch.delenv("WAKE_WORD", raising=False)
    monkeypatch.delenv("WAKE_IDLE_SECONDS", raising=False)
    return fake


def test_default_wake_word_is_xiaoyu(clock: FakeClock) -> None:
    assert wake_gate.WakeGate().wake_word == "小鱼"


def test_env_overrides_wake_word(clock: FakeClock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WAKE_WORD", " 阿七 ")
    assert wake_gate.WakeGate().wake_word == "阿七"


def test_explicit_arg_beats_env(clock: FakeClock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WAKE_WORD", "阿七")
    assert wake_gate.WakeGate(wake_word="小满").wake_word == "小满"


def test_blank_wake_word_falls_back(clock: FakeClock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WAKE_WORD", "   ")
    assert wake_gate.WakeGate().wake_word == "小鱼"


def test_invalid_idle_seconds_falls_back_to_10(clock: FakeClock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WAKE_IDLE_SECONDS", "not-a-number")
    assert wake_gate.WakeGate().idle_seconds == 10.0


def test_starts_awake(clock: FakeClock) -> None:
    assert wake_gate.WakeGate().awake is True


def test_empty_transcript_is_dropped(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate()
    assert gate.filter("") == ""
    assert gate.filter("   ") == ""


def test_awake_gate_passes_text_and_refreshes_activity(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate(idle_seconds=10)
    assert gate.filter("今天吃什么") == "今天吃什么"
    clock.advance(9)
    assert gate.awake is True  # 刚才说过话，还没到空闲阈值
    assert gate.filter("随便") == "随便"


def test_sleeps_after_idle_and_drops_normal_speech(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate(idle_seconds=10)
    gate.filter("你好")
    clock.advance(11)
    assert gate.awake is False
    assert gate.filter("今天天气不错") == ""


def test_wake_word_raises_the_gate(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate(idle_seconds=10)
    gate.filter("你好")
    clock.advance(11)
    clock.advance(0)
    assert gate.filter("小鱼，我们聊天吧") == "小鱼，我们聊天吧"
    assert gate.awake is True
    assert gate.filter("继续") == "继续"  # 醒了以后就不需要再叫


def test_reset_wakes_immediately(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate(idle_seconds=10)
    gate.filter("你好")
    clock.advance(11)
    assert gate.awake is False
    gate.reset()
    assert gate.awake is True
    assert gate.filter("在吗") == "在吗"


def test_custom_wake_word(clock: FakeClock) -> None:
    gate = wake_gate.WakeGate(wake_word="小满", idle_seconds=5)
    gate.filter("你好")
    clock.advance(6)
    assert gate.filter("小鱼") == ""  # 叫错名字不唤醒
    assert gate.filter("小满在吗") == "小满在吗"
