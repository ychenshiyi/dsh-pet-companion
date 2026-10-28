"""MeloTTS（sherpa-onnx VITS）本地离线 TTS 适配器。

模型：vits-melo-tts-zh_en（model.onnx + lexicon.txt + tokens.txt + dict/）。
44.1kHz 单声道；CPU 推理，首句加载约 1–2 秒。
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path

import numpy as np
import sherpa_onnx as s
from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.agents.utils import shortuuid

from .text_split import split_tts_text

_CACHE: dict[str, s.OfflineTts] = {}
_LOCK = threading.Lock()


def _load_tts(model_dir: str) -> s.OfflineTts:
    directory = Path(model_dir)
    model = directory / "model.onnx"
    if not model.exists():
        raise RuntimeError(f"MeloTTS 模型缺失：{model}")
    with _LOCK:
        cached = _CACHE.get(model_dir)
        if cached is not None:
            return cached
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
        engine = s.OfflineTts(config)
        _CACHE[model_dir] = engine
        return engine


def _generate(model_dir: str, text: str, speed: float) -> tuple[bytes, int]:
    engine = _load_tts(model_dir)
    with _LOCK:
        audio = engine.generate(text, sid=0, speed=speed)
    samples = np.clip(np.asarray(audio.samples, dtype=np.float32), -1.0, 1.0)
    return (samples * 32767.0).astype(np.int16).tobytes(), int(audio.sample_rate)


class MeloTTS(tts.TTS):
    def __init__(self, *, model_dir: str, speed: float = 1.0) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=44100,
            num_channels=1,
        )
        self._model_dir = model_dir
        self._speed = speed
        # 提前校验模型，失败让调用方回落到 Edge
        _load_tts(model_dir)

    @property
    def model(self) -> str:
        return "melo-tts-zh-en"

    @property
    def provider(self) -> str:
        return "sherpa-onnx"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return _MeloStream(
            tts=self, input_text=text, conn_options=conn_options, model_dir=self._model_dir, speed=self._speed
        )


class _MeloStream(tts.ChunkedStream):
    def __init__(
        self, *, tts: MeloTTS, input_text: str, conn_options: APIConnectOptions, model_dir: str, speed: float
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._model_dir = model_dir
        self._speed = speed

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
        segments = split_tts_text(text)
        silence = b"\x00" * int(self._tts.sample_rate * 0.08) * 2
        for index, segment in enumerate(segments):
            pcm, _rate = await asyncio.get_running_loop().run_in_executor(
                None, _generate, self._model_dir, segment, self._speed
            )
            if index > 0:
                output_emitter.push(silence)
            output_emitter.push(pcm)
        output_emitter.end_input()
