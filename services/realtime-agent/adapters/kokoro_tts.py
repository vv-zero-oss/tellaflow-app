from __future__ import annotations

import base64
import os
import platform
import re
import sys
from dataclasses import dataclass
from typing import Any

import numpy as np

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


class TTSBackend:
    sample_rate: int = 24000

    def generate(self, text: str, voice: str = "af_heart", speed: float = 1.1) -> np.ndarray:
        raise NotImplementedError


class MLXBackend(TTSBackend):
    def __init__(self) -> None:
        from mlx_audio.tts.generate import load_model

        self._model = load_model("mlx-community/Kokoro-82M-bf16")
        self.sample_rate = int(self._model.sample_rate)
        # Warmup to avoid first-response latency spikes.
        list(self._model.generate(text="Hello", voice="af_heart", speed=1.0))

    def generate(self, text: str, voice: str = "af_heart", speed: float = 1.1) -> np.ndarray:
        results = list(self._model.generate(text=text, voice=voice, speed=speed))
        if not results:
            return np.array([], dtype=np.float32)
        return np.concatenate([np.array(r.audio, dtype=np.float32) for r in results])


class ONNXBackend(TTSBackend):
    def __init__(self) -> None:
        import kokoro_onnx
        from huggingface_hub import hf_hub_download

        model_path = hf_hub_download("fastrtc/kokoro-onnx", "kokoro-v1.0.onnx")
        voices_path = hf_hub_download("fastrtc/kokoro-onnx", "voices-v1.0.bin")
        self._model = kokoro_onnx.Kokoro(model_path, voices_path)
        self.sample_rate = 24000

    def generate(self, text: str, voice: str = "af_heart", speed: float = 1.1) -> np.ndarray:
        pcm, _sr = self._model.create(text, voice=voice, speed=speed)
        return np.array(pcm, dtype=np.float32)


@dataclass
class _FallbackBackend(TTSBackend):
    reason: str
    sample_rate: int = 24000

    def generate(self, text: str, voice: str = "af_heart", speed: float = 1.1) -> np.ndarray:
        # No real audio available; return empty waveform so caller can still emit sentence boundaries.
        return np.array([], dtype=np.float32)


class KokoroTTSAdapter:
    def __init__(self) -> None:
        self.backend_impl: TTSBackend
        self.backend: str
        self.last_error: str | None = None

        try:
            if _is_apple_silicon() and not os.getenv("KOKORO_ONNX"):
                try:
                    self.backend_impl = MLXBackend()
                    self.backend = "kokoro-mlx"
                    return
                except Exception as mlx_exc:
                    # Match Parlor behavior: prefer MLX on Apple Silicon, but gracefully
                    # fall back to ONNX when MLX stack is unavailable.
                    self.last_error = f"mlx unavailable: {mlx_exc}"
            self.backend_impl = ONNXBackend()
            self.backend = "kokoro-onnx"
        except Exception as exc:
            if self.last_error:
                self.last_error = f"{self.last_error}; onnx unavailable: {exc}"
            else:
                self.last_error = str(exc)
            self.backend_impl = _FallbackBackend(reason=self.last_error)
            self.backend = "kokoro-fallback"

    def health(self) -> dict[str, Any]:
        return {
            "ready": self.backend != "kokoro-fallback",
            "backend": self.backend,
            "sampleRate": int(self.backend_impl.sample_rate),
            "lastError": self.last_error,
        }

    def synthesize_sentences(self, text: str) -> list[dict[str, Any]]:
        sentences = [s.strip() for s in SENTENCE_SPLIT_RE.split((text or "").strip()) if s.strip()]
        if not sentences and text.strip():
            sentences = [text.strip()]

        events: list[dict[str, Any]] = []
        for i, sentence in enumerate(sentences):
            sid = f"sent_{i+1}"
            events.append({"type": "tts.sentence_start", "payload": {"sentenceId": sid, "text": sentence}})

            pcm = self.backend_impl.generate(sentence)
            if pcm.size > 0:
                pcm_int16 = (pcm * 32767).clip(-32768, 32767).astype(np.int16)
                data_b64 = base64.b64encode(pcm_int16.tobytes()).decode("ascii")
                events.append(
                    {
                        "type": "tts.audio_chunk",
                        "payload": {
                            "sentenceId": sid,
                            "seq": 0,
                            "sampleRate": int(self.backend_impl.sample_rate),
                            "format": "pcm_s16le",
                            "dataB64": data_b64,
                        },
                    }
                )

            events.append({"type": "tts.sentence_end", "payload": {"sentenceId": sid}})

        return events
