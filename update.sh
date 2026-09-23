#!/bin/bash
# ============================================================
#  芯祥 FAE 知识库 → 双端同步一键更新
#  GitHub(存档) + Cloudflare Pages(发布)  互不污染 wiki
#  用法: ./update.sh
# ============================================================
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PAGE_URL="https://logic-qbu.pages.dev"

echo "=========================================="
echo "  芯祥 FAE 知识库 → 全端同步"
echo "=========================================="

# ---------- 0. 校验前置 ----------
command -v wrangler >/dev/null 2>&1 || { echo "❌ 缺 wrangler: npm i -g wrangler"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ 缺 python3"; exit 1; }
if ! wrangler whoami 2>/dev/null | grep -q "logged in"; then
  echo "❌ 未登录 Cloudflare → 请先运行: wrangler login"
  exit 1
fi

# ---------- 1. 从本地 wiki 同步/重建数据 ----------
echo ""
echo "📦 Step 1: 从本地 wiki 同步数据..."
if [ -f "$DIR/scripts/sync_from_wiki.py" ]; then
  python3 "$DIR/scripts/sync_from_wiki.py"
else
  echo "  (无 sync_from_wiki.py — 跳过重建, 沿用现有 products.json)"
fi

# P2P 替代数据（wiki full-mapping -> data/p2p.json，对账失败会中断部署）
if [ -f "$DIR/scripts/gen_p2p.py" ]; then
  python3 "$DIR/scripts/gen_p2p.py" || { echo "❌ gen_p2p.py 对账失败, 中止"; exit 1; }
else
  echo "  (无 gen_p2p.py — 跳过 p2p.json)"
fi

cd "$DIR"

# ---------- 2. GitHub 提交 + 推送（单向: 本地 → 远程）----------
echo ""
echo "📤 Step 2: 提交并推送到 GitHub (存档)..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m "自动同步 $(date '+%Y-%m-%d %H:%M'): wiki → 网页全端发布"
    echo "  ✅ 已提交: $(git log --oneline -1)"
  else
    echo "  ℹ️ 无变更, 跳过提交"
  fi

  if git remote | grep -q '^origin$'; then
    if git push origin main 2>&1 | grep -qE "Everything up-to-date|main -> main"; then
      echo "  ✅ GitHub main 已同步"
    else
      echo "  ⚠️ GitHub push 失败(可能凭据/网络) — 本地提交已保留, 可稍后: git push origin main"
    fi
  else
    echo "  ⚠️ 未配置 GitHub remote — 跳过 GitHub"
  fi
else
  echo "  ⚠️ 非 git 仓库 — 跳过 GitHub 步骤"
fi

# ---------- 3. Cloudflare Pages 部署（发布）----------
echo ""
echo "🎯 Step 1.5: 应用域注入已停用 (2026-09-24)"
echo "  原因: inject_applications.py 会把 40 条中文精编 applications 覆盖为"
echo "  含 ◼ PUA/题头噪音的 PDF 原文 (与全库 630 条中文口径不一致)。"
echo "  如需恢复, 先清洗 raw_apps_authoritative.json 再启用本步。"
# python3 "$DIR/scripts/inject_applications.py" 2>&1 | tail -3

echo ""
echo "📤 Step 2: 提交并推送 GitHub + 部署 Cloudflare (双端)..."
bash "$DIR/scripts/deploy.sh"

# ---------- 4. 完成 ----------
echo ""
echo "=========================================="
echo "  ✅ 更新完成!"
echo "  📦 GitHub 存档: https://github.com/jiuzihe36/fae-knowledge-web"
echo "  🌐 发布站点:   $PAGE_URL"
echo "=========================================="
