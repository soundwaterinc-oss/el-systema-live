#!/usr/bin/env bash
# EL-SYSTEMA Live — 楽器バンドル同期（全部ローカル・単一オリジン配信のため）
#
#   bin/sync-instruments.sh
#
# 各楽器の配信済み静的ファイルを el-systema-live/instruments/<id>/ にコピーする。
# これで relay 一つ（:8787）から hub も楽器も同一オリジンで配信でき、
# python の個別サーバも散らばった外部パス依存も不要になる（INV-5 ローカル完結）。
#
# ※ build 産物が dist/ でない楽器や、index.html 以外が本体の楽器もあるので
#   "id|sourceDir|entryHtml" の3項で扱う。entryHtml が index.html 以外なら、hub 用の
#   index.html ラッパーを自動生成して /instruments/<id>/?field で開けるようにする。
set -u
cd "$(dirname "$0")/.."

ACID="/Users/nakamuraryuuakira/Desktop/dsktop/EL-SYSTEMA ACID"
LIVE_ACID="$HOME/Desktop/dsktop/el-systema-acid-live"
DESKTOP="$HOME/Desktop/dsktop"

# "id|sourceDir|entryHtml"
INSTRUMENTS=(
  "hado-hen|$ACID/hado-hen/dist|index.html"
  "hado-dust|$ACID/hado-dust/dist|index.html"
  "hado-field|$ACID/hado-field/dist|index.html"
  "hado-ori|$ACID/hado-ori/dist|index.html"
  "tsuki-sound|$ACID/tsuki-sound/dist|index.html"
  "hado-beat|$HOME/hado-beat/dist|index.html"
  "mycorrhiza-beat|$HOME/mycorrhiza-beat/dist|index.html"
  "moss-reservoir|$DESKTOP/cad/3d cad/mossreservoir-original/dist|index.html"
  "kagome|$DESKTOP/kagome-sound|index.html"
  "particle-noise|$DESKTOP/el-systema-bloom-particle-noise|index.html"
  "geo-generator|$DESKTOP/el-systema-bloom-geometry-generator|index.html"
  "geo-osc|$HOME/el-systema-geometry-osc/geometry-instruments|master.html"
  "cellnoise|$DESKTOP/CellnoiseGenerator|public/launch-20260524c.html"
  "stone-beats|$LIVE_ACID|stone-beats.html"
  "ocean|$LIVE_ACID|ocean.html"
  "planarian-drone|$DESKTOP/PLANARIAN-DRONE/dist|index.html"
  "phyllo|$HOME/phyllo-scale|index.html"
)

mkdir -p instruments
n=0; skip=0
for row in "${INSTRUMENTS[@]}"; do
  IFS='|' read -r id src entry <<< "$row"
  dest="instruments/$id"
  if [ ! -d "$src" ]; then
    echo "  ⏭  $id  （source 無し: $src）"
    skip=$((skip+1))
    continue
  fi

  rm -rf "$dest"
  mkdir -p "$dest"
  rsync -a --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.openai' \
    --exclude='.claude' \
    --exclude='.wrangler' \
    --exclude='.DS_Store' \
    --exclude='package-lock.json' \
    --exclude='pnpm-lock.yaml' \
    --exclude='yarn.lock' \
    "$src"/ "$dest"/

  if [ ! -f "$dest/$entry" ]; then
    echo "  ⏭  $id  （entry 無し: $src/$entry）"
    rm -rf "$dest"
    skip=$((skip+1))
    continue
  fi

  # subpath 配信のため entry の root-絶対パス（/assets,/shared 等）を相対化（Vite base:'/' 対策）。
  # 相対(./)は不変・冪等。※アセットが JS/CSS 内に /assets を焼き込んでる楽器は base:'./' で再ビルドが要る。
  sed -i '' -E 's#(src|href)="/#\1="./#g' "$dest/$entry" 2>/dev/null || true

  # ── 刺激(ASSR)レイヤーを全楽器へ配布（正本＝el-systema-live/shared）──
  # control.js が audioContext/outputNode から刺激層を自動アタッチし、assr.js が UI を自己注入する。
  # これで場接続済みの器は追加コード無しで「灯/脈/息/眠/…」が使えるようになる。
  mkdir -p "$dest/shared"
  cp shared/el-systema-assr.js    "$dest/shared/el-systema-assr.js"    2>/dev/null || true
  cp shared/el-systema-control.js "$dest/shared/el-systema-control.js" 2>/dev/null || true
  cp shared/el-systema-shapes.js  "$dest/shared/el-systema-shapes.js"  2>/dev/null || true
  cp shared/el-systema-transport.js "$dest/shared/el-systema-transport.js" 2>/dev/null || true
  # control.js を読む **全ての** html に assr の script を注入（未挿入時のみ）。
  # entry だけに注入すると、同じ bundle 内の別 html（ocean/stone-beats.html 等）が
  # 公開側の「全楽器 assr」状態と食い違い、同期のたびに差分が出る。
  while IFS= read -r -d '' html; do
    if grep -q "el-systema-control.js" "$html" && ! grep -q "el-systema-assr.js" "$html"; then
      sed -i '' -E 's#(<script[^>]*el-systema-control\.js[^>]*></script>)#\1\'$'\n''    <script src="./shared/el-systema-assr.js"></script>#' "$html" 2>/dev/null || true
    fi
  done < <(find "$dest" -type f -name '*.html' -not -path '*/node_modules/*' -print0)

  if [ "$entry" != "index.html" ]; then
    cat > "$dest/index.html" <<EOF
<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$id redirect</title>
<script>
location.replace('./$entry' + location.search + location.hash);
</script>
<p>Redirecting to <a href="./$entry">$entry</a> …</p>
</html>
EOF
  fi

  echo "  ✓ $id  ← $src  (entry: $entry)"
  n=$((n+1))
done
echo "── synced: $n  skipped: $skip → http://localhost:8787/instruments/<id>/?field"
