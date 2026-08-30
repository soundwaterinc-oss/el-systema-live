#!/usr/bin/env bash
# EL-SYSTEMA Live — 全楽器サーバー一括起動（Chrome は開かず「サーバーだけ」上げる）
#
#   bin/serve-all.sh [port]        既定 8787
#
# 単一オリジンの relay 一つで hub・一覧・全楽器(instruments/)・shared を配信し、
# 同ポートを WebSocket にして「場（field）」を中継する。全部ローカル・ネット不要。
# 起動時に bin/sync-instruments.sh で最新の楽器バンドルを取り込む（PHYLLO 含む全機）。
set -u
cd "$(dirname "$0")/.."
PORT="${1:-8787}"

command -v node >/dev/null 2>&1 || { echo "[serve-all] node が必要です"; exit 1; }

echo "[serve-all] 楽器を同期（instruments/ を最新化）…"
bin/sync-instruments.sh || true

# 既存の relay があれば止める
pkill -f "server/relay.mjs" 2>/dev/null || true
sleep 0.3

echo
echo "[serve-all] relay 起動 :$PORT  ── Ctrl-C で全停止（全部ローカル）"
echo "  卓 hub    : http://localhost:$PORT/hub.html"
echo "  一覧      : http://localhost:$PORT/local-instruments.html"
echo "  投影      : http://localhost:$PORT/hub.html?view=field"
for d in instruments/*/; do
  [ -d "$d" ] || continue
  id="$(basename "$d")"
  echo "  ♪ $id : http://localhost:$PORT/instruments/$id/?field"
done
echo

# relay-forever があれば自動再起動ラッパーで、無ければ直接 node で
if [ -x bin/relay-forever.sh ]; then
  exec bin/relay-forever.sh "$PORT"
else
  exec node server/relay.mjs "$PORT"
fi
