"""SenseVoice（sherpa-onnx，本地离线）STT 适配器。

为什么用 SenseVoice：
  - 中文识别质量好、带标点（ITN），模型 int8 约 230MB，CPU 推理很快
  - 支持中/英/日/韩/粤，适合“中文为主、偶尔夹英文”的聊天
  - 完全本地，不依赖任何云端 key

接入方式：LiveKit 的非流式 STT 接口（VAD 说完一句 → 整段送进来 → 返回文本）。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable

import sherpa_onnx
from livekit.agents import stt
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr
from livekit.agents.utils import AudioBuffer

from .audio_utils import audio_buffer_to_pcm16, pcm16_to_float32

# 进程内缓存：模型 230MB，创建一次约 2 秒；多会话共享同一个 recognizer
_RECOGNIZER = None
_RECOGNIZER_KEY: tuple | None = None
_CREATE_LOCK = threading.Lock()
logger = logging.getLogger("pet-agent.stt")


def _get_recognizer(
    model_path: str,
    tokens_path: str,
    num_threads: int,
    use_itn: bool,
    language: str,
) -> sherpa_onnx.OfflineRecognizer:
    global _RECOGNIZER, _RECOGNIZER_KEY
    key = (model_path, tokens_path, num_threads, use_itn, language)
    with _CREATE_LOCK:
        if _RECOGNIZER is None or key != _RECOGNIZER_KEY:
            _RECOGNIZER = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=model_path,
                tokens=tokens_path,
                num_threads=num_threads,
                use_itn=use_itn,
                language=language,
                debug=False,
            )
            _RECOGNIZER_KEY = key
        return _RECOGNIZER


class SenseVoiceSTT(stt.STT):
    def __init__(
        self,
        *,
        model_path: str,
        tokens_path: str,
        language: str = "zh",
        num_threads: int = 4,
        use_itn: bool = True,
        text_filter: Callable[[str], str] | None = None,
        emotion_sink: Callable[[str], None] | None = None,
    ) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._model_path = model_path
        self._tokens_path = tokens_path
        self._num_threads = num_threads
        self._use_itn = use_itn
        self._text_filter = text_filter
        self._emotion_sink = emotion_sink
        # sherpa-onnx 的 recognizer 不是线程安全的；同一时刻只允许一次 decode
        self._lock = threading.Lock()
        self._language = language

    @property
    def model(self) -> str:
        return "sense-voice-int8"

    @property
    def provider(self) -> str:
        return "sherpa-onnx"

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        pcm, sample_rate = audio_buffer_to_pcm16(buffer)
        lang = language if isinstance(language, str) and language else self._language
        text, emotion = await asyncio.get_running_loop().run_in_executor(None, self._decode, pcm, sample_rate, lang)
        if emotion and self._emotion_sink is not None:
            self._emotion_sink(emotion)
        if self._text_filter is not None:
            text = self._text_filter(text)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language=lang, text=text)],
        )

    def warmup(self) -> None:
        """低延迟模式：在会话开始前加载模型，避免第一句多等 1–2 秒。失败不影响启动。"""
        try:
            _get_recognizer(
                self._model_path,
                self._tokens_path,
                self._num_threads,
                self._use_itn,
                self._language,
            )
            logger.info("SenseVoice 预热完成")
        except Exception as error:  # noqa: BLE001
            logger.warning("SenseVoice 预热失败：%s", error)

    def _decode(self, pcm: bytes, sample_rate: int, language: str) -> tuple[str, str]:
        if not pcm:
            return "", ""
        samples = pcm16_to_float32(pcm)
        recognizer = _get_recognizer(
            self._model_path,
            self._tokens_path,
            self._num_threads,
            self._use_itn,
            language,
        )
        with self._lock:
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, samples)
            recognizer.decode_stream(stream)
            return (stream.result.text or "").strip(), str(getattr(stream.result, "emotion", "") or "")
