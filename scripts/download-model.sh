#!/bin/bash
set -e

MODEL_DIR="$(dirname "$0")/../resources/models"
MODEL_FILE="$MODEL_DIR/ggml-small.bin"

if [ -f "$MODEL_FILE" ]; then
  echo "Model already exists at $MODEL_FILE"
  exit 0
fi

mkdir -p "$MODEL_DIR"

echo "Downloading ggml-small.bin (~460 MB)..."
curl -L --progress-bar \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" \
  -o "$MODEL_FILE"

echo "Done. Model saved to $MODEL_FILE"
