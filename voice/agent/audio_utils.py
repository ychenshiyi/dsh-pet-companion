"""音频小工具：容器解码、LiveKit 音频帧 → 16k 单声道 PCM。"""

from __future__ import annotations

import io
from collections.abc import Iterable

import av
import numpy as np
from livekit import rtc


def decode_to_pcm(data: bytes, sample_rate: int, num_channels: int = 1) -> bytes:
    """任意容器（mp3/wav/ogg…）→ s16le 裸 PCM。"""
    layout = "mono" if num_channels == 1 else "stereo"
    out = bytearray()
    with av.open(io.BytesIO(data)) as container:
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout=layout, rate=sample_rate)
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                out += resampled.to_ndarray().tobytes()
        for resampled in resampler.resample(None):  # flush
            out += resampled.to_ndarray().tobytes()
    return bytes(out)


def audio_buffer_to_pcm16(buffer: rtc.AudioFrame | list[rtc.AudioFrame]) -> tuple[bytes, int]:
    """把 STT 拿到的音频缓冲统一成 16 kHz 单声道 s16le。"""
    frames: Iterable[rtc.AudioFrame] = buffer if isinstance(buffer, list) else [buffer]
    frames = list(frames)
    if not frames:
        return b"", 16000
    src_rate = frames[0].sample_rate
    src_channels = frames[0].num_channels
    if src_rate == 16000 and src_channels == 1:
        return b"".join(bytes(frame.data) for frame in frames), 16000

    resampler = rtc.AudioResampler(src_rate, 16000, num_channels=1)
    out_frames: list[rtc.AudioFrame] = []
    for frame in frames:
        out_frames.extend(resampler.push(frame))
    out_frames.extend(resampler.flush())
    return b"".join(bytes(frame.data) for frame in out_frames), 16000


def pcm16_to_float32(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
