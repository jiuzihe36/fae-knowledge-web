#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_wiring.py — 自包含批量封装接线图生成器 v1.0
吃 /tmp/pins_plan.json + data/products.json, 产 circuits/{model}_wiring.svg
坐标体系 1:1 复刻已过审 EMS3157/EM74HC14 模板 (720×440 / 盒130×240 / 行栅格 / 双通道)
硬约定(7条)内置: 左控右输 · 不穿盒 · 交叉凸起(本布局天然零交叉) · 上VCC下GND
  · 图下无小字 · 行栅格对齐(少侧外侧行) · pin1圆点+脚号 · NC占行不画线 · 去耦带值
用法: python3 scripts/gen_wiring.py [--sample N] [--model NAME]
"""
import os, json, re, sys

W, H = 720, 440
RAIL_T, RAIL_B = 78, 400
BOX_X, BOX_Y, BOX_W, BOX_H = 300, 130, 130, 240      # 过审版同款
L_LABEL_X, R_LABEL_X = 308, 422                        # 盒内标签 start/end
L_WIRE = (300, 170)     # 左端口线 x1..x2 (从盒边向左)
R_WIRE = (430, 560)     # 右端口线
L_PORT_X, R_PORT_X = 52, 568                            # 外侧端口文字
CH_L, CH_R = 150, 520                                   # GND/VCC 通道 x (下行/上行)
CAP_X = 640                                            # 去耦 x
ROW_CENTER, ROW_STEP_MAX, ROW_SPAN = 265, 55, 195

FONT = 'font-family="Helvetica,Arial,sans-serif"'
DESC_CN = [   # desc 关键词 → 中文端口名 (命中即用, 不臆造)
    ('not connected', 'NC'), ('no connect', 'NC'),
    ('common', '公共端'), ('normally closed', '通道(NO)'), ('normally open', '通道(NC)'),
    ('signal port', '信号通道'), ('analog', '模拟端'), ('usb', 'USB端'),
    ('3-state', '三态输出'), ('tri-state', '三态输出'), ('open-drain', '开漏端'),
    ('data output', '数据输出'), ('data input', '数据输入'),
    ('serial', '串行'), ('parallel', '并行'), ('latch enable', '锁存使能'),
    ('clock', '时钟'), ('reset', '复位'), ('master reset', '复位'),
    ('enable', '使能'), ('direction', '方向控制'), ('select', '选择控制'),
    ('control', '控制'), ('input', '输入'), ('output', '输出'),
    ('ground', '地'), ('supply', '电源'), ('power', '电源'),
    ('bidirectional', '双向端'), ('in/out', '双向端'), ('i/o', '双向端'),
    ('bus', '总线端'), ('drain', '漏端'), ('source', '源端'), ('data', '数据'),
    ('flip', '触发'), ('register', '寄存'), ('latch', '锁存'),
]
VCC_SYMS, GND_SYMS = {'VCC', 'VDD', 'V+', 'VSUP'}, {'GND', 'VSS', 'V-', 'VEE', 'GND0'}

def esc(s):
    return re.sub(r'[<>&]', lambda m: {'<': '&lt;', '>': '&gt;', '&': '&amp;'}[m.group(0)], str(s))

def norm_sym(s):
    return re.sub(r'\s+', '', str(s or '')).upper()

def tw(s, size):    # 文字宽估算 (CJK=1.0em, 其余≈0.6em)
    w = 0.0
    for ch in str(s):
        w += size * (1.0 if ord(ch) > 0x2E80 else 0.6)
    return w

def classify(pins):
    """→ left, right, vcc, gnd, nc  (列表项 = pin dict 原样)"""
    left, right, vcc, gnd, nc = [], [], [], [], []
    for p in pins:
        sym = str(p.get('symbol') or '').strip()
        ns = norm_sym(sym)
        desc = str(p.get('desc') or '')
        dl = desc.lower()
        if ns in VCC_SYMS or 'supply' in dl and ns.startswith('V'):
            vcc.append(p)
        elif ns in GND_SYMS or dl.startswith('ground'):
            gnd.append(p)
        elif 'not connect' in dl or 'no connect' in dl or ns in ('NC', 'NC1', 'NC2'):
            nc.append(p)
        elif 'common' in dl:
            left.append(p)
        elif 'port' in dl or 'channel' in dl:
            right.append(p)
        elif 'output' in dl or re.fullmatch(r'Y\d*', ns) or re.fullmatch(r'Q\d*', ns):
            right.append(p)
        elif 'bus' in dl and re.fullmatch(r'B\d*', ns):
            right.append(p)
        elif re.fullmatch(r'B\d+', ns) and 'gate' in dl:
            right.append(p)
        else:
            # input/控制/双向A侧/空desc默认左; symbol 收尾规则
            if re.fullmatch(r'A\d+', ns) and ('in/out' in dl or 'i/o' in dl or not dl):
                left.append(p)
            else:
                left.append(p)
    # NC 归位: 插入左列 GND 之前 (GND 最后); 若无左列则入右
    if nc:
        if gnd or left:
            pos = len(left)
            left = left + nc
        else:
            right = right + nc
    # 电源固定: VCC 右首, GND 左末 (过审版式)
    right = (vcc[:1] + [p for p in right if p not in vcc])
    left = ([p for p in left if p not in gnd] + gnd)
    # 若 vcc 有多个(罕见): 其余追加右列尾
    if len(vcc) > 1:
        right = right + vcc[1:]
    if len(gnd) > 1:
        left = left[:-1] + [p for p in gnd[:-1]] + gnd[-1:]   # 保持 GND 末位
        # 简化: 多 GND 并入末尾 (主 GND 最末)
        left = [p for p in left if p not in gnd] + gnd
    return left, right

def spread(k, rows):
    """k 个占 rows 行: 少侧外侧/均匀, 保证 unique+升序"""
    if k <= 0:
        return []
    if k >= rows:
        return list(range(rows))
    if k == 1:
        return [(rows - 1) // 2]
    out, last = [], -1
    for i in range(k):
        t = round(i * (rows - 1) / (k - 1))
        t = max(t, last + 1)
        t = min(t, rows - (k - i))
        out.append(t)
        last = t
    return out

def row_ys(rows):
    step = min(ROW_STEP_MAX, ROW_SPAN // max(1, rows - 1)) if rows > 1 else 0
    c = ROW_CENTER
    return [int(round(c + (i - (rows - 1) / 2) * step)) for i in range(rows)]

def port_cn(desc, symbol):
    """端口中文名(命中映射才中文, 兜底 desc 首2词英文原文)"""
    dl = str(desc or '').lower()
    for k, cn in DESC_CN:
        if k in dl:
            return cn
    words = re.findall(r'[A-Za-z]+', str(desc or ''))
    if words:
        return ' '.join(words[:2])
    return str(symbol or '')

def gen(model, pkg, func, volt, pins):
    left, right = classify(pins)
    rows = max(len(left), len(right), 1)
    ys = row_ys(rows)
    li, ri = spread(len(left), rows), spread(len(right), rows)
    font_size = 12 if rows <= 6 else (11 if rows <= 8 else 10.5)
    pkg_short = str(pkg or '').split('/')[0]
    title = f'{model} 使用接线图 · {pkg_short}'
    sub = ' · '.join(x for x in [
        (func or '').strip(),
        (f'VCC {volt}' if volt else ''),
        '左=控制/输入，右=输出',
    ] if x)
    s = []
    s.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" {FONT}>')
    s.append(f'<rect width="{W}" height="{H}" fill="#fff"/>')
    s.append(f'<text x="360" y="30" text-anchor="middle" font-size="17" font-weight="bold" fill="#111">{esc(title)}</text>')
    s.append(f'<text x="360" y="52" text-anchor="middle" font-size="12" fill="#666">{esc(sub)}</text>')
    # 电源轨 + 标签
    s.append(f'<line x1="60" y1="{RAIL_T}" x2="660" y2="{RAIL_T}" stroke="#111" stroke-width="2.5"/>')
    s.append(f'<text x="48" y="83" text-anchor="end" font-size="14" font-weight="bold">VCC</text>')
    s.append(f'<line x1="60" y1="{RAIL_B}" x2="660" y2="{RAIL_B}" stroke="#111" stroke-width="2.5"/>')
    s.append(f'<text x="48" y="405" text-anchor="end" font-size="14" font-weight="bold">GND</text>')
    # 型号名(盒上方) + 封装盒
    s.append(f'<text x="365" y="118" text-anchor="middle" font-size="14" font-weight="bold">{esc(model)} · {esc(pkg_short)}</text>')
    s.append(f'<rect x="{BOX_X}" y="{BOX_Y}" width="{BOX_W}" height="{BOX_H}" rx="5" fill="#f7f9fb" stroke="#111" stroke-width="2.5"/>')
    # 盒内标签: (行位, 文字, 侧)  —— 收集后统一画 (pin1 圆点需要文字宽)
    pin1 = next((p for p in pins if int(p.get('pin') or 0) == 1), None)
    dot = None
    def label(p, y, side):
        nonlocal dot
        text = f'{p.get("symbol")} ({p.get("pin")})'
        if side == 'L':
            x, anchor = L_LABEL_X, 'start'
            w = tw(text, font_size)
            if pin1 is p: dot = (x + w / 2, y + 18)
        else:
            x, anchor = R_LABEL_X, 'end'
            w = tw(text, font_size)
            if pin1 is p: dot = (x - w / 2, y + 18)
        s.append(f'<text x="{x:.0f}" y="{y + 4}" font-size="{font_size}" text-anchor="{anchor}">{esc(text)}</text>')
    is_nc = lambda p: 'not connect' in str(p.get('desc') or '').lower() or norm_sym(p.get('symbol')) in ('NC', 'NC1', 'NC2')
    is_vcc = lambda p: norm_sym(p.get('symbol')) in VCC_SYMS
    is_gnd = lambda p: norm_sym(p.get('symbol')) in GND_SYMS
    # 画左列
    for i, p in enumerate(left):
        y = ys[li[i]]
        label(p, y, 'L')
        if is_gnd(p):
            s.append(f'<line x1="300" y1="{y}" x2="{CH_L}" y2="{y}" stroke="#111" stroke-width="2"/>')
            s.append(f'<line x1="{CH_L}" y1="{y}" x2="{CH_L}" y2="{RAIL_B}" stroke="#111" stroke-width="2"/>')
        elif is_nc(p):
            pass   # NC 占行不画线
        else:
            s.append(f'<line x1="300" y1="{y}" x2="{L_WIRE[1]}" y2="{y}" stroke="#111" stroke-width="2"/>')
            cn = port_cn(p.get('desc'), p.get('symbol'))
            s.append(f'<text x="{L_PORT_X}" y="{y - 4}" font-size="13" font-weight="bold">{esc(cn)} →</text>')
    # 画右列
    for i, p in enumerate(right):
        y = ys[ri[i]]
        label(p, y, 'R')
        if is_vcc(p):
            s.append(f'<line x1="430" y1="{y}" x2="{CH_R}" y2="{y}" stroke="#111" stroke-width="2"/>')
            s.append(f'<line x1="{CH_R}" y1="{y}" x2="{CH_R}" y2="{RAIL_T}" stroke="#111" stroke-width="2"/>')
        elif is_nc(p):
            pass
        else:
            s.append(f'<line x1="430" y1="{y}" x2="{R_WIRE[1]}" y2="{y}" stroke="#111" stroke-width="2"/>')
            cn = port_cn(p.get('desc'), p.get('symbol'))
            s.append(f'<text x="{R_PORT_X}" y="{y - 4}" font-size="13" font-weight="bold">→ {esc(cn)}</text>')
    # pin1 圆点
    if dot:
        s.append(f'<circle cx="{dot[0]:.0f}" cy="{dot[1]:.0f}" r="4.5" fill="none" stroke="#111" stroke-width="2"/>')
    # 去耦电容 (带值, 极板断开, 不与端口文字冲突: 标签 y118 区 x540..600 与型号名 bbox 不交)
    s.append(f'<line x1="{CAP_X}" y1="{RAIL_T}" x2="{CAP_X}" y2="195" stroke="#111" stroke-width="2"/>')
    s.append(f'<line x1="{CAP_X - 9}" y1="195" x2="{CAP_X + 9}" y2="195" stroke="#111" stroke-width="2.5"/>')
    s.append(f'<line x1="{CAP_X - 9}" y1="205" x2="{CAP_X + 9}" y2="205" stroke="#111" stroke-width="2.5"/>')
    s.append(f'<line x1="{CAP_X}" y1="205" x2="{CAP_X}" y2="{RAIL_B}" stroke="#111" stroke-width="2"/>')
    s.append(f'<text x="600" y="118" text-anchor="end" font-size="13">C 100nF</text>')
    s.append('</svg>')
    return '\n'.join(s)

def main():
    plan = json.load(open('/tmp/pins_plan.json', encoding='utf-8'))
    prods = json.load(open(os.path.join(os.path.expanduser('~/fae-knowledge-web'), 'data', 'products.json'), encoding='utf-8'))
    outd = os.path.expanduser('~/fae-knowledge-web/circuits')
    args = sys.argv[1:]
    want = None
    if '--model' in args:
        want = args[args.index('--model') + 1]
    limit = None
    if '--sample' in args:
        limit = int(args[args.index('--sample') + 1])
    done, skip = 0, []
    made = []
    for it in prods:
        m = it['model']
        if m not in plan:
            continue
        if want and m != want:
            continue
        blk = plan[m]
        pins = blk.get('pins') or []
        if not pins:
            skip.append((m, 'no-pins')); continue
        try:
            svg = gen(m, it.get('package'), it.get('function_detail') or it.get('function'),
                      it.get('voltage'), pins)
            fn = os.path.join(outd, f'{m}_wiring.svg')
            open(fn, 'w', encoding='utf-8').write(svg)
            done += 1; made.append(m)
            if limit and done >= limit:
                break
        except Exception as e:
            skip.append((m, f'{type(e).__name__}: {e}'))
    print(f'generated: {done} | skipped: {len(skip)}')
    for m, e in skip[:10]:
        print('  SKIP', m, e)
    print('sample:', made[:5])

if __name__ == '__main__':
    main()