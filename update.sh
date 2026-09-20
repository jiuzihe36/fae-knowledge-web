#!/bin/bash
# 一键更新: wiki同步 + 部署到 Cloudflare Pages
# 用法: ./update.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=========================================="
echo "  芯祥 FAE 知识库 → Cloudflare Pages"
echo "=========================================="
echo ""
echo "📦 Step 1: 从 wiki 同步数据..."
python3 "$DIR/scripts/sync_from_wiki.py"
echo ""
echo "🚀 Step 2: 部署..."
bash "$DIR/scripts/deploy.sh"
echo ""
echo "=========================================="
echo "  ✅ 完成! 🌐 https://logic-qbu.pages.dev"
echo "=========================================="
