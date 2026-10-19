#!/usr/bin/env bash
# Bring the VPN and datacenter range lists up to date.
#
# The lists are checked into the repo on purpose: a tournament must not depend
# on somebody else's server being reachable, and a deploy must not fail
# because GitHub is having a bad afternoon. The cost of that choice is this
# script — run it every month or two and commit the result.
#
# The source is derived from ASN ownership, so it ages slowly. A refresh that
# changes a few hundred ranges is normal; one that empties a file is not, which
# is why each download is checked for a plausible size before it replaces
# anything.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="server/vpn-ranges"
BASE="https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # remote-path  local-name  minimum-lines
  local url="$BASE/$1" out="$TMP/$2" min="$3"
  echo "fetching $2..."
  curl -fsSL --max-time 120 -o "$out" "$url"
  local n
  n=$(wc -l < "$out")
  if [ "$n" -lt "$min" ]; then
    echo "REFUSING $2: only $n lines, expected at least $min — leaving the committed list alone" >&2
    exit 1
  fi
  echo "  $n ranges"
  mv "$out" "$DEST/$2"
}

fetch vpn/ipv4.txt        vpn-v4.txt        5000
fetch vpn/ipv6.txt        vpn-v6.txt         100
fetch datacenter/ipv4.txt datacenter-v4.txt 20000
fetch datacenter/ipv6.txt datacenter-v6.txt  1000

echo
echo "Done. Run the tests before committing — server/test/vpn.test.ts checks"
echo "that real player addresses from this site's audit are still classified"
echo "the way they were."
git -C . --no-pager diff --stat -- "$DEST" || true
