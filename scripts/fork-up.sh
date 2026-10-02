#!/usr/bin/env bash
# Brings up the whole fork rehearsal for chat.zipcoin.cash and seeds it. Nothing touches mainnet.
#   anvil :8547 (mainnet fork, chain id 1)  ·  fork-zkapi stand-in :3250  ·  zipcoin web :3101 (fresh 0xbow cache)
#   seeds a ZC note + an ETH note for a random phrase and for anvil account 0's wallet-derived phrase
#   chat app :3200 built against the fork (ZKAPI_NETWORK=fork)
# usage: FORK_RPC=<archive mainnet rpc> scripts/fork-up.sh   (also needs a local checkout of the zipcoin web app for the relayer)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$HERE/../web"
ANVIL="$HOME/.foundry/bin/anvil"
FORK_RPC="${FORK_RPC:-$(cat ~/.config/zipcoin/quicknode.url)}"   # any archive-capable mainnet RPC

pkill -f "anvil.*8547" 2>/dev/null || true
pkill -f "fork-zkapi.mjs" 2>/dev/null || true
pkill -f "next dev -p 3101" 2>/dev/null || true
pkill -f "next dev -p 3200" 2>/dev/null || true
sleep 1
rm -f /tmp/bow-fork-chat.json /tmp/bow-fork-chat-*.json /tmp/bow-asp-chat.json

echo "[fork-up] anvil"
nohup "$ANVIL" --fork-url "$FORK_RPC" --chain-id 1 --port 8547 --disable-min-priority-fee --silent > /tmp/anvil-chat.log 2>&1 &
for i in $(seq 1 30); do curl -s http://127.0.0.1:8547 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | grep -q result && break; sleep 1; done
curl -s http://127.0.0.1:8547 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"evm_setIntervalMining","params":[2]}' > /dev/null

echo "[fork-up] fork-zkapi stand-in"
(cd "$HERE" && nohup node scripts/fork-zkapi.mjs > /tmp/fork-zkapi.log 2>&1 &)
sleep 5; cat /tmp/fork-zkapi.log

echo "[fork-up] zipcoin web on :3101 (fork)"
(cd "$WEB" && RPC_URL=http://127.0.0.1:8547 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8547 BROADCAST_RPCS=http://127.0.0.1:8547 ENABLE_WORKERS=1 ASP_DELAY_SEC=5 ASP_MIN_PUSH_MS=5000 ASP_TICK_MS=5000 \
  BOW_CACHE_FILE=/tmp/bow-fork-chat.json BOW_ASP_FILE=/tmp/bow-asp-chat.json RELAY_SUBSIDY_BPS=10000 RELAY_DAILY_SUBSIDY_WEI=1000000000000000000 NEXT_PUBLIC_SITE_URL=http://localhost:3101 \
  nohup pnpm exec next dev -p 3101 > /tmp/zc_web_fork.log 2>&1 &)
for i in $(seq 1 60); do curl -s -m 30 http://localhost:3101/api/health | grep -q '"ok":true' && break; sleep 2; done
curl -s http://localhost:3101/api/health | head -c 200; echo

echo "[fork-up] seeding notes"
cd "$HERE"
PHRASE0="slab winter purity length trust finish banana final engage apple shift clock"   # anvil account 0's wallet-derived zip phrase
RPC=http://127.0.0.1:8547 API=http://localhost:3101 BOW_ASP_FILE=/tmp/bow-asp-chat.json ZC_AMOUNT=25000 ETH_AMOUNT=0.2 pnpm dlx tsx@4.19.2 scripts/fork-seed.mts | grep -E "^ok|FAIL|PHRASE|label" | tee /tmp/fork-seed-random.log
RPC=http://127.0.0.1:8547 API=http://localhost:3101 BOW_ASP_FILE=/tmp/bow-asp-chat.json PHRASE="$PHRASE0" ZC_AMOUNT=25000 ETH_AMOUNT=0.2 pnpm dlx tsx@4.19.2 scripts/fork-seed.mts | grep -E "^ok|FAIL|label"

echo "[fork-up] chat on :3200 (fork assets)"
ZKAPI_NETWORK=fork node scripts/zkapi-assets.mjs
(NEXT_PUBLIC_ZIPCOIN_API=http://localhost:3101 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8547 NEXT_PUBLIC_EXPLORER= nohup pnpm exec next dev -p 3200 > /tmp/zc_chat_dev.log 2>&1 &)
sleep 8
echo "[fork-up] ready. random phrase: $(grep PHRASE= /tmp/fork-seed-random.log | cut -d= -f2-)"
