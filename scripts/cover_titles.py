#!/usr/bin/env python3
"""提取201 PDF封面标题，用于function纠错。只读PDF，写/tmp/cover_titles.json。"""
import fitz, glob, os, re, json

LOGIC = '/Users/hu/Desktop/规格书/规格书/逻辑规格书'
ANALOG = '/Users/hu/Desktop/规格书/规格书/模拟开关规格书'

def cover_title(pdf):
    try:
        doc = fitz.open(pdf)
    except Exception:
        return ''
    t = doc[0].get_text()
    doc.close()
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    models = lines[0] if lines else ''
    desc = ''
    for l in lines[1:4]:
        if re.search(r'Rev|datasheet|Draft|Energy', l, re.I):
            continue
        if re.match(r'^(EM|EXS|EL)', l):
            continue
        if len(l) >= 8:
            desc = l
            break
    return models + ' || ' + desc

def main():
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if 'DS_Store' not in p]
    out = {}
    for pdf in pdfs:
        out[os.path.basename(pdf)] = cover_title(pdf)
    json.dump(out, open('/tmp/cover_titles.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('PDF:', len(out), flush=True)
    items = list(out.items())[:5]
    for k, v in items:
        print('  ' + k + ': ' + v[:90], flush=True)

if __name__ == '__main__':
    main()
