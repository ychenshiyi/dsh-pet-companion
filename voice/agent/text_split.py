"""把一句回复切成适合逐段合成的短句，降低首包延迟。"""

from __future__ import annotations

import re

_SPLIT = re.compile(r"(?<=[。！？!?；;，,])")


def split_tts_text(text: str, max_len: int = 28, max_segments: int = 4) -> list[str]:
    clean = (text or "").strip()
    if not clean:
        return []
    parts = [part for part in _SPLIT.split(clean) if part]
    merged: list[str] = []
    for part in parts:
        if merged and len(merged[-1]) + len(part) <= max_len and len(merged[-1]) < 6:
            merged[-1] += part
        else:
            merged.append(part)
    # 超长段再按 max_len 硬切，避免单段合成太久
    chunks: list[str] = []
    for part in merged:
        while len(part) > max_len:
            chunks.append(part[:max_len])
            part = part[max_len:]
        if part:
            chunks.append(part)
    if len(chunks) > max_segments:
        # 合并尾部，避免一句话开太多次连接
        head = chunks[: max_segments - 1]
        head.append("".join(chunks[max_segments - 1 :]))
        chunks = head
    return chunks
