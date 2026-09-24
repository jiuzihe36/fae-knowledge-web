#!/bin/bash
# 一键部署到 Cloudflare Pages
# 凭据来源（按优先级）：
#   1. 环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#   2. ~/.wrangler/.env（推荐：永不过期的 API Token，权限 600）
# 不再依赖 OAuth 登录（几小时就过期，会报 Authentication error [code: 10000]）
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

wrangler pages deploy "$DIR" --project-name logic --branch main --commit-dirty=true 2>&1
echo "✅ 部署完成! 🌐 https://logic-qbu.pages.dev"
