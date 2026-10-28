"""语音轮次用量（估算）：把每轮转写/回复按字符估算 token，追加到 usage.jsonl。

精确 token 需要 LiveKit LLM metrics；v1 先保证面板能看到语音消耗趋势。
"""

from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path


def record(pet_id: str, user_text: str, reply_text: str) -> None:
    file = os.environ.get("DSH_PET_USAGE_FILE", "")
    if not file:
        return
    path = Path(file)
    path.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": int(time.time() * 1000),
        "petId": pet_id,
        "surface": "voice",
        "inputTokens": max(1, math.ceil(len(user_text) / 4)),
        "outputTokens": max(1, math.ceil(len(reply_text) / 4)),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
