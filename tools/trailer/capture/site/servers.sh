#!/bin/bash
# Start (or restart) the local servers the captures use: the hub (8611, demo sign-in, the built client)
# and Chog Poker (8612, signed with a local secret), each with throwaway data, then seed poker.
S=/tmp/chog-trailer
CAP=$S/bl/cap; D=$S/bl/capdata
what=${1:-all}
if [ "$what" = stop ]; then
  for p in $(pgrep -f "^node (hub-seed|poker-seed)"); do kill $p; done
  fuser -k 8611/tcp 8612/tcp 2>/dev/null; echo "servers stopped"; exit 0
fi
if [ "$what" = all ] || [ "$what" = main ]; then
  for p in $(pgrep -f "^node hub-seed"); do kill $p; done
  fuser -k 8611/tcp 2>/dev/null; sleep 1; rm -rf $D/main; mkdir -p $D/main
  (cd $CAP && node main-seed.mjs $D/main)
  (cd /home/user/yot-monopoly/server && DATA_DIR=$D/main DEMO_MODE=1 ADMIN_DISCORD_IDS=100000000000000001 PORT=8611 nohup npx tsx src/index.ts > $D/main.log 2>&1 &)
fi
if [ "$what" = all ] || [ "$what" = poker ]; then
  for p in $(pgrep -f "^node poker-seed"); do kill $p; done
  fuser -k 8612/tcp 2>/dev/null; sleep 1; rm -rf $D/poker; mkdir -p $D/poker; rm -f $CAP/poker-go $CAP/poker-state.json $CAP/poker-speed
  (cd /home/user/yot-monopoly/poker/server && DATA_DIR=$D/poker CHOG_SECRET=trailercap RATE_LIMIT_OFF=1 ADMIN_DISCORD_IDS=123456789012 PORT=8612 nohup npx tsx src/index.ts > $D/poker.log 2>&1 &)
  for i in $(seq 1 60); do curl -s -o /dev/null localhost:8612/api/health && break; sleep 1; done
  (cd $CAP && nohup node poker-seed.mjs > $D/seed.log 2>&1 &)
  for i in $(seq 1 60); do [ -f $CAP/poker-state.json ] && break; sleep 1; done
fi
for i in $(seq 1 60); do curl -s -o /dev/null localhost:8611/ && break; sleep 1; done
if [ "$what" = all ] || [ "$what" = main ]; then (cd $CAP && nohup node hub-seed.mjs > $D/hubseed.log 2>&1 &); sleep 6; cat $D/hubseed.log; fi
echo "servers up"
