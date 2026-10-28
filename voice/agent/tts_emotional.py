"""情绪化 TTS 包装：每次合成前读取 emotion.json，把心情映射成韵律。"""

from __future__ import annotations

from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions

from .emotion import EmotionStore
from .prosody import edge_prosody, melo_speed
from .tts_edge import EdgeTTS
from .tts_melo import MeloTTS


class EmotionalTTS(tts.TTS):
    """按当前心情动态调整 Edge rate/pitch 或 Melo speed 的 TTS。"""

    def __init__(
        self,
        engine: str,
        *,
        voice: str,
        rate: str,
        pitch: str,
        volume: str,
        melo_dir: str,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000 if engine == "edge" else 44100,
            num_channels=1,
        )
        self._engine = "melo" if engine == "melo" else "edge"
        self._voice = voice
        self._rate = rate
        self._pitch = pitch
        self._volume = volume
        self._melo_dir = melo_dir
        self._emotion = EmotionStore()

    @property
    def model(self) -> str:
        return f"emotional-{self._engine}"

    @property
    def provider(self) -> str:
        return "sherpa-onnx" if self._engine == "melo" else "edge-tts"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        mood = "calm"
        if self._emotion.enabled:
            try:
                mood = str(self._emotion.read().get("mood") or "calm")
            except Exception:  # noqa: BLE001 - 情感文件坏了不该影响说话
                mood = "calm"
        if self._engine == "melo":
            inner = MeloTTS(model_dir=self._melo_dir, speed=melo_speed(self._rate, mood))
        else:
            rate, pitch = edge_prosody(self._rate, self._pitch, mood)
            inner = EdgeTTS(voice=self._voice, rate=rate, pitch=pitch, volume=self._volume)
        return inner.synthesize(text, conn_options=conn_options)
