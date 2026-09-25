#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成主页产品目录树：三大类 → 功能 → 系列 → 型号
输出: ~/fae-knowledge-web/data/catalog.json
结构:
{
  "generated": "...",
  "total": 670,
  "cats": [
    {"key":"logic","name":"74 逻辑","count":573,
     "funcs":[
       {"name":"与非门","count":62,"series":[{"name":"74HC","count":10,
         "models":[{"m":"EM74HC00D","pkg":"SOP-14","vcc":"2.0–6.0 V","detail":"四路2输入与非门","comp":5}]}]}
     ]},
    ...
  ]
}
"""
import json
import re
from pathlib import Path
from collections import OrderedDict, defaultdict
from datetime import datetime

WEB = Path('/Users/hu/fae-knowledge-web')
prod = json.load(open(WEB / 'data' / 'products_lite.json'))

ROUTE_ORDER = ['单路', '双路', '三路', '四路', '六路', '八路', '多路',
               '2 位', '4 位', '6 位', '8 位', '10 位', '12 位', '16 位', '其他']

# 模拟开关按「产品类型」分组（口径来自芯祥官方宣讲 PPT p16-p18）：
#   High/Super Speed Analog Switch / General Analog Switch /
#   High Performance Audio Switch / Audio Ground Switch / Depletion Audio Switch
SWITCH_TYPE = OrderedDict([
    ('高速开关（USB/HDMI）', ['EMS3900', 'EMS3902', 'EMS3905', 'EMS4000', 'EMS4002',
                            'EMS4100', 'EMS4300', 'EMS4422', 'EMS4735', 'EMS4642',
                            'EMS7227', 'EMS3412', 'EMS4310']),
    ('音频开关', ['EMS4320', 'EMS4321', 'EMS4798', 'EMS4521', 'EMS4798C',
                 'EMS3218', 'EMS3580', 'EMS4485']),
    ('耗尽型开关', ['EMS3515', 'EMS3518', 'EMS3550']),
])


def switch_type_of(model):
    """模拟开关的产品类型分组（型号前缀匹配，取最长命中）"""
    mu = (model or '').upper()
    best, hit = '', '通用开关'
    for tname, prefixes in SWITCH_TYPE.items():
        for pf in prefixes:
            if mu.startswith(pf.upper()) and len(pf) > len(best):
                best, hit = pf, tname
    return hit

# 工艺子类：按电压范围客观归类（数据里的 voltage 字段）
PROCESS_GROUPS = OrderedDict([
    ('宽电压 / 低压通用', ['74LVC', '74AUP', '74LV1T']),
    ('5V 系统（TTL 兼容）', ['74HCT', '74AHCT']),
    ('2–6V 通用 CMOS', ['74HC', '74HCS']),
    ('2–5.5V 高速 CMOS', ['74AHC']),
    ('通用模拟开关', ['EMS', 'EL']),
    ('总线开关（TTL 兼容）', ['74CBT']),
    ('电平转换专用', ['EXS']),
])
SERIES2PROC = {}
for g, sl in PROCESS_GROUPS.items():
    for s in sl:
        SERIES2PROC[s] = g


def proc_of(series):
    return SERIES2PROC.get(series, '其他')


BIT_RE = re.compile(r'^EXS(\d{2})(\d{2})')


def bit_of(model):
    """电平转换器：型号内数字 = 通道位数（EXS0102=2位 / 0104=4位 / 0108=8位）"""
    m = BIT_RE.match(model or '')
    if not m:
        return ''
    n = int(m.group(2))
    return (str(n) + " 位") if 1 <= n <= 16 else ''


def parse_route(model, detail):
    """从 detail 优先、型号回退，解析'几路'；电平转换器改按位宽"""
    b = bit_of(model)
    if b:
        return b
    d = str(detail or '')
    for cn in ['十六路', '单路', '双路', '三路', '四路', '六路', '八路']:
        if cn in d:
            return cn if cn != '十六路' else '八路'
    # 开头是数量字就取路数（双2输入与门 / 八移位寄存器 / 六反相器 / 双多路复用器）
    m = re.match(r'^([单双三四六八])', d)
    if m:
        return m.group(1) + '路'
    # "多路模拟开关"（无具体路数）
    if re.match(r'^(多路|多路复用器)', d):
        return '多路'
    # 型号 N G 模式
    m = re.search(r'74[A-Z]+?(\d)G[A-Z]?\d', model)
    if m:
        return {'1': '单路', '2': '双路', '3': '三路'}.get(m.group(1), '其他')
    # 总线开关 74CBTLV3125（无 G）
    return '其他'


def parse_inputs(detail):
    """从 detail 解析'几输入'"""
    m = re.search(r'(\d)输入', str(detail or ''))
    return (m.group(1) + '输入') if m else ''


def fam_of(model):
    """EM74HC00D → EM74HC00（剥封装后缀）"""
    import re
    m = re.match(r'^(.*?)(MSOP|DRL|BQ|GW|GV|GX|PW|GM|GS|DR|MS|D|Q)$', model.upper())
    return m.group(1) if m else model.upper()


def cat_of(p):
    """三大类判定"""
    s = str(p.get('series') or '')
    f = str(p.get('function') or '')
    if f == '电平转换收发器':
        return 'level'
    if '开关' in f or '多路复用' in f:
        return 'switch'
    if s.startswith('74'):
        return 'logic'
    # 兜底
    if s in ('EMS', 'EL'):
        return 'switch'
    if s == 'EXS':
        return 'level'
    return 'logic'


CATS = OrderedDict([
    ('logic',  '74 逻辑'),
    ('level',  '电平转换'),
    ('switch', '模拟开关'),
])

# 功能组：把同族功能归到一组（四→五层折叠里的第四层）
GROUPS = OrderedDict([
    ('门电路',        ['与门', '与非门', '或门', '或非门', '异或门', '异或非门', '多功能可配置门']),
    ('缓冲器 / 驱动器', ['同相缓冲器', '施密特缓冲器', '收发器']),
    ('反相器',        ['反相器', '施密特反相器', '开漏反相器']),
    ('触发器 / 锁存器', ['触发器', '锁存器']),
    ('寄存器 / 译码器', ['移位寄存器', '译码器']),
])
FUNC2GROUP = {}
for g, fl in GROUPS.items():
    for f in fl:
        FUNC2GROUP[f] = g

buckets = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
for p in prod:
    c = cat_of(p)
    fn = p.get('function') or '其他'
    se = p.get('series') or '其他'
    fam = fam_of(p['model'])
    buckets[c][fn][se].append({
        'm': p['model'],
        'pkg': p.get('package') or '',
        'vcc': p.get('voltage') or '',
        'detail': p.get('function_detail') or '',
        'sys': p.get('package_size') or '',
        'comp': 0,
        'route': switch_type_of(p['model']) if c == 'switch' else parse_route(p['model'], p.get('function_detail')),
        'inputs': parse_inputs(p.get('function_detail')),
    })

cats_out = []
for key, name in CATS.items():
    funcs = []
    total = 0
    for fn in sorted(buckets[key], key=lambda k: -sum(len(v) for v in buckets[key][k].values())):
        # 按「几路」分组；组内型号带 series 字段
        rmap = defaultdict(list)
        fcount = 0
        for se in buckets[key][fn]:
            for m in buckets[key][fn][se]:
                m = dict(m); m['series'] = se
                rmap[m['route']].append(m)
                fcount += 1
        routes = []
        # 模拟开关类按产品类型分组（顺序=SWITCH_TYPE 定义序），其余按 ROUTE_ORDER
        order = list(SWITCH_TYPE.keys()) + ['通用开关'] if key == 'switch' else ROUTE_ORDER
        for rn in order:
            if rn not in rmap: continue
            models = sorted(rmap[rn], key=lambda x: (x['series'], x['m']))
            routes.append({'name': rn, 'count': len(models), 'models': models})
        # 兼容旧字段名
        series_flat = []
        for se in sorted(buckets[key][fn], key=lambda k: -len(buckets[key][fn][k])):
            series_flat.append({'name': se, 'count': len(buckets[key][fn][se]),
                                'models': sorted(buckets[key][fn][se], key=lambda x: x['m'])})
        funcs.append({'name': fn, 'count': fcount, 'routes': routes, 'series': series_flat})
        total += fcount
    # 按「工艺子类 → 系列」重组（系列在最外，功能在其下）
    pmap = OrderedDict()
    for f in funcs:
        for s in f['series']:
            # 该系列在功能下的型号
            for m in s['models']:
                pmap.setdefault(proc_of(s['name']), OrderedDict()) \
                    .setdefault(s['name'], OrderedDict()) \
                    .setdefault(f['name'], []).append(m)

    n_series = sum(len(v) for v in pmap.values())
    use_proc = n_series >= 3   # 系列太少时不做工艺子类，避免冗余层级

    procs = []
    _keys = (list(PROCESS_GROUPS.keys()) + ['其他']) if use_proc else [None]
    for pname in _keys:
        if use_proc and pname not in pmap: continue
        # 无子类时把所有系列合并在一个块里
        _items = pmap[pname].items() if use_proc else \
                 [(s, f) for v in pmap.values() for s, f in v.items()]
        sers = []
        for sname, fmap in _items:
            fns = []
            for fname, models in fmap.items():
                # 路数分组
                rmap = defaultdict(list)
                for m in models:
                    rmap[m['route']].append(m)
                routes = []
                order2 = list(SWITCH_TYPE.keys()) + ['通用开关'] if key == 'switch' else ROUTE_ORDER
                for rn in order2:
                    if rn not in rmap: continue
                    routes.append({'name': rn, 'count': len(rmap[rn]),
                                   'models': sorted(rmap[rn], key=lambda x: x['m'])})
                fns.append({'name': fname, 'count': len(models), 'routes': routes})
            fns.sort(key=lambda x: -x['count'])
            sers.append({'name': sname, 'count': sum(x['count'] for x in fns), 'funcs': fns})
        sers.sort(key=lambda x: -x['count'])
        procs.append({'name': None if not use_proc else pname,
                      'count': sum(x['count'] for x in sers), 'series': sers})

    cats_out.append({'key': key, 'name': name, 'count': total,
                     'procs': procs, 'funcs': funcs, 'proc_level': use_proc})

out = {
    'generated': datetime.now().strftime('%Y-%m-%d'),
    'total': len(prod),
    'cats': cats_out,
}
(WEB / 'data' / 'catalog.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

print(f'目录树生成: {len(prod)} 型号')
for c in cats_out:
    print(f"  {c['name']:10} {c['count']:4} 款, {len(c['funcs']):2} 个功能")
    for f in c['funcs'][:4]:
        print(f"      {f['name']:16} {f['count']:4} 款, {len(f['series'])} 系列")
print()
print('文件:', (WEB / 'data' / 'catalog.json').stat().st_size, 'B')
