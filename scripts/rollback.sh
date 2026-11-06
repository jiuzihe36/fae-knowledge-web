#!/usr/bin/env bash
# 回滚 Cloudflare Pages 生产部署到最近某一次部署。
#
# 为什么不用 `wrangler pages deployment rollback`：
#   实测 wrangler 4.135.0 的 `wrangler pages deployment --help` 只有
#   list / create / tail / delete 四个子命令，没有 rollback；
#   `wrangler pages deployments` 也不存在。所以回滚走 Cloudflare REST API：
#   POST /accounts/{account_id}/pages/projects/{project}/deployments/{id}/rollback
#   （官方文档：Pages › Projects › Deployments › rollback，需 Pages Write 权限）
#
# 用法：
#   ./scripts/rollback.sh                  # 只读：列出最近 5 次部署（默认，不改任何东西）
#   ./scripts/rollback.sh -n 10            # 只读：列最近 10 次
#   ./scripts/rollback.sh --dry-run <id>   # 只读：校验部署存在并打印将要发的请求
#   ./scripts/rollback.sh <id>             # 回滚到该部署（交互确认；非交互须加 --yes）
#   ./scripts/rollback.sh --yes <id>       # 跳过确认（CI 用，慎用）
#
# 项目名取自 scripts/deploy.sh 的 --project-name logic；可用 -p/--project 或 PAGES_PROJECT 覆盖。
#
# 凭据：优先 ~/.wrangler/.env（API Token，与 deploy.sh 同款，权限应 600）；
#       没有该文件时 wrangler 走 OAuth 只能列列表，回滚会明确报错。
set -euo pipefail

# ⚠️ 必须先清掉当前 shell 里的这两个变量：本机它们指向 magpie 网关 token，
#    传给 wrangler / Cloudflare API 会报 Authentication error [code: 10000]。
#    清掉后再从 ~/.wrangler/.env 读取真正的 Cloudflare 凭据。
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

PROJECT="${PAGES_PROJECT:-logic}"
ACCOUNT_ID_DEFAULT="8c37390eb04c22752a9f04023bd03498"
ENV_FILE="${WRANGLER_ENV_FILE:-$HOME/.wrangler/.env}"
API="https://api.cloudflare.com/client/v4"
LIMIT=5
DRY_RUN=0
ASSUME_YES=0
TARGET=""

usage() {
  cat <<'EOF'
用法：
  ./scripts/rollback.sh                  # 只读：列出最近 5 次部署（默认，不改任何东西）
  ./scripts/rollback.sh -n 10            # 只读：列最近 10 次
  ./scripts/rollback.sh --dry-run <id>   # 只读：校验部署存在并打印将要发的请求
  ./scripts/rollback.sh <id>             # 回滚到该部署（交互确认；非交互须加 --yes）
  ./scripts/rollback.sh --yes <id>       # 跳过确认（CI 用，慎用）

选项：
  -n, --limit N     列出的部署条数（默认 5）
  -p, --project     项目名（默认 logic，取自 deploy.sh）
      --dry-run     只预演，不发回滚请求
  -y, --yes         非交互确认（无 TTY 时必须显式加）
  -h, --help        显示本帮助
EOF
}

die() { echo "❌ $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--limit)  [[ $# -ge 2 ]] || die "$1 需要数字参数"; LIMIT="$2"; shift 2 ;;
    -p|--project) [[ $# -ge 2 ]] || die "$1 需要项目名"; PROJECT="$2"; shift 2 ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    -*)          echo "❌ 未知参数：$1" >&2; usage >&2; exit 2 ;;
    *)           [[ -z "$TARGET" ]] || die "只能指定一个 deployment_id"; TARGET="$1"; shift ;;
  esac
done

[[ "$LIMIT" =~ ^[0-9]+$ ]] && [[ "$LIMIT" -ge 1 ]] || die "--limit 必须是正整数：$LIMIT"
command -v wrangler >/dev/null 2>&1 || die "找不到 wrangler（npm i -g wrangler）"
command -v python3  >/dev/null 2>&1 || die "找不到 python3"
command -v curl     >/dev/null 2>&1 || die "找不到 curl"

# 读取本地真实凭据（deploy.sh 同款）。注意：这里会重新设置 CLOUDFLARE_*，
# 但值来自受信的 600 权限文件，不是上面清掉的网关 token。
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
ACCOUNT_ID="${CF_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-$ACCOUNT_ID_DEFAULT}}"

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/fae_rollback.XXXXXX")"
trap 'rm -rf "$TMPD"' EXIT
LIST_JSON="$TMPD/deployments.json"
LIST_ERR="$TMPD/deployments.err"

echo "📋 项目 ${PROJECT}（账号 ${ACCOUNT_ID}）— 最近 ${LIMIT} 次部署"
if ! wrangler pages deployment list --project-name "$PROJECT" --json \
      >"$LIST_JSON" 2>"$LIST_ERR"; then
  sed -n '1,15p' "$LIST_ERR" >&2
  if grep -q '10000' "$LIST_ERR"; then
    echo "💡 这是凭据问题：确认已 unset 网关 token，且 $ENV_FILE 里是 Cloudflare API Token。" >&2
  fi
  die "读取部署列表失败"
fi

# 当前生产部署 id（只读；用于在列表里标记，取不到就留空）
prod_id() {
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo ""; return 0; }
  curl -sS --max-time 20 \
    "$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>/dev/null \
    | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(((d.get("result") or {}).get("canonical_deployment") or {}).get("id") or "")
except Exception:
    print("")' || echo ""
}
PROD_ID="$(prod_id)"

python3 - "$LIST_JSON" "$LIMIT" "$PROD_ID" <<'PY'
import json, sys
path, limit, prod = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"❌ 无法解析 wrangler 输出：{e}", file=sys.stderr)
    sys.exit(1)
if not isinstance(data, list):
    print("❌ wrangler 输出不是列表", file=sys.stderr)
    sys.exit(1)
if not data:
    print("（没有任何部署记录）")
    sys.exit(0)
print(f"{'#':>2}  {'DEPLOYMENT_ID':<36}  {'ENV':<10} {'BRANCH':<7} {'STATUS':<15} PREVIEW URL")
print("-" * 118)
for i, d in enumerate(data[:limit], 1):
    did = d.get("Id", "")
    mark = "  ← 当前生产" if prod and did == prod else ""
    print(f"{i:>2}  {did:<36}  {(d.get('Environment') or '').lower():<10} "
          f"{(d.get('Branch') or '-'):<7} {(d.get('Status') or '-'):<15} "
          f"{d.get('Deployment') or ''}{mark}")
PY

if [[ -z "$TARGET" ]]; then
  echo
  echo "只读模式：未做任何修改。"
  echo "回滚到某次部署：$0 <deployment_id>        （非交互需加 --yes；先 --dry-run 预演）"
  exit 0
fi

# 允许用 id 前缀（最近列表内唯一匹配）；完整 UUID 直接放行
RESOLVED="$(python3 - "$LIST_JSON" "$TARGET" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
t = sys.argv[2].strip().lower()
ids = [d.get("Id", "") for d in data]
exact = [i for i in ids if i.lower() == t]
prefix = [i for i in ids if i.lower().startswith(t)]
print((exact or prefix or [""])[0] if len(exact or prefix) == 1 else "")
PY
)"
if [[ -n "$RESOLVED" ]]; then
  TARGET="$RESOLVED"
else
  [[ "$TARGET" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
    || die "最近 $LIMIT 次部署里找不到唯一匹配 '$TARGET'；请给完整 deployment_id"
fi

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] \
  || die "回滚需要 API Token：请在 $ENV_FILE 写入 CLOUDFLARE_API_TOKEN（Pages Write 权限）"

# 只读确认目标部署存在，并展示它是什么
DETAIL="$TMPD/detail.json"
HTTP="$(curl -sS --max-time 30 -o "$DETAIL" -w '%{http_code}' \
  "$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/$TARGET" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")" || die "查询部署详情失败（网络？）"
if [[ "$HTTP" != "200" ]]; then
  python3 - "$DETAIL" "$HTTP" <<'PY' >&2 || true
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
print(f"❌ 查询部署失败 HTTP {sys.argv[2]}")
try:
    d = json.loads(raw)
    for e in d.get("errors") or []:
        print(f"   code {e.get('code')}: {e.get('message')}")
except Exception:
    print(raw[:500])
PY
  exit 1
fi
python3 - "$DETAIL" <<'PY'
import json, sys
r = (json.load(open(sys.argv[1], encoding="utf-8")).get("result") or {})
meta = ((r.get("deployment_trigger") or {}).get("metadata") or {})
print("🎯 目标部署")
print(f"   id       : {r.get('id')}")
print(f"   环境     : {r.get('environment')}")
print(f"   创建时间 : {r.get('created_on')}")
print(f"   分支/提交: {meta.get('branch') or '-'} / {(meta.get('commit_hash') or '-')[:12]}")
print(f"   预览地址 : {r.get('url')}")
PY

PROD_ID="$(prod_id)"
if [[ -n "$PROD_ID" && "$PROD_ID" == "$TARGET" ]]; then
  echo "ℹ️ 该部署已经是当前生产，无需回滚。"
  exit 0
fi

ROLLBACK_URL="$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/$TARGET/rollback"
if [[ "$DRY_RUN" == "1" ]]; then
  echo
  echo "🧪 DRY-RUN：将执行以下只读预演（未发送请求，生产未变更）"
  echo "   POST $ROLLBACK_URL"
  echo "   Authorization: Bearer \$CLOUDFLARE_API_TOKEN"
  echo "   如需真正回滚：$0 $TARGET"
  exit 0
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  [[ -t 0 ]] || die "非交互模式拒绝执行回滚；确认无误请加 --yes"
  read -r -p "⚠️ 确认把生产回滚到 $TARGET ？输入 yes 继续：" ans
  [[ "$ans" == "yes" ]] || { echo "已取消，生产未变更。"; exit 1; }
fi

RESP="$TMPD/rollback.json"
HTTP="$(curl -sS --max-time 60 -o "$RESP" -w '%{http_code}' -X POST "$ROLLBACK_URL" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")" \
  || die "回滚请求发送失败（网络？）"

python3 - "$RESP" "$HTTP" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
code = sys.argv[2]
try:
    d = json.loads(raw)
except Exception:
    print(f"❌ 回滚失败 HTTP {code}，响应无法解析：{raw[:400]}", file=sys.stderr)
    sys.exit(1)
if not d.get("success"):
    print(f"❌ 回滚失败 HTTP {code}", file=sys.stderr)
    for e in d.get("errors") or []:
        print(f"   code {e.get('code')}: {e.get('message')}", file=sys.stderr)
        if e.get("code") == 10000:
            print("   💡 凭据无效：确认已 unset 网关 token，且 ~/.wrangler/.env 是 Cloudflare API Token。",
                  file=sys.stderr)
    sys.exit(1)
r = d.get("result") or {}
print(f"✅ 回滚请求成功（HTTP {code}）")
print(f"   deployment: {r.get('id') or '(接口未返回 id)'}")
print(f"   url       : {r.get('url') or '-'}")
PY

# 读回生产状态（只读），确认当前生产指向
PROD_AFTER="$TMPD/prod_after.json"
curl -sS --max-time 30 -o "$PROD_AFTER" \
  "$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments?env=production&per_page=1" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" >/dev/null 2>&1 || true
python3 - "$PROD_AFTER" "$TARGET" "$PROJECT" <<'PY' || true
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    r = (d.get("result") or [{}])[0]
except Exception:
    sys.exit(0)
target, project = sys.argv[2], sys.argv[3]
print(f"🔎 当前生产最新部署：{r.get('id')}（{r.get('created_on')}）")
if r.get("id") == target:
    print("✅ 已确认生产指向回滚目标。")
else:
    print(f"ℹ️ 生产最新记录与目标 id 不同（Cloudflare 可能新建了一条回滚记录）。")
print(f"🌐 https://{project}-qbu.pages.dev")
PY
