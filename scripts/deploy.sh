#!/bin/bash
# 一键部署到 Cloudflare Pages
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "🚀 部署到 Cloudflare Pages..."
# CLOUDFLARE_ACCOUNT_ID: 跳过 wrangler 联网查账户列表 (OAuth token 过期/网络抖动时会报
# "Failed to automatically retrieve account IDs" 导致部署失败)
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-8c37390eb04c22752a9f04023bd03498}"
wrangler pages deploy "$DIR" --project-name logic --branch main --commit-dirty=true 2>&1
echo "✅ 部署完成! 🌐 https://logic-qbu.pages.dev"
