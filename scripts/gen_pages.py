#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成三个栏目的数据：
  data/apps.json    —— 应用场景 → 型号
  data/docs.json    —— 技术文档索引（规格书/引脚图/应用电路）
  data/quality.json —— 质量与可靠性（温度等级/封装/状态）
"""
import json, re
from collections import Counter, defaultdict, OrderedDict
from pathlib import Path

W = Path('/Users/hu/fae-knowledge-web/data')
prod = json.load(open(W / 'products.json', encoding='utf-8'))

# ---------- ⓿ 电平转换器：按「几位」而非「几路」分组 ----------
# 型号内数字 = 通道位数（EXS0102=2bit / 0104=4bit / 0106=6bit / 0108=8bit）
# 引脚数佐证：0102 用 8 脚、0104 用 14 脚、0106 用 16 脚、0108 用 20 脚
BIT_RE = re.compile(r'^EXS(\d{2})(\d{2})')


def bit_of(model):
    """电平转换器的通道位宽；返回如 '2 位' / '4 位'，非转换器返回空"""
    m = BIT_RE.match(model or '')
    if not m:
        return ''
    n = int(m.group(2))
    return (str(n) + ' 位') if 1 <= n <= 16 else ''


# 修正 products 里被误标为「双路」的电平转换描述
_fixed = 0
for p in prod:
    b = bit_of(p.get('model'))
    if not b:
        continue
    want_fn = b + '电平转换收发器'
    want_desc = b + '双向电平转换收发器'
    if p.get('function_detail') != want_fn:
        p['function_detail'] = want_fn
        _fixed += 1
    if p.get('description') != want_desc:
        p['description'] = want_desc
print(f'电平转换位宽修正: {_fixed} 款')

# ---------- 引脚图改指 WebP（省 58% 体积；PNG 保留作兜底） ----------
_pin_ok = 0
for p in prod:
    pi = p.get('pin_image')
    if not pi:
        continue
    webp_path = pi.replace('/pins/', '/pins_webp/').replace('.png', '.webp')
    disk = str(Path('/Users/hu/fae-knowledge-web') / webp_path.lstrip('./'))
    if Path(disk).exists():
        p.pop('pin_image_png', None)   # 不再保留 PNG 兜底（WebP 浏览器支持率 >97%）
        p['pin_image'] = webp_path
        _pin_ok += 1
print(f'引脚图改 WebP: {_pin_ok} 款')

# 落盘修正后的 products（保持缩进格式不变）
json.dump(prod, open(W / 'products.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

# ---------- ① 应用 ----------
apps = defaultdict(list)
for p in prod:
    raw = str(p.get('applications') or '')
    doms = p.get('applications_domains') or []
    if isinstance(doms, str): doms = [doms]
    names = []
    for x in raw.replace('；', ';').split(';'):
        x = x.strip()
        if x: names.append(x)
    for x in doms:
        x = str(x).strip()
        if x and x not in names: names.append(x)
    for n in names:
        apps[n].append({
            'm': p['model'], 'fn': p.get('function') or '',
            'se': p.get('series') or '', 'pk': p.get('package') or '',
            'vc': p.get('voltage') or '',
        })

app_items = []
for name, ms in sorted(apps.items(), key=lambda kv: -len(kv[1])):
    seen, uniq = set(), []
    for m in ms:
        if m['m'] in seen: continue
        seen.add(m['m']); uniq.append(m)
    app_items.append({'name': name, 'count': len(uniq), 'models': sorted(uniq, key=lambda x: x['m'])})

json.dump({'generated': None, 'total': len(app_items),
           'total_models': len(prod), 'items': app_items},
          open(W / 'apps.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------- ② 技术文档 ----------
docs = []
for p in prod:
    m = p['model']
    rec = {
        'm': m, 'fn': p.get('function') or '', 'se': p.get('series') or '',
        'pk': p.get('package') or '',
        'ds': bool(p.get('source_document_id')),
        'pin': p.get('pin_image') or '',
    }
    docs.append(rec)

# 规格书文件实际存在性
base = Path('/Users/hu/fae-knowledge-web')
ds_dir = base / 'datasheets'
doc_stats = {
    'total': len(docs),
    'with_ds': sum(1 for d in docs if d['ds']),
    'with_pin': sum(1 for d in docs if d['pin']),
}
json.dump({'generated': None, 'stats': doc_stats, 'items': docs},
          open(W / 'docs.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------- ③ 质量 ----------
temp = Counter()
pkg = Counter()
status = Counter()
logic = Counter()
by_series = defaultdict(lambda: {'n': 0, 'temp': Counter(), 'pkg': Counter()})
for p in prod:
    t = p.get('temp_range') or '未标注'
    k = p.get('package') or '未标注'
    st = p.get('status') or '未标注'
    lt = p.get('logic_type') or ''
    temp[t] += 1; pkg[k] += 1; status[st] += 1; logic[lt] += 1
    s = p.get('series') or '未标注'
    by_series[s]['n'] += 1
    by_series[s]['temp'][t] += 1
    by_series[s]['pkg'][k] += 1

# 封装 × 尺寸对照（真实数据）
pk_size = defaultdict(Counter)
for p in prod:
    pk_size[p.get('package') or '未标注'][p.get('package_size') or '—'] += 1
pk_rows = []
for name, cnt in pkg.most_common():
    sizes = pk_size[name].most_common()
    size = sizes[0][0] if sizes else '—'
    pk_rows.append({'k': name, 'n': cnt, 'size': size})

# 封装 × 温度交叉
pk_temp = defaultdict(Counter)
for p in prod:
    pk_temp[p.get('package') or '未标注'][p.get('temp_range') or '未标注'] += 1

quality = {
    'generated': None,
    'total': len(prod),
    'temp': [{'k': k, 'n': v} for k, v in temp.most_common()],
    'package': pk_rows,
    'status': [{'k': k, 'n': v} for k, v in status.most_common()],
    'logic_type': [{'k': k, 'n': v} for k, v in logic.most_common()],
    'by_series': [{'k': s, 'n': d['n'],
                   'temp': [{'k': a, 'n': b} for a, b in d['temp'].most_common()],
                   'pkg': [{'k': a, 'n': b} for a, b in d['pkg'].most_common(6)]}
                  for s, d in sorted(by_series.items(), key=lambda kv: -kv[1]['n'])],
}
# ---------- 尾缀 → 封装 对照（真实数据推导） ----------
# 规律：尾缀标识封装形式，具体引脚数决定完整型号
FAMILY = OrderedDict([
    ('PW',  ('TSSOP',      '薄型小外形')),
    ('APW', ('TSSOP',      '薄型小外形')),
    ('D',   ('SOP',        '小外形')),
    ('AD',  ('SOP',        '小外形')),
    ('ADB', ('SSOP',       '缩小型小外形')),
    ('DB',  ('SSOP',       '缩小型小外形')),
    ('DC',  ('VSSOP',      '超小外形')),
    ('GW',  ('SOT-353/363/553/563', '超小外形晶体管封装')),
    ('DRL', ('SOT-553/563', '超小外形')),
    ('GV',  ('SOT-23-5/6',  '小外形晶体管封装')),
    ('GM',  ('SOT-23 / DFN', '小外形')),
    ('GS',  ('DFN',        '双侧无引脚扁平')),
    ('GX',  ('DFN 0.8×0.8', '微型双侧无引脚')),
    ('MS',  ('MSOP',       '微型小外形')),
    ('DCN', ('SOT-23-8',   '小外形晶体管封装')),
    ('RSW', ('QFN 1.4×1.8', '方形扁平无引脚')),
    ('RSE', ('QFN 1.5×2.0', '方形扁平无引脚')),
    ('RSB', ('QFN 5×5',    '方形扁平无引脚')),
    ('RSV', ('QFN 1.8×2.6', '方形扁平无引脚')),
    ('RSA', ('QFN 1.7×2',  '方形扁平无引脚')),
    ('RGY', ('QFN 3.5×3.5', '方形扁平无引脚')),
    ('DRC', ('DFN 3×3',    '双侧无引脚扁平')),
    ('DRB', ('QFN 1.4×1.8', '方形扁平无引脚')),
    ('UD',  ('QFN 3×3',    '方形扁平无引脚')),
    ('N',   ('QFN 2×3',    '方形扁平无引脚')),
    ('Q',   ('QFN 1.8×2.6', '方形扁平无引脚')),
    ('YFQ', ('WLCSP-4',    '晶圆级芯片尺寸')),
    ('YFC', ('WLCSP-12',   '晶圆级芯片尺寸')),
    ('YFG', ('WLCSP-9',    '晶圆级芯片尺寸')),
])

sfx = defaultdict(lambda: {'n': 0, 'pkgs': Counter(), 'models': []})
for p in prod:
    m = p['model']
    mm = re.search(r'([A-Z]+)(-Q100)?$', m)
    if not mm:
        continue
    s = mm.group(1)
    sfx[s]['n'] += 1
    sfx[s]['pkgs'][p.get('package') or '?'] += 1
    if len(sfx[s]['models']) < 3:
        sfx[s]['models'].append(m)

suffix_rows = []
for s, d in sorted(sfx.items(), key=lambda kv: -kv[1]['n']):
    pk = d['pkgs'].most_common(1)[0][0]
    fam, desc = FAMILY.get(s, ('—', '—'))
    suffix_rows.append({
        'sfx': s, 'n': d['n'], 'pkg': pk, 'family': fam, 'desc': desc,
        'variants': [{'k': a, 'n': b} for a, b in d['pkgs'].most_common()],
        'sample': d['models'][0],
    })
quality['suffix'] = suffix_rows

json.dump(quality, open(W / 'quality.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

print(f'应用: {len(app_items)} 个场景')
print(f'文档: {doc_stats}')
print(f'质量: 温度 {len(temp)} 档 / 封装 {len(pkg)} 种 / 状态 {len(status)} 种')

# ---------- 拆分：products_lite.json + specs.json ----------
# specs（电气参数表）占 products.json 体积 95%，但只在下钻详情页时用。
# 拆开后首屏只拉 446KB（原 4.16MB）。前端 app.js 用 ensureSpecs() 懒加载。
_lite = [{k: v for k, v in it.items() if k != 'specs'} for it in prod]
_specs = {str(it['id']): it['specs'] for it in prod if it.get('specs')}
json.dump(_lite, open(W / 'products_lite.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
json.dump(_specs, open(W / 'specs.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print(f'拆分: products_lite {len(_lite)} 款 / specs {len(_specs)} 份 ' +
      f'({(W / "products_lite.json").stat().st_size // 1024}KB + ' +
      f'{(W / "specs.json").stat().st_size // 1024}KB)')
