#!/usr/bin/env python3
"""A方案写回：conditions下标修复 + 按(symbol,min,typ,max)匹配写回specs.conditions。
用法: python3 scripts/writeback_conditions.py
"""
import json, re

def fix_cond(c):
    s = c
    # VCC = x（V = x CC 碎片）
    s = re.sub(r'\bV\s*=\s*([\d.]+[^,;]*)CC\b', r'VCC = \1', s)
    s = re.sub(r'\bV\s+CC\b', 'VCC', s)
    # VA = x
    s = re.sub(r'\bV\s*=\s*([\d.]+[^,;]*?)\s+A\b(?!\w)', r'VA = \1', s)
    s = re.sub(r'\bV\s+A\b(?!\w)', 'VA', s)
    # VB0/VB1
    s = re.sub(r'\bV\s+(B\d?)\b', r'V\1', s)
    # IA = x
    s = re.sub(r'\bI\s*=\s*([\d.]+[^,;]*?)\s+A\b(?!\w)', r'IA = \1', s)
    s = re.sub(r'\bI\s+A\b(?!\w)', 'IA', s)
    # VSEL
    s = re.sub(r'\bV\s*=\s*([\d.]+[^,;]*?)\s+SEL\b', r'VSEL = \1', s)
    s = re.sub(r'\bV\s+SEL\b', 'VSEL', s)
    # VI = x
    s = re.sub(r'\bV\s*=\s*([\d.]+[^,;]*?)\s+I\b(?!\w)', r'VI = \1', s)
    # VO
    s = re.sub(r'\bV\s+O\b(?!\w)', 'VO', s)
    # IO
    s = re.sub(r'\bI\s+O\b(?!\w)', 'IO', s)
    # mA合拢
    s = re.sub(r'(\d)\s+m\s+A\b', r'\1 mA', s)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s

def norm_sym(s):
    return re.sub(r'\s+', '', s or '').upper()

def main():
    raw = json.load(open('/tmp/conditions_raw.json', encoding='utf-8'))
    p = '/Users/hu/fae-knowledge-web/data/products.json'
    d = json.load(open(p, encoding='utf-8'))
    # 建索引：(symbol_norm, min, typ, max) -> conditions
    # 需先知道每个spec属于哪个PDF：用source_document_id映射？sid不可靠。
    # 改用：按型号基找PDF（数字核匹配，同fix_function逻辑）
    pdf_by_num = {}
    import glob, os
    pdfs = sorted(glob.glob('/Users/hu/Desktop/规格书/规格书/逻辑规格书/*.pdf')
                  + glob.glob('/Users/hu/Desktop/规格书/规格书/模拟开关规格书/*.pdf'))
    pdfs = [x for x in pdfs if 'DS_Store' not in x]
    for x in pdfs:
        b = os.path.basename(x)
        m = re.match(r'^(.+?)(?:_Product|_Draft|_Drft)', b)
        pdf_by_num[b] = m.group(1) if m else b
    SUFFIX = re.compile(r'(GV|GW|GX|GS|GM|DRL|PW|RGY|RSA|UD|MS|RSW|DRC|DRB|YFC|YFQ|YFG|MSV|RSV|N|Q|D)$')
    def base(m):
        return SUFFIX.sub('', m or '')
    def numcore(s):
        m = re.search(r'(\d+G\d+|\d{2,4}[A-Z]*)$', s)
        return m.group(1) if m else s
    n_hit = 0
    n_miss = 0
    for x in d:
        b = base(x['model'])
        nc = numcore(b)
        # 找PDF
        pdfname = None
        for pn, stem in pdf_by_num.items():
            if nc in stem:
                pdfname = pn
                break
        if not pdfname:
            continue
        rows = raw.get(pdfname, [])
        # 建该PDF索引
        idx = {}
        for r in rows:
            key = (r[0], r[3], r[4], r[5])
            idx[key] = fix_cond(r[2])
        for s in (x.get('specs') or []):
            # 从value反解min/typ/max
            v = str(s.get('value', ''))
            mmin = re.search(r'min=([^;]+)', v)
            mtyp = re.search(r'typ=([^;]+)', v)
            mmax = re.search(r'max=([^;]+)', v)
            if not (mmin or mtyp or mmax):
                continue
            sym = norm_sym(re.split(r'\|', str(s.get('param', '')))[0].strip().split()[0:2].__str__())
            # param首token：如 "V IH | ..." -> VIH；"R ON" -> RON
            ptokens = re.split(r'\s*\|\s*', str(s.get('param', '')))[0].strip().split()
            sym = norm_sym(''.join(ptokens[:2]))
            key = (sym,
                   mmin.group(1).strip() if mmin else '',
                   mtyp.group(1).strip() if mtyp else '',
                   mmax.group(1).strip() if mmax else '')
            if key in idx and idx[key]:
                s['conditions'] = idx[key]
                n_hit += 1
            else:
                n_miss += 1
    print('写回conditions:', n_hit, '未匹配:', n_miss, flush=True)
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
