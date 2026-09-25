#!/bin/bash
# 一键部署到 Cloudflare Pages
# 凭据来源（按优先级）：
#   1. 环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#   2. ~/.wrangler/.env（推荐：永不过期的 API Token，权限 600）
# 不再依赖 OAuth 登录（几小时就过期，会报 Authentication error [code: 10000]）
#
# 2026-09-25 改造：wrangler 不读 .gitignore/.assetsignore，会把 datasheets_comp/
# （4.3GB / 3900 个竞品 PDF）和 node_modules/ 一起上传 —— 曾致部署 5036 个文件、
# 反复 fetch failed。现在先 rsync 到干净的 /tmp 发布目录，只传站点真用到的资源。
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "🚀 部署到 Cloudflare Pages..."

# 读取本地凭据文件
ENVF="$HOME/.wrangler/.env"
if [ -f "$ENVF" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENVF"
  set +a
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "❌ 未找到 CLOUDFLARE_API_TOKEN。" >&2
  echo "   请确认 ~/.wrangler/.env 存在且含该变量（权限应为 600）。" >&2
  echo "   创建 API Token: https://dash.cloudflare.com/profile/api-tokens" >&2
  echo "   权限需为 Account → Cloudflare Pages → Edit，TTL 留空。" >&2
  exit 1
fi

# account id 可缺省，写死兜底
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-8c37390eb04c22752a9f04023bd03498}"

# ---------- 构造干净发布目录（只含站点资源）----------
PUB="$(mktemp -d /tmp/fae_pub.XXXXXX)"
trap 'rm -rf "$PUB"' EXIT
echo "📦 构造发布目录 $PUB"

# 站点资源目录（代码里实际引用的：./circuits/ ./data/ ./datasheets/）
for d in datasheets pins_webp pins circuits data; do
  [ -d "$DIR/$d" ] && rsync -a --exclude '.DS_Store' "$DIR/$d/" "$PUB/$d/"
done

# 根文件（HTML/JS/CSS/图标，排除调试脚本）
for f in index.html app.js unified.js style.css favicon.svg apple-touch-icon.png og-cover.png; do
  [ -f "$DIR/$f" ] && cp "$DIR/$f" "$PUB/"
done

# 站点根目录若还有其它必需静态文件（如 robots.txt / _headers），一并带上
for f in robots.txt _headers _redirects; do
  [ -f "$DIR/$f" ] && cp "$DIR/$f" "$PUB/"
done

NFILES=$(find "$PUB" -type f | wc -l | tr -d ' ')
NSIZE=$(du -sh "$PUB" | cut -f1)
echo "   待传 $NFILES 个文件 / $NSIZE（原目录含 datasheets_comp 时是 5036 个）"

wrangler pages deploy "$PUB" --project-name logic --branch main --commit-dirty=true 2>&1
echo "✅ 部署完成! 🌐 https://logic-qbu.pages.dev"
