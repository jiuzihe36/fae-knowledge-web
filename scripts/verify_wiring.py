#!/usr/bin/env python3
"""封装接线图交付级校验器（资深电子工程师规则书 v1.0）
用法: python3 scripts/verify_wiring.py circuits/XXX_wiring.svg ...
硬校验(FAIL即打回): R4交叉凸起 / R5端子断线 / R8不穿盒 / R9行栅格对齐
  / R11 pin1点一致 / R12文字压线重叠 / R13无页脚 / R15无悬空端点 / R16XML
  / R7元件值 / R17端口文字贴线
输出: 每图 PASS / FAIL+问题清单。退出码0=全过。
"""
import re, sys
import xml.etree.ElementTree as ET
NS = '{http://www.w3.org/2000/svg}'

def load(p):
    root = ET.parse(p).getroot()
    vb = root.get('viewBox', '0 0 720 440').split()
    W, H = float(vb[2]), float(vb[3])
    lines, arcs, texts, rects, circles = [], [], [], [], []
    for el in root:
        t = el.tag.replace(NS, '')
        if t == 'line':
            lines.append(tuple(float(el.get(k)) for k in ('x1','y1','x2','y2')))
        elif t == 'path':
            m = re.match(r'M([\d.]+),([\d.]+)\s+A([\d.]+),([\d.]+)\s+([\d.]+)\s+([01])\s*,?\s*([01])\s+([\d.]+),([\d.]+)', el.get('d',''))
            if m:
                v = list(map(float, m.groups()))
                arcs.append((v[0], v[1], v[7], v[8]))
        elif t == 'text':
            x, y = float(el.get('x',0)), float(el.get('y',0))
            c = el.text or ''
            size = float(el.get('font-size', 12))
            anchor = el.get('text-anchor','start')
            w = sum(size if ord(ch) > 0x2E80 else size*0.55 for ch in c)
            x0 = x if anchor == 'start' else (x-w if anchor=='end' else x-w/2)
            texts.append([x0, y-size*0.8, x0+w, y+size*0.25, c, anchor])
        elif t == 'rect':
            rects.append((float(el.get('x', 0)), float(el.get('y', 0)), float(el.get('width', 0)), float(el.get('height', 0)), el.get('fill', '')))
        elif t == 'circle':
            circles.append((float(el.get('cx')), float(el.get('cy')), float(el.get('r')), el.get('fill','')))
    return W, H, lines, arcs, texts, rects, circles

def dist_pt_seg(px, py, x1, y1, x2, y2):
    dx, dy = x2-x1, y2-y1
    if dx == dy == 0: return ((px-x1)**2+(py-y1)**2)**0.5
    t = max(0, min(1, ((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)))
    return ((px-(x1+t*dx))**2+(py-(y1+t*dy))**2)**0.5

def verify(path):
    issues = []
    try:
        W, H, lines, arcs, texts, rects, circles = load(path)
    except Exception as e:
        return [f'R16 XML解析失败: {e}']
    # 识别封装盒(浅色大rect)与小元件rect
    pkg = [r for r in rects if r[4] == '#f7f9fb']
    comps = [r for r in rects if r[4] == '#fff' and r[2] < 40]
    rails = [l for l in lines if abs(l[1]-l[3]) < .5 and (l[2]-l[0]) > 400]
    rail_ys = [l[1] for l in rails]

    # R8 走线不穿封装盒
    if pkg:
        bx, by, bw, bh, _ = pkg[0]
        for (x1,y1,x2,y2) in lines:
            n = 60
            for i in range(1, n):
                sx, sy = x1+(x2-x1)*i/n, y1+(y2-y1)*i/n
                if bx+2 < sx < bx+bw-2 and by+2 < sy < by+bh-2:
                    if abs(x1-bx)>3 and abs(x2-bx-bw)>3 or (min(x1,x2)>bx+2 and max(x1,x2)<bx+bw-2):
                        issues.append(f'R8 线穿封装盒: ({x1:.0f},{y1:.0f})-({x2:.0f},{y2:.0f})')
                        break

    # R5 线穿元件(R本体/C极板)
    for (rx,ry,rw,rh,_) in comps:
        for (x1,y1,x2,y2) in lines:
            if abs(x1-x2) < .5 and rx+1 < x1 < rx+rw-1:
                if min(y1,y2) < ry+rh-1 and max(y1,y2) > ry+1:
                    issues.append(f'R5 线穿电阻本体 x={x1:.0f}')
    # C极板: 两条平行短线间距8-16 -> 板间区
    plates = [l for l in lines if abs(l[0]-l[2]) < .5 and abs(l[3]-l[1]) <= 20]
    for i, a in enumerate(plates):
        for b in plates[i+1:]:
            if abs(a[0]-b[0]) in range(6, 20) and abs(min(a[1],a[3])-min(b[1],b[3])) < 6:
                lo, hi = sorted([a[0], b[0]])
                plo = min(min(a[1],a[3]), min(b[1],b[3])) - 2
                phi = max(max(a[1],a[3]), max(b[1],b[3])) + 2
                for (x1,y1,x2,y2) in lines:
                    if abs(y1-y2) < .5 and plo < y1 < phi and min(x1,x2) < lo-1 and max(x1,x2) > hi+1:
                        issues.append(f'R5 线穿电容极板 x=[{lo:.0f},{hi:.0f}] y={y1:.0f}')

    # R4 裸交叉必须有凸起
    hors = [l for l in lines if abs(l[1]-l[3]) < .5]
    vers = [l for l in lines if abs(l[0]-l[2]) < .5]
    for h in hors:
        for v in vers:
            x, y = v[0], h[1]
            if min(h[0],h[2]) < x < max(h[0],h[2]) and min(v[1],v[3]) < y < max(v[1],v[3]):
                if any(c[0] < x and c[2] > x and abs(c[1]-y) < 1 for c in arcs if abs(c[1]-c[3]) < 2):  # 横跳
                    continue
                if any(abs(c[0]-x) < 2 and min(c[1],c[3]) < y < max(c[1],c[3]) for c in arcs):  # 竖跳
                    continue
                if any(abs(c[0]-x) < 6 and abs(c[1]-y) < 6 for c in circles):  # 节点圆点
                    continue
                issues.append(f'R4 裸交叉无凸起: ({x:.0f},{y:.0f})')

    # R9 行栅格对齐
    if pkg:
        bx, by, bw, bh, _ = pkg[0]
        left_rows = sorted({round(t[1]+t[5] if False else t[1]) for t in texts if t[0] >= bx+3 and t[0] < bx+bw/2 and by < t[1] < by+bh})
        # 用基线y: y1是文字底, 记y=文字y1+...
        left = sorted({round(t[3]) for t in texts if t[0] >= bx+3 and t[0] < bx+bw/2 and by < t[3] < by+bh})
        right = sorted({round(t[3]) for t in texts if t[2] <= bx+bw-3 and t[2] > bx+bw/2 and by < t[3] < by+bh})
        if left and right:
            L, R = set(left), set(right)
            if not (L <= R or R <= L):
                issues.append(f'R9 行栅格不对齐: 左行{sorted(L)} vs 右行{sorted(R)}')

    # R11 pin1点须贴近(1)标签
    for (cx, cy, r, fill) in circles:
        if r <= 6 and fill in ('none', None, ''):
            if not any('(1)' in t[4] and abs((t[0]+t[2])/2-cx) < 60 and abs(t[3]-cy) < 45 for t in texts):
                issues.append(f'R11 pin1圆点({cx:.0f},{cy:.0f})附近无(1)标签')

    # R13 页脚小字
    for t in texts:
        if re.search(r'芯祥|FAE|一图|凸起=', t[4]) or t[5] and t[1] > H-20:
            issues.append(f'R13 页脚文字: {t[4][:20]}')

    # R12 文字压线(横/竖线穿文字bbox) + 文字重叠
    for t in texts[:len(texts)]:
        for (x1,y1,x2,y2) in lines:
            if abs(y1-y2) < .5 and t[1] < y1 < t[3] and min(x1,x2) < t[2]-3 and max(x1,x2) > t[0]+3:
                issues.append(f'R12 横线穿文字[{t[4][:14]}] y={y1:.0f}')
            if abs(x1-x2) < .5 and t[0] < x1 < t[2] and min(y1,y2) < t[3]-3 and max(y1,y2) > t[1]+3:
                issues.append(f'R12 竖线穿文字[{t[4][:14]}] x={x1:.0f}')
    for i, a in enumerate(texts):
        for b in texts[i+1:]:
            if a[0] < b[2]-2 and b[0] < a[2]-2 and a[1] < b[3]-2 and b[1] < a[3]-2:
                issues.append(f'R12 文字重叠[{a[4][:10]}|{b[4][:10]}]')

    # R15/R17 端点审计: 悬空 / T缺节点 / 端口文字不贴线
    nodes = [(c[0], c[1]) for c in circles if c[2] >= 3 and c[3] not in ('none', None, '')]
    arc_ends = [(a[0], a[1]) for a in arcs] + [(a[2], a[3]) for a in arcs]
    plate_set = set()
    for l in lines:
        if (abs(l[0]-l[2]) < .5 and abs(l[3]-l[1]) <= 20) or (abs(l[1]-l[3]) < .5 and abs(l[2]-l[0]) <= 20):
            plate_set.add((l[0], l[1])); plate_set.add((l[2], l[3]))
    endpoints = []
    for (x1,y1,x2,y2) in lines:
        if (x1,y1) not in plate_set: endpoints.append((x1,y1))
        if (x2,y2) not in plate_set: endpoints.append((x2,y2))
    plate_lines = [l for l in lines if (abs(l[0]-l[2]) < .5 and abs(l[3]-l[1]) <= 20) or (abs(l[1]-l[3]) < .5 and abs(l[2]-l[0]) <= 20)]
    for (ex, ey) in endpoints:
        if any(dist_pt_seg(ex, ey, *pl) < 2 for pl in plate_lines):  # 端点落极板=元件端子
            continue
        if any(abs(ey-ry) < 1 for ry in rail_ys):  # 落轨=连接
            continue
        bx, by, bw, bh, _ = pkg[0]
        if (abs(ex-bx) < 3 or abs(ex-bx-bw) < 3) and by-2 <= ey <= by+bh+2:
            continue
        if any(((ex-a)**2+(ey-b)**2)**.5 < 6 for a, b in nodes+arc_ends):
            continue
        if any((abs(ex-r[0]) < 3 or abs(ex-r[0]-r[2]) < 3 or (r[0]-3 <= ex <= r[0]+r[2]+3 and (abs(ey-r[1]) < 3 or abs(ey-r[1]-r[3]) < 3))) for r in comps if r[1]-3 <= ey <= r[1]+r[3]+3):
            continue
        touch_corner = any(((ex-x1)**2+(ey-y1)**2)**.5 < 4 or ((ex-x2)**2+(ey-y2)**2)**.5 < 4
                           for (x1,y1,x2,y2) in lines if (x1,y1)!=(ex,ey))
        if touch_corner:
            continue
        # T接: 端点落在其他线内部
        t_hit = [l for l in lines if dist_pt_seg(ex, ey, *l) < 3 and not (abs(ex-l[0])<4 and abs(ey-l[1])<4) and not (abs(ex-l[2])<4 and abs(ey-l[3])<4)]
        if t_hit:
            if any(((ex-a)**2+(ey-b)**2)**.5 < 8 for a, b in nodes):
                continue
            issues.append(f'R4 T接点缺节点圆点: ({ex:.0f},{ey:.0f})')
            continue
        # 端口: 6px内有文字
        near_text = any(t[0]-6 <= ex <= t[2]+6 and t[1]-6 <= ey <= t[3]+8 for t in texts)
        if near_text:
            continue
        issues.append(f'R15 悬空端点: ({ex:.0f},{ey:.0f})')

    # R7 元件值
    if any(abs(a[0]-a[2]) < .5 and abs(a[3]-a[1]) <= 20 for a in lines):  # 有C极板
        if not any(re.match(r'^C\s*[\d.]+\s*(n|p|u|µ|m)?F', t[4]) for t in texts):
            issues.append('R7 缺电容值标注(如 C 10nF)')
    if comps and not any(re.match(r'^R\s*[\d.]+\s*(k|M|Ω|R)', t[4]) for t in texts):
        issues.append('R7 缺电阻值标注(如 R 100kΩ)')

    return issues

def main():
    fail = 0
    for p in sys.argv[1:]:
        issues = verify(p)
        name = os.path.basename(p) if (os := __import__('os')) else p
        if issues:
            fail += 1
            print(f'✗ {name} FAIL ({len(issues)})')
            for i in issues[:20]:
                print('   -', i)
        else:
            print(f'✓ {name} PASS')
    sys.exit(1 if fail else 0)

if __name__ == '__main__':
    main()
