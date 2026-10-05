#!/bin/sh
# Puts the MediaPipe assets under public/ (CLAUDE.md §9). Runs at container start, because
# the source bind mount would hide anything baked into the image under public/.
#  - pose model: downloaded once (skipped if already present)
#  - WASM runtime: copied from the installed @mediapipe/tasks-vision so versions always match
set -e
cd "$(dirname "$0")/.."

MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
MODEL="public/models/pose_landmarker_full.task"

mkdir -p public/models
if [ ! -s "$MODEL" ]; then
  echo "fetch-model: downloading pose_landmarker_full.task"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$MODEL_URL" -o "$MODEL.tmp"
  else
    wget -q "$MODEL_URL" -O "$MODEL.tmp"
  fi
  mv "$MODEL.tmp" "$MODEL"
fi
echo "fetch-model: model ok ($(wc -c < "$MODEL" | tr -d ' ') bytes)"

rm -rf public/wasm
cp -R node_modules/@mediapipe/tasks-vision/wasm public/wasm
echo "fetch-model: wasm copied ($(ls public/wasm | tr '\n' ' '))"
