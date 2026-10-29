"""语音 Agent 访问宿主 memory 的唯一通道。

宿主是 memory.json 的唯一写者；语音不再直接 append/改写文件，只通过本机 HTTP：
- POST /dsh-pet-7340/context     触发同一套上下文压缩
- GET  /dsh-pet-7340/memory/context  读摘要 + 最近原文
- POST /dsh-pet-7340/memory/append   追加一轮消息

宿主不可用时全部静默失败，语音退回只读 memory.py，不产生双写。
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request


def _base() -> str:
    return os.environ.get("DSH_PET_HOST_URL", "").rstrip("/")


def _token() -> str:
    return os.environ.get("DSH_PET_TOKEN", "")


def _request(method: str, path: str, payload: dict | None = None, timeout: float = 8.0) -> dict | None:
    base = _base()
    token = _token()
    if not base or not token:
        return None
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "content-type": "application/json",
            "x-dsh-pet-token": token,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
            return body if isinstance(body, dict) else None
    except Exception:
        return None


def _pet(pet_id: str) -> str:
    return urllib.parse.quote(pet_id or "main")


def compress(pet_id: str) -> str | None:
    body = _request("POST", f"/dsh-pet-7340/context?pet={_pet(pet_id)}", {})
    if not body or not body.get("ok"):
        return None
    summary = body.get("summary")
    return summary if isinstance(summary, str) and summary.strip() else None


def read_context(pet_id: str) -> dict | None:
    body = _request("GET", f"/dsh-pet-7340/memory/context?pet={_pet(pet_id)}")
    return body if body and body.get("ok") else None


def append(pet_id: str, role: str, text: str) -> bool:
    body = _request(
        "POST",
        f"/dsh-pet-7340/memory/append?pet={_pet(pet_id)}",
        {"role": role, "text": text},
        timeout=4.0,
    )
    return bool(body and body.get("ok"))


# 兼容旧调用名
compress_via_host = compress
