#!/bin/bash
set -e

MODEL_DIR="$(dirname "$0")/../resources/models"
PARAKEET_DIR="$MODEL_DIR/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
TARBALL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"

if [ -f "$PARAKEET_DIR/encoder.int8.onnx" ]; then
  echo "Parakeet model already exists at $PARAKEET_DIR"
  exit 0
fi

mkdir -p "$MODEL_DIR"

echo "Downloading Parakeet TDT 0.6b v2 (int8) (~662 MB)..."
curl -L --progress-bar \
  "$TARBALL_URL" \
  -o "$MODEL_DIR/parakeet-tdt.tar.bz2"

echo "Extracting..."
tar xf "$MODEL_DIR/parakeet-tdt.tar.bz2" -C "$MODEL_DIR"

rm -f "$MODEL_DIR/parakeet-tdt.tar.bz2"

if [ -f "$PARAKEET_DIR/encoder.int8.onnx" ]; then
  echo "Done. Parakeet model saved to $PARAKEET_DIR"
else
  echo "ERROR: Extraction completed but model files not found at $PARAKEET_DIR"
  exit 1
fi
