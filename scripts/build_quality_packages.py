#!/usr/bin/env python3
"""从 wiki 权威字典 (package-dimensions.md) + PDF 订购表重建 quality.json 的封装表。
- 封装名：以 PDF 订购表原文为准（SOP-14L / SOT23-5L ...）
- 尺寸/引脚数/高度/pitch：以 wiki/_meta/package-dimensions.md（197份datasheet逐字抄录）为准
输出: data/quality.json 的 package 字段（重编排）。
用法: python3 scripts/build_quality_packages.py [--write]
"""
import json, os, re, sys
from collections import defaultdict

W = os.path.expanduser('~/fae-knowledge-web')
DICT_MD = os.path.expanduser('~/wiki/_meta/package-dimensions.md')


def parse_dict():
    """解析封装尺寸字典 → {规范代码: {...}}"""
    rows = {}
    for line in open(DICT_MD, encoding='utf-8'):
        if not line.startswith('|') or line.startswith('|---') or '封装代码' in line:
            continue
        c = [x.strip() for x in line.strip('|').split('|')]
        if len(c) < 8:
            continue
        rows[c[0]] = {
            'code': c[0], 'official_name': c[1], 'pins': c[2],
            'body': c[3], 'hmax': c[4], 'pitch': c[6],
        }
    return rows


def main():
    prod = json.load(open(f'{W}/data/products.json', encoding='utf-8'))
    D = parse_dict()
    print(f'字典封装: {len(D)}')

    # 统计每个封装名：款数 + 引脚数（从字典映射）
    pk_cnt = defaultdict(int)
    for p in prod:
        pk_cnt[p.get('package') or '未标注'] += 1

    # 建「PDF名 → 字典行」映射
    def dict_lookup(pk):
        base = re.sub(r'L$', '', pk or '')
        # 直接命中
        if base in D:
            return D[base]
        # SOP-14 → 字典 SSOP-14（字典把 PDF 的 small outline 记为 SSOP）
        m = re.match(r'^SOP-(\d+)$', base)
        if m and f'SSOP-{m.group(1)}' in D:
            return D[f'SSOP-{m.group(1)}']
        # SOT23-5 → SOT23-5
        return D.get(base)

    out = []
    for pk, n in sorted(pk_cnt.items(), key=lambda kv: -kv[1]):
        row = dict_lookup(pk)
        if row:
            out.append({
                'pkg': pk, 'n': n,
                'pins': row['pins'], 'body': row['body'],
                'hmax': row['hmax'], 'pitch': row['pitch'],
                'official': row['official_name'],
            })
        else:
            out.append({'pkg': pk, 'n': n, 'pins': '—', 'body': '—', 'hmax': '—', 'pitch': '—', 'official': ''})

    print(f'封装行: {len(out)}；命中字典: {sum(1 for r in out if r["pins"] != "—")}')
    for r in out[:20]:
        print(f"  {r['pkg']:18s} {r['n']:4d}款  {r['pins']:3s}脚  {r['body']:12s} 高{r['hmax']:6s}")

    if '--write' in sys.argv:
        qpath = f'{W}/data/quality.json'
        q = json.load(open(qpath, encoding='utf-8'))
        q['package_detail'] = out
        json.dump(q, open(qpath, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print('已写回 quality.json 的 package_detail')


if __name__ == '__main__':
    main()
