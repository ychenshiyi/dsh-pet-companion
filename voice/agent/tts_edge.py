"""Edge TTS 适配器（免费、无需 key 的中文语音合成）。

实现要点：
  - 走 livekit 的非流式 TTS 接口：LLM 每句话 → synthesize() → 一段 PCM
  - edge-tts 返回 mp3，用 PyAV 解码/重采样成 24 kHz 单声道 s16le
  - 只依赖网络到微软的语音服务；不落盘、不需要凭证

音色：zh-CN-XiaoxiaoNeural（晓晓，女声，自然口语）。
"""

from __future__ import annotations

import asyncio

import edge_tts
from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.agents.utils import shortuuid

from .audio_utils import decode_to_pcm
from .text_split import split_tts_text

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"


class EdgeTTS(tts.TTS):
    def __init__(
        self,
        *,
        voice: str = DEFAULT_VOICE,
        rate: str = "+0%",
        pitch: str = "+0Hz",
        volume: str = "+0%",
        sample_rate: int = 24000,
        timeout: float = 20.0,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._voice = voice
        self._rate = rate
        self._pitch = pitch
        self._volume = volume
        self._timeout = timeout

    @property
    def model(self) -> str:
        return self._voice

    @property
    def provider(self) -> str:
        return "edge-tts"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return EdgeTTSStream(
            tts=self,
            input_text=text,
            conn_options=conn_options,
            voice=self._voice,
            rate=self._rate,
            pitch=self._pitch,
            volume=self._volume,
            timeout=self._timeout,
        )


class EdgeTTSStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: EdgeTTS,
        input_text: str,
        conn_options: APIConnectOptions,
        voice: str,
        rate: str,
        pitch: str,
        volume: str,
        timeout: float,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._voice = voice
        self._rate = rate
        self._pitch = pitch
        self._volume = volume
        self._timeout = timeout

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        text = self._input_text.strip()
        if not text:
            output_emitter.initialize(
                request_id=shortuuid(),
                sample_rate=self._tts.sample_rate,
                num_channels=1,
                mime_type="audio/pcm",
            )
            output_emitter.end_input()
            return

        output_emitter.initialize(
            request_id=shortuuid(),
            sample_rate=self._tts.sample_rate,
            num_channels=1,
            mime_type="audio/pcm",
            frame_size_ms=100,
        )
        # 先合成第一个短句就能出声，不必等整段回复的 MP3 全部返回
        segments = split_tts_text(text)
        silence = b"\x00" * int(self._tts.sample_rate * 0.08) * 2
        for index, segment in enumerate(segments):
            mp3 = await self._fetch_mp3(segment)
            pcm = await asyncio.get_running_loop().run_in_executor(None, decode_to_pcm, mp3, self._tts.sample_rate, 1)
            if index > 0:
                output_emitter.push(silence)
            output_emitter.push(pcm)
        output_emitter.end_input()

    async def _fetch_mp3(self, text: str) -> bytes:
        chunks: list[bytes] = []
        async with asyncio.timeout(self._timeout):
            communicate = edge_tts.Communicate(
                text,
                self._voice,
                rate=self._rate,
                pitch=self._pitch,
                volume=self._volume,
            )
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio" and chunk.get("data"):
                    chunks.append(chunk["data"])
        audio = b"".join(chunks)
        if not audio:
            raise RuntimeError("Edge TTS 没有返回音频（检查网络或文本是否为空）")
        return audio
