# Phase 2 — voice-adapted lesson archetypes

All Practice exercises stay **voice-first** (game plan). Tap-only MCQ / word-bank UIs from reference apps must be redesigned before ship:

- **MCQ** → user **speaks** one option; score by best transcript match to option strings.
- **Word bank** → user **speaks** the full sentence; align tokens to target order.
- **Dialog** → same Echo pipeline with scripted prompts and optional TTS.

Deck field `exerciseType`: `echo` | `mcq` | `wordBank` (v1 ships `echo` only).
