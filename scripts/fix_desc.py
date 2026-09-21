#!/usr/bin/env python3
"""从201 PDF封面提功能描述，修复description封装碎片问题。
只读PDF，只写data/products.json。用法: python3 scripts/fix_desc.py
"""
import fitz, json, glob, os, re

LOGIC = '/Users/hu/Desktop/规格书/规格书/逻辑规格书'
ANALOG = '/Users/hu/Desktop/规格书/规格书/模拟开关规格书'

def cover_desc(pdf):
    """封面第2-3行即功能描述，如 Quad 2-input NAND gate"""
    try:
        doc = fitz.open(pdf)
    except Exception:
        return ''
    t = doc[0].get_text()
    doc.close()
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    # 第0行是型号，第1行是功能描述（跳过Rev/datasheet行）
    for l in lines[1:4]:
        if re.search(r'Rev|datasheet|Draft|©|Energy', l, re.I):
            continue
        if re.match(r'^(EM|EXS|EL)', l):
            continue
        if len(l) >= 8:
            return l
    return ''

def main():
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if 'DS_Store' not in p]
    print(f'PDF: {len(pdfs)}', flush=True)
    # 建型号->描述映射（同一PDF覆盖多个型号，如HC00/HCT00）
    pdf_descs = {}
    for pdf in pdfs:
        d = cover_desc(pdf)
        pdf_descs[os.path.basename(pdf)] = d
    ok = sum(1 for v in pdf_descs.values() if v)
    print(f'提 到描述: {ok}/{len(pdfs)}', flush=True)
    for k, v in list(pdf_descs.items())[:5]:
        print(f'  {k}: {v}', flush=True)
    json.dump(pdf_descs, open('/tmp/cover_descs.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # 映射到products：按source_document_id找PDF
    pdf_by_id = {i + 1: os.path.basename(p) for i, p in enumerate(pdfs)}
    p = os.path.expanduser('~/fae-knowledge-web/data/products.json')
    data = json.load(open(p, encoding='utf-8'))
    n_fix = 0
    for x in data:
        pdf = pdf_by_id.get(x.get('source_document_id'))
        d = pdf_descs.get(pdf, '')
        if not d:
            continue
        desc = str(x.get('description') or '')
        if 'XYYWW' in desc or 'SOP' in desc or 'package' in desc.lower() or len(desc) < 10 or desc.startswith(x['model']):
            x['description'] = d
            n_fix += 1
    print(f'修复description: {n_fix}', flush=True)
    json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
