#!/usr/bin/env python3
"""尺寸最终归一：让每个型号的 package_size 与其封装在权威字典中的尺寸一致。
- 权威尺寸源：data/quality.json 的 package_detail（来自 wiki/_meta/package-dimensions.md）
- 消除"同封装多尺寸"污染（错配残留）
用法: python3 scripts/normalize_package_size.py [--write]
"""
import json, os, re, sys
from collections import Counter, defaultdict

W = os.path.expanduser('~/fae-knowledge-web')


def canon_size(pd_row):
    """由字典行生成统一尺寸文本。"""
    body, hmax = pd_row.get('body', ''), pd_row.get('hmax', '')
    if body in ('—', '', '尺寸未在datasheet提供'):
        body = '尺寸未在datasheet提供'
    else:
        body = body + ' mm' if re.match(r'^[\d.]', body) else body
    if hmax not in ('—', '', None):
        return f'{body}；{hmax} mm (Max) height'
    return body


def main():
    prod = json.load(open(f'{W}/data/products.json', encoding='utf-8'))
    q = json.load(open(f'{W}/data/quality.json', encoding='utf-8'))
    detail = {r['pkg']: r for r in q.get('package_detail', [])}
    print(f'权威封装字典行: {len(detail)}')

    fixed = Counter()
    for p in prod:
        pk = p.get('package') or ''
        row = detail.get(pk)
        if not row:
            continue
        want = canon_size(row)
        cur = (p.get('package_size') or '').strip()
        if cur != want:
            fixed[pk] += 1
            p['package_size'] = want

    print(f'尺寸统一: {sum(fixed.values())} 条')
    for k, n in fixed.most_common(15):
        print(f'  {k:18s} {n}')

    # 复查污染
    pk2sz = defaultdict(Counter)
    for p in prod:
        pk2sz[p['package']][p.get('package_size') or '(空)'] += 1
    multi = {k: c for k, c in pk2sz.items() if len([x for x in c if x != '(空)']) > 1}
    print(f'\n复查: 同封装多尺寸 = {len(multi)}')
    for k, c in list(multi.items())[:6]:
        print(f'  {k}: {dict(c)}')

    if '--write' in sys.argv:
        json.dump(prod, open(f'{W}/data/products.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('已写回')


if __name__ == '__main__':
    main()
