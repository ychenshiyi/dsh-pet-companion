"""生成用于自动化验证的测试语音（中文问题），输出 48k 单声道 WAV。

用法：python -m agent.make_test_wav dev/public/test-question.wav
"""

from __future__ import annotations

import asyncio
import sys
import wave

import edge_tts

from .audio_utils import decode_to_pcm

TEXT = "小鱼你好，今天心情怎么样？用一句话回答我就好。祝你能天天开心。"


async def main(out_path: str) -> None:
    chunks: list[bytes] = []
    async for chunk in edge_tts.Communicate(TEXT, "zh-CN-XiaoxiaoNeural").stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    pcm = decode_to_pcm(b"".join(chunks), 48000, 1)
    with wave.open(out_path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48000)
        wav.writeframes(pcm)
    print(f"wrote {out_path}: {len(pcm) / 2 / 48000:.1f}s")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "dev/public/test-question.wav"))
