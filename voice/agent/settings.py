"""Agent 运行配置：环境变量 / agent/.env / livekit.yaml / DSH 凭据回落。"""

from __future__ import annotations

import os
import re
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent
ROOT = AGENT_DIR.parent  # livekit/


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_dotenv(AGENT_DIR / ".env")


def _livekit_keys() -> tuple[str, str]:
    """从 livekit.yaml 的 keys 段取第一对 API key/secret（与 tools/jwt.mjs 同口径）。"""
    path = Path(os.environ.get("LIVEKIT_CONFIG", ROOT / "livekit.yaml"))
    text = path.read_text(encoding="utf-8")
    in_keys = False
    for line in text.splitlines():
        if re.match(r"^keys:\s*$", line):
            in_keys = True
            continue
        if not in_keys:
            continue
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^\s{2}([A-Za-z0-9]+):\s*(\S+)\s*$", line)
        if match:
            return match.group(1), match.group(2)
        if not line.startswith(" "):
            break
    raise RuntimeError(f"livekit.yaml 里没有找到 keys：{path}")


def _deepseek_key_from_dsh() -> str | None:
    """本机 DSH 的凭据文件里通常已经存了 DeepSeek key，直接复用免得再填一遍。"""
    path = Path.home() / ".dsh" / ".credentials.yaml"
    if not path.exists():
        return None
    match = re.search(r"^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$", path.read_text(encoding="utf-8"), re.M)
    return match.group(1) if match else None


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    return value.strip() if isinstance(value, str) else value


LIVEKIT_URL = _env("LIVEKIT_URL", "ws://127.0.0.1:7880")
if _env("LIVEKIT_API_KEY") and _env("LIVEKIT_API_SECRET"):
    LIVEKIT_API_KEY = _env("LIVEKIT_API_KEY") or ""
    LIVEKIT_API_SECRET = _env("LIVEKIT_API_SECRET") or ""
else:
    LIVEKIT_API_KEY, LIVEKIT_API_SECRET = _livekit_keys()

DEEPSEEK_API_KEY = _env("DEEPSEEK_API_KEY") or _deepseek_key_from_dsh() or ""
DEEPSEEK_BASE_URL = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = _env("DEEPSEEK_MODEL", "deepseek-chat")

SENSEVOICE_MODEL = _env("SENSEVOICE_MODEL", str(ROOT / "models" / "sense-voice" / "model.int8.onnx"))
SENSEVOICE_TOKENS = _env("SENSEVOICE_TOKENS", str(ROOT / "models" / "sense-voice" / "tokens.txt"))
STT_LANGUAGE = _env("STT_LANGUAGE", "zh")

EDGE_VOICE = _env("EDGE_TTS_VOICE", "zh-CN-XiaoxiaoNeural")
EDGE_RATE = _env("EDGE_TTS_RATE", "+0%")
EDGE_VOLUME = _env("EDGE_TTS_VOLUME", "+0%")
EDGE_PITCH = _env("EDGE_TTS_PITCH", "+0Hz")

# 语音合成引擎：edge（默认，在线）/ melo（sherpa-onnx 本地离线）
TTS_ENGINE = _env("TTS_ENGINE", "edge")
MELO_MODEL_DIR = _env("MELO_MODEL_DIR", str(ROOT / "models" / "melo-tts"))

# 情感状态（与宿主共用 emotion.json；关闭时不影响对话）
EMOTION_FILE = _env("DSH_PET_EMOTION_FILE", "")
EMOTION_ENABLED = _env("DSH_PET_EMOTION_ENABLED", "1") != "0"

PET_NAME = _env("PET_NAME", "小鱼")
PET_PERSONA = _env("PET_PERSONA", "")
