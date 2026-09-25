#!/usr/bin/env python3
"""封装名归一化：统一大小写符号与尾号 L，消除同一封装的多种写法。
规则：
  - 统一为 无空格、用 × 表示乘号、字母大写、"DFN"/"QFN"/"SOT" 等前缀大写
  - 带引脚数的补 L 尾（SOT23-5 → SOT23-5L 等，SOT353 这类本身无引脚数的不动）
  - 多封装合并（含 /）保留原样（另行人工确认）
用法: python3 scripts/norm_package_names.py [--write]
"""
import json, os, re, sys
from collections import Counter

path = os.path.expanduser('~/fae-knowledge-web/data/products.json')
prod = json.load(open(path, encoding='utf-8'))


# 已知残片/别名 → 正确封装名
ALIAS = {'sc': 'TSSOP-24L'}


def canon(pk):
    s = (pk or '').strip()
    if not s:
        return s
    if s.lower() in ALIAS:
        return ALIAS[s.lower()]
    if '/' in s:                      # 多封装合并，保留
        return s
    # 统一乘号与空格
    s = re.sub(r'\s*[xX]\s*', 'x', s)
    s = re.sub(r'\s*×\s*', 'x', s)
    s = re.sub(r'\s*-\s*', '-', s)
    s = re.sub(r'\s+', '', s)
    # 前缀大写
    m = re.match(r'^([A-Za-z]+)(.*)$', s)
    if m:
        s = m.group(1).upper() + m.group(2)
    # 尾号 L 统一：对 SOP/TSSOP/SSOP/MSOP/VSSOP/QFN/DFN/SOT23/N 这类带 -数字 的补 L
    m2 = re.match(r'^([A-Z]+[\d.x]*)x([\d.]+)-(\d+)$', s)     # 如 QFN1.4x1.8-10 → ...-10L
    if m2:
        s = f'{m2.group(1)}x{m2.group(2)}-{m2.group(3)}L'
    else:
        m3 = re.match(r'^([A-Z]+)-(\d+)$', s)                   # SOP-16 → SOP-16L
        if m3 and m3.group(1) in ('SOP', 'TSSOP', 'SSOP', 'MSOP', 'VSSOP', 'TVSOP', 'QFN', 'DFN'):
            s = f'{m3.group(1)}-{m3.group(2)}L'
        m4 = re.match(r'^SOT23-([0-9]+)$', s)                   # SOT23-5 → SOT23-5L
        if m4:
            s = f'SOT23-{m4.group(1)}L'
    return s


before = Counter(p.get('package') for p in prod)
changes = Counter()
for p in prod:
    old = p.get('package')
    new = canon(old)
    if old != new:
        changes[(old, new)] += 1
        p['package'] = new

print(f'重命名种类: {len(changes)}')
for (o, n), c in changes.most_common(40):
    print(f'  {o!r} -> {n!r}  ({c} 款)')
after = set(p.get('package') for p in prod)
print(f'归一化后封装种类: {len(after)}')

if '--write' in sys.argv:
    json.dump(prod, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('已写回')
else:
    print('(dry-run)')
