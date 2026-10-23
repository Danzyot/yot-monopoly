#!/usr/bin/env bash
# The 3D renders in the Characters page's "What are NFT Chogs?" pop-up
# (client/src/components/NftChogsInfo.tsx): one front view per example token,
# rendered by chog_traits.py's preview and saved as small webp files in
# client/public/chogs/examples/<id>.webp. Rerun after changing the trait parts.
#
#   tools/blender/chog_examples.sh            # the tokens below
#   tools/blender/chog_examples.sh 1,597,61   # others (add them to EXAMPLES in NftChogsInfo.tsx too)
#
# BLENDER_VENV is passed through to run.sh. ~2 min.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
# Keep in step with EXAMPLES in client/src/components/NftChogsInfo.tsx.
TOKENS=${1:-1,597,1089,124,61,425}
SIZE=${SIZE:-300}
OUT=$REPO/client/public/chogs/examples
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

"$HERE/run.sh" chog_traits.py --preview "$TMP/chog.png" --tokens "$TOKENS" --no-export
mkdir -p "$OUT"
VENV=${BLENDER_VENV:-$HERE/.venv}
"$VENV/bin/python" - "$TMP" "$OUT" "$SIZE" "$TOKENS" <<'PY'
import os, sys
from PIL import Image
tmp, out, size, tokens = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4].split(',')
for t in tokens:
    im = Image.open(os.path.join(tmp, f'chog_{t}.png')).convert('RGB')
    im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
    dst = os.path.join(out, f'{t}.webp')
    im.save(dst, 'WEBP', quality=82, method=6)
    print('wrote', os.path.relpath(dst), im.size, f'{os.path.getsize(dst) // 1024} KB')
PY
