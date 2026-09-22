#!/bin/bash
# 快速部署：datasheets(PDF 183MB不变)移出再传，省90%时间
cd ~/fae-knowledge-web
mv datasheets /tmp/datasheets_hold 2>/dev/null
mv datasheets_view /tmp/datasheets_view_hold 2>/dev/null
wrangler pages deploy . --project-name logic --branch main --commit-dirty=true 2>&1 | tail -3
mv /tmp/datasheets_hold datasheets 2>/dev/null
mv /tmp/datasheets_view_hold datasheets_view 2>/dev/null
echo "PDF已移回"
