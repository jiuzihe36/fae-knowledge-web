#!/usr/bin/env python3
"""A方案全量：固定列位提取Conditions，symbol续行继承，写回specs.conditions。
用法: python3 scripts/reextract_conditions.py [--apply]
"""
import fitz, glob, os, json, re, sys

LOGIC = '/Users/hu/Desktop/规格书/规格书/逻辑规格书'
ANALOG = '/Users/hu/Desktop/规格书/规格书/模拟开关规格书'

def clean(cell):
    if not cell:
        return ''
    return re.sub(r'\s+', ' ', cell.replace('\n', ' ')).strip()

def norm_sym(s):
    # V IH -> VIH；下标空格合并（VIH/VIL/RON/IOZ/ICC/TA/TJ等）
    s = re.sub(r'\s+', '', s)
    return s

def extract_pdf(pdf):
    """返回 [(symbol_norm, param, conditions, min, typ, max, unit)]"""
    out = []
    try:
        doc = fitz.open(pdf)
    except Exception:
        return out
    for page in doc:
        try:
            tables = list(page.find_tables())
        except Exception:
            continue
        for t in tables:
            try:
                rows = t.extract()
            except Exception:
                continue
            if len(rows) < 3:
                continue
            hdr = ' '.join(clean(c) for c in rows[1])
            if 'Conditions' not in hdr and 'Min' not in hdr:
                continue
            # 列位：找表头 Symbol/Conditions/Min/Typ/Max/Unit 的列索引
            h = [clean(c) for c in rows[1]]
            def find(*names):
                for i, x in enumerate(h):
                    for n in names:
                        if n.lower() in x.lower() and x:
                            return i
                return -1
            i_sym = find('Symbol')
            i_par = find('Parameter')
            i_con = find('Condition')
            i_min = find('Min')
            i_typ = find('Typ')
            i_max = find('Max')
            i_uni = find('Unit')
            if i_sym < 0 or i_min < 0:
                continue
            last_sym = ''
            last_par = ''
            for r in rows[2:]:
                if len(r) <= max(i_sym, i_min):
                    continue
                sym = clean(r[i_sym]) if i_sym < len(r) else ''
                par = clean(r[i_par]) if i_par >= 0 and i_par < len(r) else ''
                if sym:
                    last_sym = sym
                if par:
                    last_par = par
                cond = clean(r[i_con]) if i_con >= 0 and i_con < len(r) else ''
                vmin = clean(r[i_min]) if i_min < len(r) else ''
                vtyp = clean(r[i_typ]) if i_typ >= 0 and i_typ < len(r) else ''
                vmax = clean(r[i_max]) if i_max >= 0 and i_max < len(r) else ''
                uni = clean(r[i_uni]) if i_uni >= 0 and i_uni < len(r) else ''
                if not last_sym:
                    continue
                if not (vmin or vtyp or vmax):
                    continue
                out.append((norm_sym(last_sym), last_par, cond, vmin, vtyp, vmax, uni))
    doc.close()
    return out

def main():
    apply = '--apply' in sys.argv
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if 'DS_Store' not in p]
    print('PDF:', len(pdfs), flush=True)
    allrows = {}
    for pdf in pdfs:
        rows = extract_pdf(pdf)
        allrows[os.path.basename(pdf)] = rows
    nrows = sum(len(v) for v in allrows.values())
    print('提 conditions行:', nrows, flush=True)
    json.dump({k: v for k, v in allrows.items()},
              open('/tmp/conditions_raw.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    # EMS3157抽查
    for r in allrows.get('EMS3157_Product_DS_V1.8.pdf', [])[:10]:
        print('  ' + str(r[0])[:12] + ' cond=[' + r[2][:40] + '] min=' + r[3] + ' typ=' + r[4] + ' max=' + r[5], flush=True)

if __name__ == '__main__':
    main()
