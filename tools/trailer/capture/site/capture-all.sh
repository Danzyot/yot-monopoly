#!/bin/bash
# Re-run every trailer screen capture from scratch: fresh local servers (seeded), then all sequences,
# then the stills and the contact sheet. Takes ~25 min on a loaded 4-core box.
S=/tmp/claude-0/-home-user-yot-monopoly/3414c931-29b4-52d1-8383-09ec282bfda1/scratchpad
cd $S/bl/cap
./servers.sh all && sleep 30
node capture.mjs home hub dailies-phone home-phone poker-lobby poker-table monopoly-game cards-table
# Stills: the frame each sequence reads best at.
cp $S/bl/screens/monopoly-game/0050.png $S/bl/screens/monopoly-game.png
cp $S/bl/screens/poker-table/0060.png $S/bl/screens/poker-table.png
$S/bpy-venv/bin/python make-sheet.py $S/bl/screens $S/bl/screens-sheet.png
./servers.sh stop
