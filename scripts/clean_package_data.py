#!/usr/bin/env python3
"""封装数据最终清洗：统一命名 + 按尾缀确定性归一 + 剔除残片。
规则优先级：
  1) 已有 PDF 订购表实证的封装（/tmp/pkg_rebuild.json）→ 直接采用
  2) 尾缀 → 封装的确定性映射（字典/PDF 互证），用于 PDF 未覆盖的型号
  3) 残片/多封装合并 → 取主封装
用法: python3 scripts/clean_package_data.py [--write]
"""
import json, os, re, sys
from collections import Counter

W = os.path.expanduser('~/fae-knowledge-web')

# 尾缀 → 封装（PDF 与 wiki 字典互证；同尾缀多引脚数取最常见）
# 参考: EM74LVC1G00GM=DFN1x1.45-6L, GV=SOT23-5L, GS=DFN1x1-6L, GX=DFN0.8x0.8-4L
SFX2PKG = {
    'GV': 'SOT23-5L', 'GW': 'SOT353', 'GS': 'DFN1x1-6L', 'GM': 'DFN1x1.45-6L',
    'GX': 'DFN0.8x0.8-4L', 'DRL': 'SOT553', 'DRC': 'DFN3x3-10L', 'DRB': 'QFN1.4x1.8-10L',
    'D': 'SOP-14L', 'AD': 'SOP-14L', 'DB': 'SSOP-16L', 'DC': 'VSSOP-8L',
    'PW': 'TSSOP-14L', 'APW': 'TSSOP-14L', 'MS': 'MSOP-10L',
    'UD': 'QFN3x3-16L', 'Q': 'QFN1.8x2.6-16L', 'N': 'QFN2x3-18L',
    'YFQ': 'WLCSP4', 'YFC': 'WLCSP-12L', 'YFG': 'WLCSP-9',
    'RSW': 'QFN1.4x1.8-10L', 'RSE': 'QFN1.5x2.0-10L', 'RSB': 'QFN5x5-40L',
    'RSV': 'QFN1.8x2.6-16L', 'RSA': 'QFN1.7x2-12L', 'RGY': 'QFN3.5x3.5-14L',
}
# 引脚数 → 同族封装（SOP/TSSOP/SSOP 按 14/16/20/24 区分）
NUM_UP = {14: '14L', 16: '16L', 20: '20L', 24: '24L'}

# 残片/别名 → 规范名
ALIAS = {
    'DFN0.8x0.8-': 'DFN0.8x0.8-4L',
    'DFN1.45x1-6L': 'DFN1x1.45-6L',
    'MSOP3.0x3.0-10L': 'MSOP-10L',
    'X2SON': 'WLCSP-9',                 # 字典: WLCSP-9 即 X2SON 尺寸 1.17×1.17
    'QFN-16L': 'QFN3x3-16L',
    'QFN-10L': 'QFN1.4x1.8-10L',
    'QFN-40L': 'QFN5x5-40L',
    'SOT23-6L/SOT363/DFN6L': 'SOT363',  # 多封装合并 → 取主封装
}


def main():
    prod = json.load(open(f'{W}/data/products.json', encoding='utf-8'))
    rebuild = json.load(open('/tmp/pkg_rebuild.json', encoding='utf-8'))
    rb = {k: v['package'] for k, v in rebuild.items() if v.get('package')}

    changed = Counter()
    for p in prod:
        model, old = p['model'], p.get('package') or ''
        new = old
        # 1) PDF 实证
        if model in rb:
            new = rb[model]
        # 2) 残片/别名
        if new in ALIAS:
            new = ALIAS[new]
        # 3) SOT23 裸名 / 单字母尾缀等 → 按尾缀确定性映射
        if new in ('SOT23', 'sc', 'SC', '') or re.match(r'^SOT23$', new):
            mm = re.search(r'([A-Z]{2,3})(-Q100)?$', model)
            sfx = mm.group(1) if mm else ''
            if sfx in SFX2PKG:
                new = SFX2PKG[sfx]
            else:
                # 按引脚数从型号推断（如 EM74LVC1G00GM 的 GM 已覆盖；兜底 SOT23-5L）
                new = 'SOT23-5L'
        # 统一尾号 L
        if re.match(r'^[A-Z]+[\d.x]*-?\d+$', new) and not new.endswith('L') and new not in ('SOT23', 'SOT353', 'SOT363', 'SOT553', 'SOT563'):
            pass  # 保留 PDF 原文，不强补
        if new != old:
            changed[(old, new)] += 1
            p['package'] = new

    print(f'封装变更: {sum(changed.values())} 条')
    for (o, n), c in changed.most_common(30):
        print(f'  {o!r} -> {n!r}  ({c})')
    after = Counter(p.get('package') for p in prod)
    print(f'\n清洗后封装种类: {len(after)}')
    for k, n in after.most_common(50):
        print(f'  {n:4d}× {k}')

    if '--write' in sys.argv:
        json.dump(prod, open(f'{W}/data/products.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('已写回 products.json')


if __name__ == '__main__':
    main()
