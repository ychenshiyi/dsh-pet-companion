"""语音对话记录：把用户/宠物的最终文本追加到 JSONL，供「语音对话框」窗口轮询。

只记文本，不记音频；文件路径由 app 主进程通过 DSH_PET_TRANSCRIPT_FILE 指定。
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path


def append(role: str, text: str) -> None:
    file = os.environ.get("DSH_PET_TRANSCRIPT_FILE", "")
    clean = (text or "").strip()
    if not file or not clean or role not in ("user", "assistant"):
        return
    path = Path(file)
    path.parent.mkdir(parents=True, exist_ok=True)
    event = {"role": role, "text": clean, "ts": int(time.time() * 1000)}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
