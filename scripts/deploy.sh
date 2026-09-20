#!/bin/bash
# 一键部署到 Cloudflare Pages
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "🚀 部署到 Cloudflare Pages..."
wrangler pages deploy "$DIR" --project-name logic --branch main --commit-dirty=true 2>&1
echo "✅ 部署完成! 🌐 https://logic-qbu.pages.dev"
