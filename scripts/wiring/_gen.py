# 芯祥应用电路 SVG 生成器 —— 严格复刻官方 EM74CBT3257_wiring.svg 版式
# 版式规范(从官方原图逐项提取):
#   标题(360,30,17粗)="型号 使用接线图 · 封装"  副标题(360,52,12灰)="功能 · VCC 范围 · 左=控制/输入，右=输出"
#   芯片名(365,118,14粗)在盒上方; 盒(300,130,130,240); 引脚10.5px逐行铺满[169,361]
#   左标签x=308(start) 线300→170, 标注(52,y-4)粗13 "XX →"; 右标签x=422(end) 线430→560, 标注(568,y-4)粗13 "→ XX"
#   VCC=右首行 430→520→上轨78; GND=左末行 →左出→下轨400; NC=左行仅标签无线
#   去耦 C 100nF: 标签(600,118,end,13), x=640 78→195 极板195/205 →400
#   pin1=空心圆 r4.5 stroke2 在pin1行旁(±24, +18)
# 引脚100%来自 datasheet Pin description 表抽取。
import fitz, json, os, re

DS = '/Users/hu/fae-knowledge-web/datasheets'
OUT = '/Users/hu/fae-knowledge-web/circuits'
os.makedirs(OUT, exist_ok=True)

BOX = (300, 130, 130, 240)          # x,y,w,h (盒中心 y=250)
ROW0, ROW1 = 169, 331               # 引脚行首/末 y: 上下边距39/39, 关于中心250镜像对称 (用户: 上下左右对称)
LEFT_LBL, RIGHT_LBL = 308, 422
L_WIRE_END, R_WIRE_END = 170, 560
VCC_BEND = 520
DECAP_X = 640
# 电容极板尺寸(用户指正"电容太窄"): 极板间距=2*PLATE_GAP, 极板高=2*PLATE_H
# 反馈线 fb=385 夹在盒底(370)与GND轨(400)之间, 可用高仅30px -> 极板高须<=14 才不贴轨/贴盒
# "窄"靠加大极板间距解决(28), 不靠加高 (高28时底端399贴死GND轨, 用户指正"和下面的线重叠")
PLATE_GAP, PLATE_H = 14, 7         # 反馈 C: 间距28 / 高14
DECAP_GAP, DECAP_H = 13, 12        # 去耦 C 100nF: 间距26 / 高24
PKG_SUFFIX = ['DRL','DB','PW','NS','DR','DW','GV','GW','GM','GS','GX','D','W','G','V']

def base_model(m):
    for s in sorted(PKG_SUFFIX, key=len, reverse=True):
        if m.endswith(s) and len(m) - len(s) >= 5:
            return m[:-len(s)]
    return m

def _range_of(sym):
    """'1B1 to 4B1' -> ('', 'B1', 1, 4); 'A0 to A7' -> ('A', '', 0, 7); 不是范围返回 None"""
    m = re.fullmatch(r'([A-Za-z]*)(\d+)([A-Za-z]?\d*)\s+to\s+([A-Za-z]*)(\d+)([A-Za-z]?\d*)', (sym or '').strip())
    if not m: return None
    pre1, n1, suf1, pre2, n2, suf2 = m.groups()
    if pre1 != pre2 or suf1 != suf2: return None
    return (pre1, suf1, int(n1), int(n2))

def extract_pins(pdf_path):
    doc = fitz.open(pdf_path)
    pages = [pg.get_text() for pg in doc]
    doc.close()
    # 表格可能跨页: 从含 Pin description 的页起连取4页 (旧版只拼关键词页->跨页截断)
    start_pg = next((i for i,t in enumerate(pages) if 'Pin description' in t), None)
    if start_pg is None:
        start_pg = next((i for i,t in enumerate(pages) if 'Pinning' in t), 0)
    text = ''.join(pages[start_pg:start_pg+4])
    # block 起点: 取"Pin description"后120字符内出现表头 Symbol/Pin No 的那次(避开目录项)
    ms = list(re.finditer(r'Pin description\s*', text))
    chosen = None
    for mm in ms:
        if re.search(r'(Symbol|Pin No)', text[mm.end():mm.end()+120]):
            chosen = mm; break
    if chosen is None and ms: chosen = ms[-1]
    rest = text[chosen.end():] if chosen else text
    m = re.search(r'(.*?)(?=Functional Description|Function table|\n\s*\d{1,2}\.\s)', rest, re.S)
    block = m.group(1) if m else rest
    lines = [l.strip() for l in block.splitlines() if l.strip()]
    # 表头定位: Symbol/Pin No./Package... 连续表头词跳过
    HDR = {'symbol','pin','type','description','name','signal type','signal','no.','package','pkg'}
    def is_hdr(l):
        ll = l.lower()
        return ll in HDR or ll.startswith('pin no')
    start = 0
    for i, l in enumerate(lines):
        if is_hdr(l): start = i; break
    while start < len(lines) and is_hdr(lines[start]): start += 1
    def is_pin(s):
        if re.fullmatch(r'[\d,\s]+', s) and any(c.isdigit() for c in s): return True      # '1' '1, 5'
        if (re.fullmatch(r'[0-9A-Z,\s]+', s) and any(c.isdigit() for c in s)
                and len(s) <= 12 and (',' in s or len(s.replace(' ','')) <= 3)): return True  # 球位 'A1' 'B2'
        return False
    def is_type(s):   # Signal Type 列
        return (len(s) <= 5 and '.' not in s
                and (s in {'I','O','I/O','IO','PWR','GND','NC','DT','BI','AI','AO'} or bool(re.fullmatch(r'[-—/]+', s))))
    TSUF = {'I':' input', 'O':' output', 'I/O':' bidirectional', 'IO':' bidirectional'}
    FURN = ('rev.', ' mm ', '×', 'height', 'top view', 'fig ', 'pin map', 'ordering', 'marking')  # 页眉页脚/ordering 垃圾行
    pins = []
    i = start
    while i + 1 < len(lines):
        a, b = lines[i], lines[i+1]
        c = lines[i+2] if i+2 < len(lines) else ''
        d = lines[i+3] if i+3 < len(lines) else ''
        # 续行/垃圾行跳过: '(' 开头, 或含空格且无数字 (desc 折行 'System Ground' / 'HIGH; ...')
        if a.startswith('(') or (' ' in a and not any(ch.isdigit() for ch in a)):
            i += 1; continue
        sym = pn = tp = dl = None; step = 1
        if is_pin(a) and not is_pin(b):
            # 布局4: Pin | Name(可折1行) | Type | Description
            for k in (2, 3, 4):
                if i+k+1 < len(lines) and is_type(lines[i+k]) and all(len(x) <= 15 for x in lines[i+1:i+k]):
                    sym, pn, tp, dl = ' '.join(lines[i+1:i+k]), a, lines[i+k], lines[i+k+1]
                    step = k + 2; break   # dl 在 i+k+1, 下一 pin 从 i+k+2 起 (EMS4485 desc含数字时错位教训)
        # 句子折行过滤: a 含标点且长, 且逗号分段后有带空格的段 = 上一 desc 的续行 (EMS4485)
        # sym 列表 'A0, A1, ..., A7' 每段无空格, 不算句子 (HC245 教训)
        _a_is_sentence = len(a) > 25 and any(' ' in seg for seg in a.split(', '))
        if sym is None and (is_pin(b) or b in ('-','—')) and not _a_is_sentence:
            # sym | Pin列(1~3个封装列, '-'占位) | [Type] | Description
            # 句子折行过滤: a 含标点且长 = 上一 desc 的续行, 不能当 sym (EMS4485)
            pns, j = [], i+1
            if b in ('-','—'):
                pns.append('-'); j = i+2
            while j < len(lines) and is_pin(lines[j]):
                pns.append(lines[j]); j += 1
            if pns:
                if j < len(lines) and is_type(lines[j]):
                    tp = lines[j]; j += 1
                if j < len(lines):
                    dl = lines[j]; j += 1
                    # 缺描述: dl 是大写符号形(如 'GND')且下一行是 pin -> 本行 desc 缺失, 不消费该行
                    # (仅限大写符号形: 'Input'/'Output' 等正常短 desc 不能误丢)
                    if dl and re.fullmatch(r'[A-Z0-9_/#+(),.\-]{1,12}', dl) and ' ' not in dl and j < len(lines) and is_pin(lines[j]):
                        dl = ''; j -= 1
                    sym, pn, step = a, next((p for p in pns if p != '-'), '-'), j - i
        if sym is None or not dl and dl != '':
            i += 1; continue
        if sym in ('-','—'): sym = 'NC'
        sym = re.sub(r'\s*\[\d+\]\s*$', '', re.sub(r'\s+', ' ', sym)).strip()  # 'GND  [1]' -> 'GND' (去脚注/挤空格)
        joined = (sym + ' ' + dl).lower()
        if any(tok in joined for tok in FURN):   # ordering/页脚垃圾行
            i += step; continue
        dl = dl + TSUF.get(tp, '')
        syms = [x.strip() for x in sym.split(',') if x.strip()]
        pns = [x.strip() for x in pn.split(',') if x.strip()]
        if len(syms) == 1 and len(pns) > 1:
            # 组符号按脚位展开: '1B1 to 4B1'/'A0 to A7'×N脚 -> 逐脚短标签 (防中间区叠字)
            rng = _range_of(syms[0])
            if rng and rng[3] - rng[2] + 1 == len(pns):
                pre, suf, a0 = rng[0], rng[1], rng[2]
                pairs = [(f'{pre}{i}{suf}', p) for i, p in zip(range(a0, a0+len(pns)), pns)]
            else:
                pairs = [(syms[0], p) for p in pns]
        else:
            pairs = list(zip(syms, pns))
        for s, p in pairs: pins.append((p, s, dl))
        i += step
    # 行级组符号展开: 同一范围符号(如 '1B1 to 4B1')重复 N 行 -> 按出现序逐脚编号 (CBT3257: 每行单脚)
    from collections import Counter
    cnt = Counter(s for _, s, _ in pins)
    seen = Counter()
    out = []
    for p, s, dl in pins:
        rng = _range_of(s)
        if rng and cnt[s] == rng[3] - rng[2] + 1:
            idx = seen[s]; seen[s] += 1
            s = f'{rng[0]}{rng[2] + idx}{rng[1]}'
        out.append((p, s, dl))
    return out

def func_type(fd):
    fd = fd or ''
    if '施密特' in fd: return 'schmitt'
    if '收发' in fd: return 'xcvr'
    if '复用' in fd or '多路选择' in fd: return 'mux'
    if '开关' in fd: return 'analog_sw'
    return 'portmap'   # 门/缓冲/寄存器/通用 -> 端口映射模板(输入左/输出右)

def role(kind, sym, desc):
    """返回 ('gnd'|'vcc'|'nc'|'L'|'R', 标注词) — 方向词全部取自 datasheet 实文"""
    dl = (desc or '').lower(); s = (sym or '').strip(); su = s.upper()
    if 'ground' in dl or su.startswith('GND'): return 'gnd', ''
    if 'supply' in dl or su.startswith(('VCC','VDD')): return 'vcc', ''
    if 'n.c' in dl or 'no connect' in dl or su in ('NC','N.C.'): return 'nc', ''
    if 'select' in dl or su.startswith('SEL') or su == 'S': return 'L', '选择控制'
    if 'enable' in dl: return 'L', '使能'
    if 'direction' in dl.split('bidirectional')[0] or re.search(r'\bdirection\b', dl) or su == 'DIR': return 'L', '方向控制'
    if 'clock' in dl: return 'L', '时钟'
    if 'reset' in dl or 'clear' in dl: return 'L', '复位'
    # 端口方向 (datasheet 用词: common/COM port/A-port/B-port/port1/2/channel/lane/codec)
    if 'common' in dl or re.search(r'\bcom\b', dl): return 'R', '输出'
    if re.search(r'\ba[- ]?port\b', dl) or 'for port a' in dl: return 'L', '输入'
    if re.search(r'\bb[- ]?port\b', dl) or 'for port b' in dl: return 'R', '输出'
    if 'codec' in dl: return 'R', '输出'          # MICP 通 codec = 去向 (EMS4798)
    if 'jack' in dl: return 'L', '输入'           # 插孔触点 = 信号入口 (EMS4798 RING/SLEEVE)
    if kind == 'analog_sw':
        # 通路开关 port1/port2: port1(常闭侧)=入口左, port2(常开侧)=出口右 (EMS3580 类)
        if re.search(r'port 2\b', dl): return 'R', '输出'
        if re.search(r'port 1\b', dl): return 'L', '输入'
        # SPDT 抛位端 NO/NC = 通道侧在左, 公共端 COM 在上条已判右 (EMS23157/2750/3905)
        if 'normally open' in dl or 'normally closed' in dl: return 'L', '输入'
        # B 端子(通道)在左: sym 含 Bn (CBT3257 '1B1 to 4B1')
        if any(re.fullmatch(r'\d*B\d*', t) for t in s.split()): return 'L', '输入'
        # 硬约定①(用户裁定): 公共端 A/1A..4A -> 右=输出; 其余通道兜底左=输入
        if any(re.fullmatch(r'\d*A', t) for t in s.split()): return 'R', '输出'
        # 数字组分侧: 1组(入口)在左, 2组(出口)在右, 无数字兜底左 (EMS3900 HSD±, EMS4000 通道)
        m = re.search(r'(\d)', s.rstrip('+-'))
        if m: return ('L', '输入') if m.group(1) == '1' else ('R', '输出')
    if kind == 'mux':
        # 单向词优先: Y=output→右, A=address input→左 (HC138)
        if 'output' in dl and 'input' not in dl: return 'R', '输出'
        if 'input' in dl and 'output' not in dl: return 'L', '输入'
        # 双向/无词: A 类公共端→右 (CBTLV3257 '1A to 4A'), 带尾数字通道→左 (DP1/RX2-)
        if any(re.fullmatch(r'\d*A', t) for t in s.split()): return 'R', '输出'
        if re.search(r'\d$', s.rstrip('+-')): return 'L', '输入'
        # A/B 后缀通道 (EMS4310 'D0+A'/'D0-B'): A侧=左输入, B侧=右输出 (245 惯例)
        if re.search(r'[+-]A$', s): return 'L', '输入'
        if re.search(r'[+-]B$', s): return 'R', '输出'
        return 'R', '输出'
    if kind == 'xcvr':
        if su[:1] == 'A': return 'L', '输入' if 'input' in dl else '信号'
        if su[:1] == 'B': return 'R', '输出' if 'output' in dl else '信号'
    if 'input' in dl and 'output' in dl:
        # 双向口: A类在左当输入, B类在右当输出 (245/3125 惯例)
        return ('L', '输入') if next((ch for ch in su if ch.isalpha()), '') == 'A' else ('R', '输出')
    if 'input' in dl: return 'L', '输入'
    if 'output' in dl: return 'R', '输出'
    if 'in-out' in dl or 'bidirectional' in dl or 'i/o' in dl:
        return ('L', '输入') if next((ch for ch in su if ch.isalpha()), '') == 'A' else ('R', '输出')
    if kind == 'analog_sw': return 'L', '输入'   # 模拟开关通道兜底在左
    return 'R', '信号'

# ---------- SVG 基元（尺寸全部对齐官方原图） ----------
def L(x1,y1,x2,y2,sw=2): return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#111" stroke-width="{sw}"/>'
def NODE(x,y): return f'<circle cx="{x}" cy="{y}" r="4" fill="#111"/>'
def T(x,y,t,size=12,anchor='start',bold=False,color='#111'):
    b=' font-weight="bold"' if bold else ''
    a=f' text-anchor="{anchor}"' if anchor!='start' else ''
    return f'<text x="{x}" y="{y}"{a} font-size="{size}"{b} fill="{color}">{t}</text>'
def JUMP_H(x, y, r=9):
    # 向上拱的半圆跳线(电气惯例): y轴向下时 sweep=1 才走上方弧 (sweep=0 是向下翻, 曾改反)
    # 被跨的线须在 x±r 处留断口, 否则仍是十字交叉
    return f'<path d="M{x-r},{y} A{r},{r} 0 0,1 {x+r},{y}" fill="none" stroke="#111" stroke-width="2"/>'

def chrome(model, pkg, func, volt):
    title = f'{base_model(model)} 使用接线图 · {pkg}'
    sub = f'{func} · VCC {volt} · 左=控制/输入，右=输出'
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 440" font-family="Helvetica,Arial,sans-serif">',
            '<rect width="720" height="440" fill="#fff"/>',
            T(360,30,title,17,'middle',True), T(360,52,sub,12,'middle',False,'#666'),
            L(60,78,660,78,2.5), T(48,83,'VCC',14,'end',True),
            L(60,400,660,400,2.5), T(48,405,'GND',14,'end',True),
            T(365,118,f'{base_model(model)} · {pkg}',14,'middle',True)]

def decap():
    # 标签贴极板右侧(用户指正: 放顶部 y=118 偏离电容); x=656 避开右列标注(≤623)与画布边(720)
    return [T(656, 205, 'C 100nF', 13),
            L(DECAP_X,78,DECAP_X,195),
            L(DECAP_X-DECAP_GAP,195,DECAP_X+DECAP_GAP,195,2.5),
            L(DECAP_X-DECAP_GAP,205,DECAP_X+DECAP_GAP,205,2.5),
            L(DECAP_X,205,DECAP_X,400)]

def pullup_R(x_node, y_node, label):
    # 上拉电阻: 轨→引线→白底矩形体14x30→引线→节点 (HC14 官方图风格)
    rtop = max(y_node-59, 90)
    return [L(x_node,78,x_node,rtop),
            f'<rect x="{x_node-7}" y="{rtop}" width="14" height="30" fill="#fff" stroke="#111" stroke-width="2"/>',
            L(x_node,rtop+30,x_node,y_node), NODE(x_node,y_node),
            # 标签放电阻体左侧(end锚点): 旧值 x_node+16 会向右压到 GND/信号竖线 (HC125 等 8 例压线)
            T(x_node-14, rtop+21, label, 13, 'end')]

def gen(model, pkg, pins, kind, func, volt, fd):
    bx,by,bw,bh = BOX
    bR = bx+bw
    s = chrome(model, pkg, func, volt)
    # 分侧: vcc进右首, gnd进左末, nc左无线上拉, 其余按 role
    left, right, gnds = [], [], []
    for pn, sym, desc in pins:
        side, word = role(kind, sym, desc)
        if side == 'vcc': right.insert(0, (sym,pn,desc,''))
        elif side == 'gnd': gnds.append((sym,pn,desc,''))   # 强制左末行(官方先例)
        elif side == 'nc': left.append((sym,pn,desc,None))   # None=NC 仅标签
        elif side == 'L': left.append((sym,pn,desc,word))
        else: right.append((sym,pn,desc,word))
    left += gnds
    if not left or not right:
        return None, f'分侧失败(left={len(left)},right={len(right)})'
    # 行分布: 铺满 [169,331] (关于盒中心对称, 左右列首末行对齐; 首行=官方169, 末行331=370-39)
    def rows(n):
        if n == 1: return [(ROW0+ROW1)//2]
        step = (ROW1-ROW0)/(n-1)
        return [round(ROW0+i*step,1) for i in range(n)]
    rl, rr = rows(len(left)), rows(len(right))
    # 自适应标签字号: 行距<12px 时按行距缩 (EMS4422 右21行行距8.1, 10.5px 必叠)
    def _fs(n, base=10.5):
        if n <= 1: return base
        st = (ROW1-ROW0)/(n-1)
        return round(min(base, max(7.0, st - 1.8)), 1)
    fsL, fsR = _fs(len(left)), _fs(len(right))
    fsAL, fsAR = _fs(len(left), 13), _fs(len(right), 13)   # 盒外中文标注字号
    # 标签碰撞消解: 左右标签在盒内中间区相撞时 (EMS4485 'INT/ CMPOUT' vs 'SENSE'),
    # 逐轮把较宽的标签等比缩字号 (下限 7.0px), 缩到不撞为止
    from PIL import ImageFont as _IF
    _lf = _IF.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 11)
    def _tw(t, fs): return _lf.getlength(t) * fs / 11.0
    fsLs = [fsL] * len(left); fsRs = [fsR] * len(right)
    txtL = [f'{sym} ({pn})' for sym, pn, *_ in left]
    txtR = [f'{sym} ({pn})' for sym, pn, *_ in right]
    def _hit(t1, y1, f1, t2, y2, f2):
        # 左 start@LEFT_LBL, 右 end@RIGHT_LBL; bbox y = (y-f*0.8, y+f*0.25)
        x1a, x1b = LEFT_LBL, LEFT_LBL + _tw(t1, f1)
        x2a, x2b = RIGHT_LBL - _tw(t2, f2), RIGHT_LBL
        y1a, y1b = y1 - f1*0.8, y1 + f1*0.25
        y2a, y2b = y2 - f2*0.8, y2 + f2*0.25
        return x1a < x2b - 2 and x2a < x1b - 2 and y1a < y2b - 2 and y2a < y1b - 2
    for _round in range(30):
        hit = False
        for i in range(len(left)):
            for j in range(len(right)):
                if _hit(txtL[i], rl[i]+4, fsLs[i], txtR[j], rr[j]+4, fsRs[j]):
                    hit = True
                    wl, wr = _tw(txtL[i], fsLs[i]), _tw(txtR[j], fsRs[j])
                    if wl >= wr and fsLs[i] > 7.0: fsLs[i] = round(max(7.0, fsLs[i]*0.92), 2)
                    elif fsRs[j] > 7.0: fsRs[j] = round(max(7.0, fsRs[j]*0.92), 2)
                    else: hit = False  # 都到下限, 交给验收器把关
        if not hit: break
    # 盒
    s.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="5" fill="#f7f9fb" stroke="#111" stroke-width="2.5"/>')
    # 门/施密特类: 第一输入行加上拉 R
    want_R = kind == 'schmitt' or ('门' in fd or '与' in fd or '或' in fd or '非' in fd)
    first_in_idx = None
    if want_R:
        for i,(sym,pn,desc,w) in enumerate(left):
            if w not in (None, '', '选择控制','使能','方向控制','时钟','复位'):
                first_in_idx = i; break
    R_label = 'R 100kΩ' if kind=='schmitt' else 'R 10kΩ'
    r_node_y = None
    # 左侧
    for i,(sym,pn,desc,w) in enumerate(left):
        y = rl[i]
        s.append(T(LEFT_LBL, y+4, f'{sym} ({pn})', fsLs[i]))
        if w is None:      # NC: 仅标签 (官方先例 n.c. (15))
            continue
        if w == '':        # GND: 左出→下轨 (施密特走210, 避开反馈竖线x=150短路)
            gx = 210 if kind == 'schmitt' else 150
            s.append(L(bx,y,gx,y)); s.append(L(gx,y,gx,400))
            continue
        if i == first_in_idx:
            s.append(L(bx,y,150,y)); s += pullup_R(150, y, R_label); r_node_y = y
        else:
            s.append(L(bx,y,L_WIRE_END,y))
        s.append(T(52, y-4, f'{w} →', fsAL, 'start', True))
    # 右侧
    first_out_y = None
    for i,(sym,pn,desc,w) in enumerate(right):
        y = rr[i]
        s.append(T(RIGHT_LBL, y+4, f'{sym} ({pn})', fsRs[i], 'end'))
        if w == '':        # VCC: 右出→上轨 (官方先例)
            s.append(L(bR,y,VCC_BEND,y)); s.append(L(VCC_BEND,y,VCC_BEND,78))
            continue
        s.append(L(bR,y,R_WIRE_END,y))
        s.append(T(568, y-4, f'→ {w}', fsAR, 'start', True))
        if first_out_y is None and kind == 'schmitt' and 'output' in (desc or '').lower():
            first_out_y = y
    if kind == 'schmitt' and first_out_y is None and right:
        # desc 没写 output 时取第一个非VCC右行
        first_out_y = rr[1] if len(rr) > 1 else rr[0]
    # pin1 空心圆: pin1 所在侧行旁 (官方 cx=侧±24, cy=行+18; 行密时收紧避免压下一行标签)
    p1_side, p1_y, p1_idx = 'L', ROW0, 0
    for i,(sym,pn,desc,w) in enumerate(left):
        if str(pn) == '1': p1_side, p1_y, p1_idx = 'L', rl[i], i; break
    else:
        for i,(sym,pn,desc,w) in enumerate(right):
            if str(pn) == '1': p1_side, p1_y, p1_idx = 'R', rr[i], i; break
    rows_side = rl if p1_side == 'L' else rr
    cx1 = (bx+24) if p1_side=='L' else (bR-24)
    if p1_idx < len(rows_side) - 1:
        step = rows_side[p1_idx+1] - p1_y
        if step >= 29:   cy1 = p1_y + 18      # 官方偏移(空隙够)
        elif step >= 19: cy1 = p1_y + 8       # 紧贴本行标签下缘
        else:            cy1, cx1 = by + 11, ((bx+11) if p1_side=='L' else (bR-11))  # 过密->标准左上角
    else:                cy1 = p1_y + 18 if p1_y + 22.5 <= 366 else p1_y - 12  # 同侧末行
    s.append(f'<circle cx="{cx1}" cy="{cy1}" r="4.5" fill="none" stroke="#111" stroke-width="2"/>')
    # 施密特: RC 反馈 1Y → 绕过标注区(x=630) → 绕底 y=385 → 1A节点; C 串联非对地
    if kind == 'schmitt':
        if first_out_y is None or r_node_y is None:
            return None, '施密特缺1A/1Y行'
        gnd_x = 210   # 施密特 GND 下线走210(与左段gx一致), 避开反馈竖线 x=150 短路
        fb = 385
        # 下行线走 x=612 (去耦极板占 627..653, 旧值630会与极板相撞形成假交叉)
        s.append(L(R_WIRE_END, first_out_y, 612, first_out_y))
        s.append(L(612, first_out_y, 612, fb))
        # 线序(左→右): 150反馈竖线 ─ [C极板] ─ 断口跳线跨GND竖线(x=210) ─ 630下行
        # 极板放在 150..(210-gap) 段中点, 与跳线断口、GND竖线均不重叠 (旧版叠在210上"成一坨")
        gap = 13
        lo, hi = 150, gnd_x - gap          # 可用段 [150, 197]
        mid = (lo + hi) // 2               # 极板中心 ~173
        s.append(L(mid - PLATE_GAP, fb, 150, fb))                                            # 左引线
        s.append(L(mid - PLATE_GAP, fb - PLATE_H, mid - PLATE_GAP, fb + PLATE_H, 2.5))       # 左极板
        s.append(L(mid + PLATE_GAP, fb - PLATE_H, mid + PLATE_GAP, fb + PLATE_H, 2.5))       # 右极板
        s.append(L(mid + PLATE_GAP, fb, gnd_x - gap, fb))                                    # 右引线到断口
        s.append(JUMP_H(gnd_x, fb, gap))                    # 向上拱桥跨 GND 竖线(真断开, 非装饰)
        s.append(L(gnd_x + gap, fb, 612, fb))               # 断口右侧继续
        # C 10nF 标签放极板左侧空白区(x=96): 旧值 x=199 会横跨 x=210 的GND竖线 -> 文字压线糊成一坨
        s.append(T(96, fb + 4, 'C 10nF', 13))
        s.append(L(150, fb, 150, r_node_y))
        s.append(NODE(150, r_node_y))
    s += decap()
    s.append('</svg>')
    return ''.join(s), None

if __name__ == '__main__':
    d = json.load(open('/Users/hu/fae-knowledge-web/data/products.json'))
    prods = d if isinstance(d, list) else d.get('products', [])
    ok, bad = 0, []
    for m in ['EM74LVC00AD', 'EM74HC14D', 'EM74LVC245AD', 'EL3157GV']:
        hit = [p for p in prods if p['model'] == m]
        if not hit: bad.append((m,'目录缺失')); continue
        h = hit[0]
        pins = extract_pins(f'{DS}/{h["source_label"]}')
        if not pins: bad.append((m,'引脚抽取为空')); continue
        kind = func_type(h['function_detail'])
        svg, err = gen(m, h['package'], pins, kind, h['function'], h['voltage'], h['function_detail'])
        if err: bad.append((m,err)); continue
        fn = re.sub(r'[^A-Za-z0-9]', '_', m) + '_wiring.svg'
        open(f'{OUT}/{fn}', 'w').write(svg)
        print('生成', fn, len(svg), 'B | 引脚', len(pins), '| 模板', kind)
        ok += 1
    for m,e in bad: print('失败', m, e)
    print(f'完成 {ok}/4')
