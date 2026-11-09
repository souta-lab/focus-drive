#!/usr/bin/env bash
# Downloads the CC BY 4.0 engine recording used to build public/audio/*.mp3.
# The source is deliberately not committed; see docs/ENGINE_AUDIO.md.
set -euo pipefail
OUT="${1:-/tmp/engine/gto.ogg}"
mkdir -p "$(dirname "$OUT")"
curl -sL -A 'focus-drive-asset-research/1.0' \
  'https://upload.wikimedia.org/wikipedia/commons/8/8a/Ferrari_250_GTO%2C_Engine_Sound.ogg' -o "$OUT"
echo "downloaded $OUT ($(stat -c%s "$OUT") bytes)"
