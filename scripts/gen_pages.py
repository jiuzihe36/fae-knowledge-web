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

W = Path('/Users/hu/项目/站点/fae-knowledge-web/data')
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
    disk = str(Path('/Users/hu/项目/站点/fae-knowledge-web') / webp_path.lstrip('./'))
    if Path(disk).exists():
        p.pop('pin_image_png', None)   # 不再保留 PNG 兜底（WebP 浏览器支持率 >97%）
        p['pin_image'] = webp_path
        _pin_ok += 1
print(f'引脚图改 WebP: {_pin_ok} 款')

# ---------- ⓿.5 规格书「最新版本号 + 该版本发布日期」注入 ----------
# 数据来自 scripts/extract_ds_meta.py 逐份解析 datasheets/*.pdf 的修订记录表。
# 详情抽屉与「技术文档」列表都读这两个字段（ds_ver / ds_date）。
DS_META_PATH = W / 'ds_meta.json'
DS_META = {}
DS_STATS = {}
if DS_META_PATH.exists():
    _dm = json.load(open(DS_META_PATH, encoding='utf-8'))
    DS_META = _dm.get('items', {})
    DS_STATS = _dm.get('stats', {})
_ds_hit = 0
for p in prod:
    _m = DS_META.get(p.get('source_label') or '')
    if not _m or not _m.get('ver'):
        p.pop('ds_ver', None)
        p.pop('ds_date', None)
        continue
    p['ds_ver'] = 'V' + str(_m['ver'])
    if _m.get('date'):
        p['ds_date'] = _m['date']
    _ds_hit += 1
print(f'规格书版本注入: {_ds_hit} 款型号 ← {len(DS_META)} 份规格书（最新发布 {DS_STATS.get("latest_date")}）')

# 落盘修正后的 products（沿用文件现有缩进风格：sync_from_wiki / clean_package_data 等
# 都写 indent=1，这里若改成紧凑格式会让 products.json 每次同步产生 15 万行格式 diff）
_p_txt = (W / 'products.json').read_text(encoding='utf-8') if (W / 'products.json').exists() else ''
_p_indent = 1 if _p_txt.startswith('[\n ') else None
json.dump(prod, open(W / 'products.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=_p_indent, separators=None if _p_indent else (',', ':'))

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


# ---------- 应用场景：一句话选型说明（前端 app-card 展示） ----------
SCENE_DESC = {
 "通用逻辑门组合": "按功能号（00/02/08/10/11/21/32…）与封装直接对号入座，替换离散逻辑。",
 "总线隔离（三态使能）": "125/126/245/541 三态输出：多主共享总线、上电关断、热插拔隔离。",
 "5V TTL 电平兼容": "HCT/AHCT 的 TTL 阈值（VIH≈2.0 V）：5 V 系统直收 3.3 V 信号，不用另加转换器。",
 "慢边沿/噪声环境整形": "施密特门（HC132/7001/7002/HCS 系列）：边沿再慢也只翻转一次。",
 "信号缓冲与长走线驱动": "1G16/1G34/2G16/2G34 单双路缓冲 + 1G17 施密特缓冲 + 244/541 八路大驱动：信号整形、扇出隔离与长走线。",
 "信号反相": "04/1G04/2G04：普通反相，单门到六门可选；施密特反相见「按键去抖」。",
 "开漏输出与电平转换": "1G07/2G07/HC07 开漏缓冲：线与、上拉到不同电平，或驱动 LED/继电器。",
 "按键去抖与振荡器": "RC + 施密特反相（1G14/2G14/HC14）：机械触点去抖、低成本 RC 振荡。",
 "施密特输入（抗噪声）": "迟滞阈值整形：噪声峰峰值小于 VH 就不会误翻转。",
 "三态反相与总线驱动": "240/540/366/368 三态：反相三态与八路三态缓冲，总线驱动与隔离一体。",
 "数据比较/校验": "86/1G86 异或：比较、奇偶校验、可编程反相。",
 "USB/HDMI 高速信号切换": "按速率选：EMS3902（USB2.0 800MHz）→ EMS4100（10Gbps）→ EMS4422（HDMI2.1 5.7GHz）。",
 "I2C 总线与中断驱动": "开漏缓冲 + 上拉，中断线与；双向总线请配 EXS 自动方向转换。",
 "开漏线与逻辑": "1G09/HC09 开漏与门：多路信号线与，任意一路拉低即生效。",
 "数据锁存与状态保持": "573/574/259/174：总线锁存、地址锁存、状态保持。",
 "串并转换/I/O 扩展": "164/594 串入并出、165/166/597 并入串出：3 根线扩 N×8 路。",
 "通用模拟开关/多路复用": "SPDT/DPDT/多路：按 Ron、带宽、负压摆幅三个指标选。",
 "总线开关与隔离": "CBT/CBTLV 无源总线开关：热插拔隔离、不放大、tpd 0.3 ns。",
 "音频信号切换": "负压摆幅是硬指标：EMS3515/3550/3580/4320 支持负向信号不削波。",
 "I2C/SPI/UART 电平转换": "EXS0102/0104/0106/0108 自动方向：推挽 40 Mbps、开漏 2 Mbps，OE 须下拉。",
 "可配置逻辑（替代多颗门）": "1G57/58/97：一颗替代 2–3 颗门，省 BOM 与面积。",
 "总线双向收发": "8T245/4245：DIR+OE 双电源收发器，两脚都必须有确定电平。",
 "LED/数码管驱动": "595 + 限流电阻：8 路/片，级联扩位，RCLK 锁存避免鬼影。",
 "地址译码与片选": "138 3-8 译码：3 根地址扩 8 个低有效片选，多片级联扩 bank。",
 "单向电平转换（DIR 型）": "1T45 DIR 固定方向：1.2–5.5 V 单 bit；开漏双向总线请改 EXS。",
 "车规应用（AEC-Q100）": "Q100 认证料：EMS3157GW-Q100 / EMS23157MS-Q100，车规项目专用。",
}

app_items = []
for name, ms in sorted(apps.items(), key=lambda kv: -len(kv[1])):
    seen, uniq = set(), []
    for m in ms:
        if m['m'] in seen: continue
        seen.add(m['m']); uniq.append(m)
    app_items.append({'name': name, 'count': len(uniq),
                      'desc': SCENE_DESC.get(name, ''),
                      'models': sorted(uniq, key=lambda x: x['m'])})

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
        # 扩展列：工作电压 / 温度范围 / 工艺类型 / 封装尺寸（供文档表头多列展示）
        'v': (p.get('voltage') or '').replace(' V to ', '–').replace(' V', 'V'),
        't': (p.get('temp_range') or '')
             .replace(' °C to +', '~').replace('°C to +', '~').replace(' °C', '℃').replace('°C', '℃')
             .replace('-40~85℃', '-40~+85℃').replace('-40~125℃', '-40~+125℃'),
        'lt': ('—' if '不适用' in (p.get('logic_type') or '') else (p.get('logic_type') or '')),
        'ps': p.get('package_size') or '',
        # 规格书版本 / 该版本发布日期（照录规格书修订记录，供列表展示与排序）
        'dv': p.get('ds_ver') or '',
        'dd': p.get('ds_date') or '',
    }
    docs.append(rec)

# 规格书文件实际存在性
base = Path('/Users/hu/项目/站点/fae-knowledge-web')
ds_dir = base / 'datasheets'
doc_stats = {
    'total': len(docs),
    'with_ds': sum(1 for d in docs if d['ds']),
    'with_pin': sum(1 for d in docs if d['pin']),
    'ds_files': DS_STATS.get('total', 0),
    'ds_with_ver': DS_STATS.get('with_ver', 0),
    'ds_with_date': DS_STATS.get('with_date', 0),
    'ds_latest': DS_STATS.get('latest_date') or '',
}
json.dump({'generated': None, 'stats': doc_stats, 'items': docs},
          open(W / 'docs.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------- ③ 质量 ----------
temp = Counter()
pkg = Counter()
status = Counter()
logic = Counter()
product_line = Counter()
by_series = defaultdict(lambda: {'n': 0, 'temp': Counter(), 'pkg': Counter()})
def _is_draft(p):
    """产品状态按源规格书判定：文件名含 Draft/Drft → 未量产；其余正式版。
    （products 里的 status 字段历史为空，页面曾整块显示「未标注」）"""
    return bool(re.search(r'draft|drft', p.get('source_label') or '', re.I))

def _product_line(p):
    s = (p.get('series') or '').upper()
    if s == 'EXS':
        return '电平转换'
    if s in ('EMS', 'EL', 'EMBMS'):
        return '模拟开关'
    return '逻辑'

for p in prod:
    t = p.get('temp_range') or '未标注'
    k = p.get('package') or '未标注'
    st = 'Draft（未量产）' if _is_draft(p) else '正式版'
    lt = p.get('logic_type') or ''
    pl = _product_line(p)
    temp[t] += 1; pkg[k] += 1; status[st] += 1; logic[lt] += 1
    product_line[pl] += 1
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
    'generated': __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M'),
    'total': len(prod),
    'temp': [{'k': k, 'n': v} for k, v in temp.most_common()],
    'package': pk_rows,
    'status': [{'k': k, 'n': v} for k, v in status.most_common()],
    'logic_type': [{'k': k, 'n': v} for k, v in logic.most_common()],
    'product_line': [{'k': k, 'n': v} for k, v in product_line.most_common()],
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
    ('GW',  ('SOT-353/363', '超小外形晶体管封装')),
    ('DRL', ('SOT-553/563', '超小外形')),
    ('GV',  ('SOT-23-5/6',  '小外形晶体管封装')),
    ('GM',  ('DFN 1×1.45', '微型双侧无引脚')),
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
    ('ARGY', ('QFN 3.5×3.5', '方形扁平无引脚（A 变体型号，实际尾缀 RGY）')),
    ('GE',  ('DFN',          '双侧无引脚扁平')),
    ('YZP', ('BGA',          '球栅阵列（BGA）')),
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

def _pkg_family(pkg_name):
    """从实际封装名归纳「族名」，用于尾缀表的 family 列。
    依据封装前缀 + 尺寸（不含引脚数），避免同族多引脚数被误判为多族。"""
    import re as _re
    n = (pkg_name or '').upper()
    m = _re.match(r'^(TSSOP|SSOP|VSSOP|MSOP|TVSOP)', n)
    if m:
        return m.group(1)
    m = _re.match(r'^(SOP)', n)
    if m:
        return 'SOP'
    m = _re.match(r'^(SOT23|SOT-23)', n)
    if m:
        return 'SOT-23'
    m = _re.match(r'^(SOT)(\d{3})', n)
    if m:
        return 'SOT-' + m.group(2)
    m = _re.match(r'^(QFN|DFN)([\d.]+)[xX×]([\d.]+)', n)
    if m:
        return f'{m.group(1)} {m.group(2)}×{m.group(3)}'
    m = _re.match(r'^(QFN|DFN)-(\d+)', n)
    if m:
        return m.group(1)
    m = _re.match(r'^(QFN|DFN)$', n)
    if m:
        return m.group(1)
    m = _re.match(r'^(BGA)', n)
    if m:
        return 'BGA'
    m = _re.match(r'^(WLCSP|WCSP|X\d?SON|SC|SOD)', n)
    if m:
        return m.group(1)
    return pkg_name or '—'


suffix_rows = []
for s, d in sorted(sfx.items(), key=lambda kv: -kv[1]['n']):
    pk = d['pkgs'].most_common(1)[0][0]
    fam, desc = FAMILY.get(s, ('—', '—'))
    # family 以实际数据为准（自动归纳，覆盖硬编码，杜绝两尾缀描述重复）
    real_fams = []
    for _pk, _cnt in d['pkgs'].most_common():
        _f = _pkg_family(_pk)
        if _f not in real_fams:
            real_fams.append(_f)
    fam = ' / '.join(real_fams) if real_fams else fam
    suffix_rows.append({
        'sfx': s, 'n': d['n'], 'pkg': pk, 'family': fam, 'desc': desc,
        'variants': [{'k': a, 'n': b} for a, b in d['pkgs'].most_common()],
        'sample': d['models'][0],
    })
quality['suffix'] = suffix_rows

# 保留 package_detail（由 build_quality_packages.py 从 wiki 封装字典生成，勿被本脚本冲掉）
_qpath = W / 'quality.json'
if _qpath.exists():
    try:
        _prev = json.load(open(_qpath, encoding='utf-8'))
        if _prev.get('package_detail'):
            quality['package_detail'] = _prev['package_detail']
    except Exception:
        pass

# ---------- ①b 可靠性（ESD / Latch-up）：data/esd.json 由规格书 Features/ESD 段提取 ----------
try:
    esd = json.load(open(W / 'esd.json', encoding='utf-8'))
except Exception:
    esd = {}
if esd:
    cnt_by_src = {}
    for _p in prod:
        _sl = _p.get('source_label') or ''
        cnt_by_src[_sl] = cnt_by_src.get(_sl, 0) + 1
    hbm, cdm, latch = Counter(), Counter(), Counter()
    covered = 0
    for _sl, _e in esd.items():
        _n = cnt_by_src.get(_sl, 0)
        if _n == 0:
            continue
        if _e.get('hbm') or _e.get('cdm') or _e.get('latchup'):
            covered += _n
        _hc = _e.get('hbm_class') or ''
        hbm[('Class ' + _hc) if _hc else '规格书未列'] += _n
        _cc = _e.get('cdm_class') or ''
        cdm[('Class ' + _cc) if _cc.startswith('C') else (_cc or '规格书未列')] += _n
        latch[_e.get('latch_ma') or '规格书未列'] += _n
    quality['reliability'] = {
        'covered': covered,
        'total': len(prod),
        'hbm': [{'k': k, 'n': v} for k, v in hbm.most_common()],
        'cdm': [{'k': k, 'n': v} for k, v in cdm.most_common()],
        'latch': [{'k': k, 'n': v} for k, v in latch.most_common()],
    }
    print('可靠性: 覆盖 %d/%d 款 | HBM %d 档 / CDM %d 档 / Latch-up %d 档' % (covered, len(prod), len(hbm), len(cdm), len(latch)))

json.dump(quality, open(W / 'quality.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

print(f'应用: {len(app_items)} 个场景')
print(f'文档: {doc_stats}')
print(f'质量: 温度 {len(temp)} 档 / 封装 {len(pkg)} 种 / 状态 ' + ' / '.join(f'{k} {v}' for k, v in status.most_common()) + ' / 产品线 ' + ' / '.join(f'{k} {v}' for k, v in product_line.most_common()))

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
