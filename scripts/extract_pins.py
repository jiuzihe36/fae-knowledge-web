#!/usr/bin/env python3
"""三路投票提取全部PDF Pin description -> /tmp/pins_all.json
A路: find_tables 表格
B路: 文本流 Symbol/Pin/Description 交替(逐行)
C路: 文本流 跨块匹配(Symbol块后跟Pin块)
规则: 多值symbol串与多pin串数量一致则zip, 否则symbol*len(pins)
"""
import fitz, os, json, re, sys
from collections import Counter

DIRS = {
 'logic': os.path.expanduser('~/Desktop/规格书/规格书/逻辑规格书'),
 'switch': os.path.expanduser('~/Desktop/规格书/规格书/模拟开关规格书'),
}

def cell(row, i):
    return str(row[i]).replace('\n', ' ').strip() if i is not None and i < len(row) and row[i] is not None else ''

# ---------- A: find_tables ----------
def extract_table(t):
    rows = t.extract()
    if not rows or len(rows) < 2: return None
    data = rows[1:]
    def is_pin_cell(x):
        x = x.replace(' ', '')
        return bool(re.fullmatch(r'[\d,]+', x)) and x
    def is_alpha_cell(x):
        return bool(re.fullmatch(r'[A-Za-z0-9][\w/.^,·\- ]*', x)) and len(x) < 80
    r0 = data[0]
    pin_col = sym_col = desc_col = None
    cands = []
    for i in range(len(r0)):
        if r0[i] is None: continue
        x = str(r0[i]).replace('\n',' ').strip()
        if is_pin_cell(x): cands.append((i, len(x)))
    if not cands: return None
    cands.sort(key=lambda t: -t[1])
    pin_col = cands[0][0]
    for i in range(len(r0)):
        if r0[i] is None: continue
        x = str(r0[i]).replace('\n',' ').strip()
        if sym_col is None and i != pin_col and is_alpha_cell(x) and i < pin_col:
            sym_col = i
        if desc_col is None and i != pin_col and is_alpha_cell(x) and i > pin_col:
            desc_col = i
    if sym_col is None:
        for i in range(len(r0)):
            if r0[i] is None: continue
            x = str(r0[i]).replace('\n',' ').strip()
            if sym_col is None and i != pin_col and is_alpha_cell(x):
                sym_col = i
    if desc_col is None:
        for i in range(len(r0)):
            if r0[i] is None: continue
            x = str(r0[i]).replace('\n',' ').strip()
            if desc_col is None and i != pin_col and is_alpha_cell(x):
                desc_col = i
    if pin_col is None: return None
    out = []
    _last_sym = ''
    for row in data:
        p = cell(row, pin_col)
        if not is_pin_cell(p): continue
        pins = [int(x) for x in re.split(r'[, ]+', p) if re.fullmatch(r'\d+', x)]
        if not pins: continue
        slist = []
        if sym_col is not None:
            raw = cell(row, sym_col)
            if not raw:
                raw = _last_sym
            else:
                _last_sym = raw
            slist = [x.strip() for x in raw.split(',') if x.strip()]
        else:
            slist = ['' for _ in pins]
        d = cell(row, desc_col) if desc_col is not None else ''
        if len(slist) == 1 and len(pins) > 1:
            slist = slist * len(pins)
        for pin, s in zip(pins, slist):
            out.append({'pin': int(pin), 'symbol': s, 'desc': d})
    return out or None

def page_tables(page):
    txt = page.get_text()
    if 'Pin description' not in txt and 'Pinning Information' not in txt:
        return None
    try:
        tabs = page.find_tables()
        for t in tabs.tables:
            r = extract_table(t)
            if r: return r
    except Exception:
        pass
    return None

# ---------- B: 文本流逐行交替 ----------
def text_flow(page):
    txt = page.get_text()
    if 'Pin description' not in txt: return None
    lns = [l.strip() for l in txt.splitlines() if l.strip()]
    try:
        start = next(i for i,l in enumerate(lns) if 'Pin description' in l)
    except StopIteration:
        return None
    out = []
    i = start + 1
    while i < len(lns) and lns[i] in ('Table 2. Pin description', 'Pin', 'Symbol', 'Description', 'No.', 'Name', 'Function'): i += 1
    while i < len(lns):
        l = lns[i]
        if re.match(r'^\d+\.\s', l) or re.match(r'^Table \d', l): break
        if re.fullmatch(r'[A-Za-z0-9][\w/.^,·\- ]*', l) and len(l) < 80:
            sym = l
            if i+1 < len(lns) and re.fullmatch(r'[\d,\s]+', lns[i+1]):
                pins = [int(x) for x in re.split(r'[, ]+', lns[i+1]) if re.fullmatch(r'\d+', x)]
                if pins:
                    desc = ''
                    if i+2 < len(lns) and not re.fullmatch(r'[\d,\s]+', lns[i+2]) and not lns[i+2].startswith(('Table','6.','7.','8.')):
                        desc = lns[i+2]
                        i += 3
                    else:
                        i += 2
                    sl = [x.strip() for x in sym.split(',') if x.strip()]
                    if len(sl) == 1 and len(pins) > 1: sl = sl * len(pins)
                    for p, s in zip(pins, sl):
                        out.append({'pin': p, 'symbol': s, 'desc': desc})
                    continue
        i += 1
    return out or None

# ---------- C: 文本跨块 ----------
def text_blocks(page):
    txt = page.get_text()
    if 'Pin description' not in txt: return None
    body = txt.split('Pin description', 1)[1]
    body = re.split(r'\n\s*\d+\.\s', body)[0]
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    k = 0
    while k < len(lines) and lines[k] in ('Symbol','Pin','Description','Table 2. Pin description'): k += 1
    out = []
    i = k
    while i < len(lines):
        l = lines[i]
        if re.match(r'^(Symbol|Pin|Description)$', l): i += 1; continue
        if re.fullmatch(r'[A-Za-z0-9][\w/.^,·\- ]*', l) and len(l) < 80:
            syms = [x.strip() for x in l.split(',') if x.strip()]
            j = i+1
            pin_l = None
            while j < min(i+4, len(lines)):
                ll = lines[j]
                if re.fullmatch(r'[\d,\s]+', ll):
                    pin_l = ll; break
                if re.fullmatch(r'[A-Za-z0-9]', ll[0]) and not re.fullmatch(r'[\d,\s]+', ll) and j > i+1: break
                j += 1
            if pin_l is not None:
                pins = [int(x) for x in re.split(r'[, ]+', pin_l) if re.fullmatch(r'\d+', x)]
                j2 = j+1
                desc = ''
                while j2 < min(j+4, len(lines)):
                    ll = lines[j2]
                    if re.match(r'^[A-Za-z].{6,}', ll) and not re.fullmatch(r'[\d,\s]+', ll):
                        desc = ll; break
                    j2 += 1
                if len(syms) == 1 and len(pins) > 1: syms = syms * len(pins)
                for p, s in zip(pins, syms):
                    out.append({'pin': p, 'symbol': s, 'desc': desc})
                i = (j2 if desc else j) + 1
                continue
        i += 1
    return out or None

def extract_text_fallback(page):
    return text_flow(page) or text_blocks(page)

def commit_extract(rows):
    seen = {}
    for r in rows:
        if r['pin'] in seen:
            if len(r.get('desc','')) > len(seen[r['pin']].get('desc','')):
                seen[r['pin']] = r
        else:
            seen[r['pin']] = r
    return [seen[k] for k in sorted(seen)]

def main():
    result = {}
    # 变体覆盖表: DRL(DFN1X1.2-6L?否定) 由 products.json package 直接给出
    prods = json.load(open(os.path.join(os.path.dirname(__file__),'..','data','products.json'), encoding='utf-8'))
    for it in prods:
        override_pkg(it['model'], it.get('package') or '')
    for cat, d in DIRS.items():
        for f in sorted(os.listdir(d)):
            if not f.endswith('.pdf'): continue
            base = f.split('_Product')[0].split('_Draft')[0]
            if base.endswith('.pdf'): base = base[:-4]
            doc = fitz.open(os.path.join(d, f))
            rows = None
            for pno in range(len(doc)):
                rows = page_tables(doc[pno])
                if rows: break
            if not rows:
                for pno in range(len(doc)):
                    rows = extract_text_fallback(doc[pno])
                    if rows: break
            doc.close()
            key = base
            if rows:
                fin = commit_extract(rows)
                if key in result and len(fin) < len(result[key][0]['pins']):
                    continue
                result[key] = [{'page': 0, 'pins': fin}]
            else:
                print('UNFOUND:', f)
    json.dump(result, open('/tmp/pins_all.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
    print('extracted models:', len(result))
    pc = Counter()
    for m, arr in result.items():
        pc[len(arr[0]['pins'])] += 1
    print('pin-count distribution:', dict(sorted(pc.items())))

if __name__ == '__main__':
    main()