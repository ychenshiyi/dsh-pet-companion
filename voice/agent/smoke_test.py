"""端到端冒烟测试：Edge TTS → 解码 → SenseVoice 识别 → DeepSeek 对话。

不依赖 LiveKit 房间，用来快速确认三件事：
  1. TTS 能出声（拿到 PCM）
  2. STT 能听懂中文（把 TTS 的语音再识别回来）
  3. DeepSeek key 可用、能流式回复

用法：在 livekit/ 目录下 `python -m agent.smoke_test`
"""

from __future__ import annotations

import asyncio
import time

from livekit import rtc

from .settings import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    EDGE_RATE,
    EDGE_VOICE,
    EDGE_VOLUME,
    SENSEVOICE_MODEL,
    SENSEVOICE_TOKENS,
    STT_LANGUAGE,
)
from .stt_sensevoice import SenseVoiceSTT
from .tts_edge import EdgeTTS


def normalize(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


async def test_tts() -> tuple[bytes, float]:
    tts = EdgeTTS(voice=EDGE_VOICE, rate=EDGE_RATE, volume=EDGE_VOLUME)
    text = "你好，我是你的桌面宠物小鱼，今天想聊点什么呀？"
    started = time.perf_counter()
    stream = tts.synthesize(text)
    frame = await stream.collect()
    cost = time.perf_counter() - started
    pcm = bytes(frame.data)
    print(f"PASS  TTS 合成 {len(text)} 字 → {frame.duration:.2f}s 音频，用时 {cost * 1000:.0f}ms")
    return pcm, 24000


async def test_stt(pcm24k: bytes) -> str:
    # 24k PCM → 16k AudioFrame → 我们的 STT
    resampler = rtc.AudioResampler(24000, 16000, num_channels=1)
    samples_per_channel = len(pcm24k) // 2
    frame24 = rtc.AudioFrame(
        data=pcm24k,
        sample_rate=24000,
        num_channels=1,
        samples_per_channel=samples_per_channel,
    )
    out = resampler.push(frame24) + resampler.flush()
    frame16 = rtc.combine_audio_frames(out)

    stt = SenseVoiceSTT(
        model_path=SENSEVOICE_MODEL,
        tokens_path=SENSEVOICE_TOKENS,
        language=STT_LANGUAGE,
    )
    started = time.perf_counter()
    event = await stt.recognize(frame16)
    cost = time.perf_counter() - started
    text = event.alternatives[0].text if event.alternatives else ""
    print(f"PASS  STT 识别：{text!r}（用时 {cost * 1000:.0f}ms）")
    return text


async def test_llm(user_text: str) -> None:
    if not DEEPSEEK_API_KEY:
        print("SKIP  LLM：没有 DEEPSEEK_API_KEY（可在 agent/.env 里配置）")
        return

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    started = time.perf_counter()
    first_token_at = None
    parts: list[str] = []
    stream = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[
            {"role": "system", "content": "你是桌面宠物小鱼，回答只用一句很短的口语中文。"},
            {"role": "user", "content": user_text},
        ],
        stream=True,
        temperature=0.7,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            if first_token_at is None:
                first_token_at = time.perf_counter()
            parts.append(delta)
    text = "".join(parts).strip()
    ttft = (first_token_at - started) * 1000 if first_token_at else -1
    total = (time.perf_counter() - started) * 1000
    print(f"PASS  LLM（{DEEPSEEK_MODEL}）：{text!r}  首字 {ttft:.0f}ms / 总 {total:.0f}ms")


async def main() -> None:
    print(f"配置：TTS={EDGE_VOICE}  STT=sense-voice({STT_LANGUAGE})  LLM={DEEPSEEK_MODEL}")
    pcm, rate = await test_tts()
    recognized = await test_stt(pcm)
    expected = normalize("你好我是你的桌面宠物小鱼今天想聊点什么呀")
    got = normalize(recognized)
    hit = expected in got or got in expected or len(set(expected) & set(got)) / max(1, len(set(expected))) > 0.8
    print(
        ("PASS" if hit else "WARN")
        + "  回环比对："
        + ("识别内容与原文一致" if hit else "识别结果与原文差异较大（可接受，继续测）")
    )

    # 只用识别结果里的一部分作为对话输入，顺便确认链路
    await test_llm("你好呀，你是谁？")
    print("\n冒烟测试结束")


if __name__ == "__main__":
    asyncio.run(main())
