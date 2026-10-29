"""与桌宠宿主共享的对话记忆（$DSH_PET_HOME/memory.json）。

结构由宿主半侧定义：
  { "<entry>": { "<petId>": { "messages": [ {role, content, ts, meme?} ] } } }
这里只读写 voice 目标那一桶；写盘用临时文件 + 原子替换，尽量与宿主并发写兼容。
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path


class MemoryStore:
    def __init__(self) -> None:
        # 没配路径时 Path("") 会解析成当前目录，一写盘就是 IsADirectoryError —— 必须视为未启用。
        raw = os.environ.get("DSH_PET_MEMORY_FILE", "").strip()
        self.file: Path | None = Path(raw) if raw else None
        self.entry = os.environ.get("DSH_PET_MEMORY_ENTRY", "main")
        self.pet = os.environ.get("DSH_PET_MEMORY_PET", "main")
        self.rounds = int(os.environ.get("DSH_PET_MEMORY_ROUNDS", "10") or 10)
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.file is not None

    def _read(self) -> dict:
        if self.file is None or not self.file.exists():
            return {}
        try:
            raw = json.loads(self.file.read_text(encoding="utf-8"))
            return raw if isinstance(raw, dict) else {}
        except Exception:
            return {}

    def _write(self, data: dict) -> None:
        if self.file is None:
            return
        self.file.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix="memory.", suffix=".tmp", dir=str(self.file.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
            os.replace(temp, self.file)
        finally:
            with contextlib.suppress(OSError):
                os.unlink(temp)

    def load(self) -> list[dict]:
        """返回最近 rounds*2 条消息（旧→新）。"""
        if not self.enabled:
            return []
        with self._lock:
            data = self._read()
        try:
            messages = data[self.entry][self.pet]["messages"]
        except Exception:
            return []
        if not isinstance(messages, list):
            return []
        limit = max(0, self.rounds) * 2
        return (
            [m for m in messages if isinstance(m, dict) and m.get("role") in ("user", "assistant")][-limit:]
            if limit
            else []
        )

    def load_summary(self) -> str:
        """读取与文本宿主共用的压缩摘要；没有就返回空串。"""
        if not self.enabled:
            return ""
        with self._lock:
            data = self._read()
        try:
            context = data[self.entry][self.pet].get("context")
            summary = context.get("summary") if isinstance(context, dict) else ""
            return summary.strip() if isinstance(summary, str) else ""
        except Exception:
            return ""

    def append(self, role: str, text: str) -> None:
        if not self.enabled or not text.strip() or role not in ("user", "assistant"):
            return
        with self._lock:
            data = self._read()
            bucket = data.setdefault(self.entry, {}).setdefault(self.pet, {}).setdefault("messages", [])
            if not isinstance(bucket, list):
                bucket = data[self.entry][self.pet]["messages"] = []
            bucket.append({"role": role, "content": text, "ts": int(time.time() * 1000)})
            self._write(data)
