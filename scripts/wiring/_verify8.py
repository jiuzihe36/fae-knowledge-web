# wiring-diagram 8条硬约定 程序化几何验收 (v2: 适配官方 CBT3257 版式)
# ①控制/输入左、输出右 ②走线不穿封装盒 ③交叉不相连画凸起跳线 ④上VCC轨下GND轨+电源脚对位连轨
# ⑤图下无小文字 ⑥行栅格对齐(横平竖直) ⑦pin1圆点+脚号 ⑧元件断端子
import re, os, sys
from itertools import combinations

OUT = '/Users/hu/fae-knowledge-web/circuits'

def parse(svg):
    lines = []
    for m in re.finditer(r'<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"', svg):
        x1,y1,x2,y2 = map(float, m.groups())
        lines.append((x1,y1,x2,y2))
    boxes = []
    for m in re.finditer(r'<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"[^>]*fill="([^"]+)"', svg):
        x,y,w,h,fill = m.groups(); x,y,w,h = float(x),float(y),float(w),float(h)
        if w >= 700: continue            # 背景
        kind = 'chip' if h > 100 else 'body'
        boxes.append((x,y,w,h,kind))
    jumps = []      # 跳线圆心 (x,y) — JUMP_V/JUMP_H 均为 A9,9 弧, 圆心=端点中点
    for m in re.finditer(r'<path d="M([-\d.]+),([-\d.]+) A9,9 0 0,1 ([-\d.]+),([-\d.]+)"', svg):
        x1,y1,x2,y2 = map(float, m.groups())
        jumps.append(((x1+x2)/2, (y1+y2)/2))
    texts = []
    for m in re.finditer(r'<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([-\d.]+)"[^>]*>([^<]+)</text>', svg):
        x,y,fs,t = m.groups()
        texts.append((float(x),float(y),float(fs),t))
    circles = [(float(a),float(b),float(c)) for a,b,c in re.findall(r'<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"', svg)]
    return lines, boxes, jumps, texts, circles

def seg_int(p, q):
    (x1,y1,x2,y2),(x3,y3,x4,y4) = p, q
    d = (x2-x1)*(y4-y3) - (y2-y1)*(x4-x3)
    if abs(d) < 1e-9: return None
    t = ((x3-x1)*(y4-y3) - (y3-y1)*(x4-x3)) / d
    u = ((x3-x1)*(y2-y1) - (y3-y1)*(x2-x1)) / d
    if 1e-6 < t < 1-1e-6 and 1e-6 < u < 1-1e-6:
        return (x1+t*(x2-x1), y1+t*(y2-y1))
    return None

def through_box(seg, box):
    x,y,w,h,kind = box
    if kind != 'chip': return False
    (x1,y1,x2,y2) = seg
    N = 20
    for i in range(1, N):
        t = i/N
        px, py = x1+t*(x2-x1), y1+t*(y2-y1)
        if x+1 < px < x+w-1 and y+1 < py < y+h-1:
            return True
    return False

def near_jump(pt, jumps, tol=12):
    return any(abs(pt[0]-jx) <= tol and abs(pt[1]-jy) <= tol for jx,jy in jumps)

def power_conn(chips, lines):
    # ④ 官方版式: VCC=盒右缘横线到x折上轨; GND=盒左缘横线到x折下轨 — 标注与出线必须同侧对位
    fails = []
    for x,y,w,h,k in chips:
        xr = x+w; inY = lambda v: y+1 <= v <= y+h-1
        vcc_ok = gnd_ok = False
        for x1,y1,x2,y2 in lines:
            # 水平线, 一端贴盒右缘(VCC) / 左缘(GND)
            if abs(y1-y2) < 0.5 and inY(y1):
                if abs(x1-xr) < 0.5 or abs(x2-xr) < 0.5:
                    xv = x2 if abs(x1-xr) < 0.5 else x1
                    if any(abs(a-c) < 0.5 for a,b,c,d in lines
                           if abs(a-xv) < 0.5 and abs(c-xv) < 0.5 and abs(min(b,d)-78) < 1 and abs(max(b,d)-y1) < 1):
                        vcc_ok = True
                if abs(x1-x) < 0.5 or abs(x2-x) < 0.5:
                    xv = x2 if abs(x1-x) < 0.5 else x1
                    if any(abs(a-c) < 0.5 for a,b,c,d in lines
                           if abs(a-xv) < 0.5 and abs(c-xv) < 0.5 and abs(max(b,d)-400) < 1 and abs(min(b,d)-y1) < 1):
                        gnd_ok = True
        if not vcc_ok: fails.append('④ 芯片VCC脚未对位连上轨(右出)')
        if not gnd_ok: fails.append('④ 芯片GND脚未对位连下轨(左出)')
    return fails

def check(fn):
    svg = open(f'{OUT}/{fn}').read()
    lines, boxes, jumps, texts, circles = parse(svg)
    chips = [b for b in boxes if b[4] == 'chip']
    fails = []
    # ② 走线不穿盒
    for seg in lines:
        for box in chips:
            if through_box(seg, box):
                fails.append(f'② 走线穿盒: seg{seg}')
    # ③ 交叉必须有跳线
    for a, b in combinations(lines, 2):
        p = seg_int(a, b)
        if p and not near_jump(p, jumps):
            fails.append(f'③ 未跳线的交叉 @({p[0]:.0f},{p[1]:.0f})')
    # ③ 拱桥方向: 跳线必须向上拱(sweep=1); sweep=0 是向下翻(曾改反, 用户报"跳线还是下翻")
    for _m in re.finditer(r'<path d="M([-\d.]+),([-\d.]+) A([\d.]+),([\d.]+) 0 0,([01]) ([-\d.]+),([-\d.]+)"', svg):
        sw = _m.group(5)
        if sw != '1':
            fails.append(f'③ 跳线方向错误: 向下翻(sweep={sw}), 应向上拱(sweep=1)')
    # ④ 上VCC轨下GND轨 + 电源脚对位连轨
    top_rail = any(abs(y1-78)<1 and abs(y2-78)<1 for x1,y1,x2,y2 in lines)
    bot_rail = any(abs(y1-400)<1 and abs(y2-400)<1 for x1,y1,x2,y2 in lines)
    if not top_rail: fails.append('④ 无VCC轨(y=78)')
    if not bot_rail: fails.append('④ 无GND轨(y=400)')
    fails += power_conn(chips, lines)
    # ⑤ 图下无小文字（允许 VCC/GND 轨标签）
    for x,y,fs,t in texts:
        if y > 390 and t not in ('VCC','GND'):
            fails.append(f'⑤ 底部小文字 "{t}" y={y}')
    # ⑥ 横平竖直
    for x1,y1,x2,y2 in lines:
        if abs(x1-x2) > 0.5 and abs(y1-y2) > 0.5:
            fails.append(f'⑥ 斜线 {((x1,y1),(x2,y2))}')
    # ⑥ 上下对称: 贴盒边引出行的首/末行到盒上/下边距必须相等 (用户: 上下左右引脚对称, 输出脚不贴底)
    for cx0,cy0,cw0,ch0,_k in chips:
        edge_rows = [y1 for x1,y1,x2,y2 in lines
                     if abs(y1-y2) < 0.5 and cy0+1 <= y1 <= cy0+ch0-1
                     and (abs(x1-cx0) < 0.5 or abs(x2-cx0) < 0.5
                          or abs(x1-(cx0+cw0)) < 0.5 or abs(x2-(cx0+cw0)) < 0.5)]
        if edge_rows:
            top_m = min(edge_rows) - cy0
            bot_m = (cy0+ch0) - max(edge_rows)
            if abs(top_m - bot_m) > 1:
                fails.append(f'⑥ 上下不对称: 上边距{top_m:.0f} vs 下边距{bot_m:.0f}')
    # ⑦ pin1 圆点(盒内, 任意行) + 引脚"符号(脚号)"
    if not chips: fails.append('⑦ 无芯片盒')
    else:
        x,y,w,h,_ = chips[0]
        if not any(x < cx < x+w and y < cy < y+h and r >= 4 for cx,cy,r in circles):
            fails.append('⑦ 盒内无pin1圆点')
    pin_labels = [t for x,y,fs,t in texts if re.search(r'\([0-9A-Za-z]+(-[0-9A-Za-z]+)?\)', t)]
    if not pin_labels: fails.append('⑦ 无"符号(脚号)"标注')
    # ⑧ 元件断端子
    bodies = [b for b in boxes if b[4] != 'chip']
    # 极板长度上限 34: 覆盖加宽后的反馈极板(2*PLATE_H=28)与去耦极板(2*DECAP_H=24)
    plates = [s for s in lines if (abs(s[0]-s[2])<0.5 or abs(s[1]-s[3])<0.5)
              and ((abs(s[0]-s[2])+abs(s[1]-s[3])) <= 34)]
    if not bodies and len(plates) < 2: fails.append('⑧ 无元件体/极板(断端子画法)')
    elif bodies:
        for bx,by,bw,bh,k in bodies:
            for seg in lines:
                (x1,y1,x2,y2) = seg
                N=10
                for i in range(1,N):
                    t=i/N; px,py=x1+t*(x2-x1), y1+t*(y2-y1)
                    if bx+0.5<px<bx+bw-0.5 and by+0.5<py<by+bh-0.5:
                        fails.append(f'⑧ 引线穿入元件体内部 @({px:.0f},{py:.0f})')
                        break
    # ① 盒外左/右均有标注
    if chips:
        # 标签重叠检查 (fs=10.5 引脚标签): PIL 实测 STHeiti 真实字宽 (0.62 系数曾误报 EMS3902)
        from PIL import ImageFont
        _ffont = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 11)
        anchors = {}
        for m in re.finditer(r'<text x="([-\d.]+)" y="([-\d.]+)"([^>]*)>', svg):
            a = 'end' if 'text-anchor="end"' in m.group(3) else 'start'
            anchors[(m.group(1), m.group(2))] = a
        # 盒内引脚标签 + 盒外箭头标注 (fs 自适应 7~13), 一起查重叠
        pl = [(x, y, fs, t) for x, y, fs, t in texts
              if (6.9 <= fs <= 10.6 or ('→' in t or '←' in t)) and y > 70]
        def bbox(x, y, fs, t):
            w = _ffont.getlength(t) * (fs / 11.0)
            a = anchors.get((('%g' % x), ('%g' % y)), 'start')
            if a == 'end': return (x - w, y - fs * 0.8, x, y + fs * 0.25)
            return (x, y - fs * 0.8, x + w, y + fs * 0.25)
        for i in range(len(pl)):
            for j in range(i+1, len(pl)):
                ax0, ay0, ax1, ay1 = bbox(*pl[i])
                bx0, by0, bx1, by1 = bbox(*pl[j])
                if ax0 < bx1 - 2 and bx0 < ax1 - 2 and ay0 < by1 - 2 and by0 < ay1 - 2:
                    fails.append(f'⑥ 标签重叠: "{pl[i][3]}" & "{pl[j][3]}"')
        left_lbl  = [t for x,y,fs,t in texts if x < chips[0][0]]
        right_lbl = [t for x,y,fs,t in texts if x > chips[0][0]+chips[0][2]]
        if not left_lbl:  fails.append('① 盒左无输入/控制标注')
        if not right_lbl: fails.append('① 盒右无输出标注')
        # ① 硬约定(用户裁定): "输入"标注必须在盒左、"输出"标注必须在盒右 (仅查粗13箭头标注)
        xl, xr = chips[0][0], chips[0][0]+chips[0][2]
        # 箭头标注识别: 含→/←且 fs>=7 (字号自适应后不再固定13)
        ann = [(x, t) for x, y, fs, t in texts if y > 70 and fs >= 6.9 and ('→' in t or '←' in t)]
        if not any('输入' in t and x < xl for x, t in ann):
            fails.append('① 左侧无"输入"标注')
        if not any('输出' in t and x > xr for x, t in ann):
            fails.append('① 右侧无"输出"标注')
        for x, t in ann:
            if '输入' in t and not x < xl: fails.append(f'① "输入"标注在右: "{t}" x={x}')
            if '输出' in t and not x > xr: fails.append(f'① "输出"标注在左: "{t}" x={x}')
    return fails, len(lines), len(pin_labels)

if __name__ == '__main__':
    all_pass = True
    for fn in sorted(f for f in os.listdir(OUT) if f.endswith('.svg')):
        fails, nl, npin = check(fn)
        tag = 'PASS' if not fails else 'FAIL'
        if fails: all_pass = False
        print(f'{tag}  {fn}  (线{nl}, 引脚标注{npin})')
        for f in fails: print('      -', f)
    sys.exit(0 if all_pass else 1)
