"""本机语音试听：Edge TTS / MeloTTS → WAV 写入 stdout。

由独立应用的 /companion/voice/preview 调用一次一个进程；不依赖 LiveKit。
用法：python -m agent.preview '<json>'
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np

from .audio_utils import decode_to_pcm

ROOT = Path(__file__).resolve().parent.parent


def write_wav(pcm: bytes, sample_rate: int) -> None:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    sys.stdout.buffer.write(buffer.getvalue())
    sys.stdout.buffer.flush()


async def edge_pcm(text: str, voice: str, rate: str, pitch: str, volume: str) -> tuple[bytes, int]:
    import edge_tts

    chunks: list[bytes] = []
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume).stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    if not chunks:
        raise RuntimeError("Edge TTS 没有返回音频")
    return decode_to_pcm(b"".join(chunks), 24000, 1), 24000


def melo_pcm(text: str, model_dir: str, speed: float) -> tuple[bytes, int]:
    import sherpa_onnx as s

    directory = Path(model_dir)
    model = directory / "model.onnx"
    if not model.exists():
        raise RuntimeError(f"MeloTTS 模型缺失：{model}（先下载 vits-melo-tts-zh_en）")
    config = s.OfflineTtsConfig(
        model=s.OfflineTtsModelConfig(
            vits=s.OfflineTtsVitsModelConfig(
                model=str(model),
                lexicon=str(directory / "lexicon.txt"),
                tokens=str(directory / "tokens.txt"),
                data_dir=str(directory / "dict"),
            ),
            num_threads=2,
        ),
        max_num_sentences=1,
    )
    tts = s.OfflineTts(config)
    audio = tts.generate(text, sid=0, speed=speed)
    samples = np.clip(np.asarray(audio.samples, dtype=np.float32), -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16).tobytes()
    return pcm, int(audio.sample_rate)


async def main(raw: str) -> None:
    options = json.loads(raw)
    engine = str(options.get("engine") or "edge")
    text = str(options.get("text") or "").strip()
    if not text:
        raise RuntimeError("试听文本为空")
    if engine == "melo":
        model_dir = str(options.get("meloDir") or os.environ.get("MELO_MODEL_DIR") or ROOT / "models" / "melo-tts")
        pcm, rate = melo_pcm(text, model_dir, float(options.get("speed") or 1.0))
    else:
        pcm, rate = await edge_pcm(
            text,
            str(options.get("voice") or "zh-CN-XiaoxiaoNeural"),
            str(options.get("rate") or "+0%"),
            str(options.get("pitch") or "+0Hz"),
            str(options.get("volume") or "+0%"),
        )
    write_wav(pcm, rate)


if __name__ == "__main__":
    try:
        asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "{}"))
    except Exception as error:  # noqa: BLE001 - 进程边界只回错误文本
        sys.stderr.write(str(error))
        raise SystemExit(1) from None
