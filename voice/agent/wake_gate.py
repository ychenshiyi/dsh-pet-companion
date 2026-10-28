"""语音唤醒门：超过空闲时间后，必须说唤醒词才进入对话。

放在 STT 之后、Agent 之前：非唤醒词直接丢成空转写，AgentSession 不会生成回复。
"""

from __future__ import annotations

import os
import time


class WakeGate:
    def __init__(self, wake_word: str | None = None, idle_seconds: float | None = None) -> None:
        self.wake_word = (wake_word or os.environ.get("WAKE_WORD") or "小鱼").strip() or "小鱼"
        try:
            self.idle_seconds = float(
                idle_seconds if idle_seconds is not None else os.environ.get("WAKE_IDLE_SECONDS", "10")
            )
        except ValueError:
            self.idle_seconds = 10.0
        self._last_activity = time.monotonic()
        self._awake = True

    @property
    def awake(self) -> bool:
        if self._awake and time.monotonic() - self._last_activity > self.idle_seconds:
            self._awake = False
        return self._awake

    def reset(self) -> None:
        self._awake = True
        self._last_activity = time.monotonic()

    def filter(self, text: str) -> str:
        """返回空串 = 这句不进入对话；返回原文 = 正常/已唤醒。"""
        clean = (text or "").strip()
        if not clean:
            return ""
        now = time.monotonic()
        if self._awake and now - self._last_activity > self.idle_seconds:
            self._awake = False
        if not self._awake:
            if self.wake_word in clean:
                self._awake = True
                self._last_activity = now
                return clean
            return ""
        self._last_activity = now
        return clean
