#!/usr/bin/env python3
"""按修正后的 package 重新归并 package_size（含 package 已变更的型号）。
- 基准：所有型号里该封装的最高频尺寸文本。
- 凡 package 与修正前不同者，尺寸一律改为新封装的主流尺寸。
用法: python3 scripts/renorm_package_size.py --before /tmp/products_before_fix.json [--write]
"""
import json, os, sys
from collections import Counter, defaultdict

path = os.path.expanduser('~/fae-knowledge-web/data/products.json')
prod = json.load(open(path, encoding='utf-8'))
before_path = '/tmp/products_before_fix.json'
for i, a in enumerate(sys.argv):
    if a == '--before' and i + 1 < len(sys.argv):
        before_path = sys.argv[i + 1]
before = json.load(open(before_path, encoding='utf-8'))
old_pkg = {p['model']: p.get('package') for p in before}

# 每个封装的主流尺寸（排除 None/—）
pk_sizes = defaultdict(Counter)
for p in prod:
    sz = (p.get('package_size') or '').strip()
    if sz and sz != '—':
        pk_sizes[p['package']][sz] += 1
canon_size = {pk: c.most_common(1)[0][0] for pk, c in pk_sizes.items()}

fixed = 0
for p in prod:
    pk = p.get('package') or '未知'
    want = canon_size.get(pk)
    if not want:
        continue
    changed_pkg = old_pkg.get(p['model']) != pk
    cur = (p.get('package_size') or '').strip()
    if changed_pkg or not cur or cur == '—':
        if cur != want:
            p['package_size'] = want
            fixed += 1

print(f'封装配对尺寸: {len(canon_size)} 个封装; 修正尺寸: {fixed} 条')
if '--write' in sys.argv:
    json.dump(prod, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('已写回')
else:
    print('(dry-run)')
