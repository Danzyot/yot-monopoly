#!/usr/bin/env bash
# Run a build script with headless Blender (the bpy wheel; no Blender install needed).
#   tools/blender/run.sh classic_room.py
# First run creates tools/blender/.venv with bpy + Pillow (~400 MB). Set
# BLENDER_VENV to reuse a venv elsewhere. bpy 5.0 needs Python 3.11.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VENV=${BLENDER_VENV:-$HERE/.venv}
if [ ! -x "$VENV/bin/python" ]; then
  "${PYTHON:-python3.11}" -m venv "$VENV"
  "$VENV/bin/pip" install -q 'bpy==5.0.*' pillow
fi
exec "$VENV/bin/python" "$HERE/$1" "${@:2}"
