#!/bin/bash
# Renders every 3D Chog trailer sequence (one browser at a time).
set -e
S=/tmp/claude-0/-home-user-yot-monopoly/3414c931-29b4-52d1-8383-09ec282bfda1/scratchpad
T=$S/bl/tools
fuser -k 5197/tcp 2>/dev/null || true
rm -rf $S/bl/out/frames/nft-run && node $T/render-chog.mjs "mode=run" $S/bl/out/frames/nft-run 4 24 1920 1080
for tok in 1798 824 285 1699; do
  rm -rf $S/bl/out/frames/nft-turn-$tok && node $T/render-chog.mjs "mode=turn&token=$tok" $S/bl/out/frames/nft-turn-$tok 2 24 1080 1080
done
