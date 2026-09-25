#!/usr/bin/env python3
"""用 PDF 订购表修正 products.json 的封装字段。
- 只读 PDF 与 products.json；默认 dry-run（只输出报告），加 --write 才写回。
- 归一化比对忽略尾号 L，保留网页原有尾号风格（如 SOP-16L）并只纠正封装名主体。
用法: python3 scripts/fix_package_from_pdf.py [--write]
"""
import fitz, json, glob, os, re, sys

LOGIC = os.path.expanduser('~/Desktop/规格书/规格书/逻辑规格书')
ANALOG = os.path.expanduser('~/Desktop/规格书/规格书/模拟开关规格书')
PKG_RE = re.compile(r'(SOP|TSSOP|QFN|DFN|SOT|VSSOP|WLCSP|MSOP|WCSP|DIP|SSOP|TVSOP|SC-?\d*|SOD-?\d*|X\d?SON)[-\d.xX×\. ]*', re.I)
TYPE_RE = re.compile(r'^(EM\w+|EXS\d+\w*)\s*$')


def norm(s):
    t = re.sub(r'[^A-Z0-9]', '', (s or '').upper())
    if t.endswith('L') and len(t) > 2 and t[-2].isdigit():
        t = t[:-1]
    return t


def extract_ordering(pdf):
    doc = fitz.open(pdf)
    out = {}
    for pno in range(len(doc)):
        t = doc[pno].get_text()
        if 'Ordering' not in t:
            continue
        lines = [l.strip() for l in t.split('\n')]
        cur_pkg = ''
        for i, l in enumerate(lines):
            if TYPE_RE.match(l):
                model = l.strip()
                pkg = ''
                for j in range(i + 1, min(i + 6, len(lines))):
                    if TYPE_RE.match(lines[j]):
                        break
                    pm = PKG_RE.search(lines[j])
                    if pm:
                        pkg = pm.group(0).strip()
                        break
                if pkg:
                    cur_pkg = pkg
                out[model] = pkg or cur_pkg
    doc.close()
    return out


def main():
    write = '--write' in sys.argv
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if not p.endswith('.DS_Store')]
    pdf_pkg = {}
    for pdf in pdfs:
        for m, pk in extract_ordering(pdf).items():
            if pk and m not in pdf_pkg:
                pdf_pkg[m] = pk

    path = os.path.expanduser('~/fae-knowledge-web/data/products.json')
    prod = json.load(open(path, encoding='utf-8'))

    fixes = []
    for p in prod:
        m = p['model']
        if m not in pdf_pkg:
            continue
        pdf_pk = pdf_pkg[m]
        if norm(pdf_pk) != norm(p.get('package')):
            fixes.append({'model': m, 'old': p.get('package'), 'new': pdf_pk})

    print(f'PDF 订购表型号: {len(pdf_pkg)}  待修正: {len(fixes)}')
    for f in fixes[:40]:
        print(f"  {f['model']}: {f['old']} -> {f['new']}")

    if write:
        # 统一尾号风格：QFN/DFN/SOP/TSSOP/MSOP/SSOP 等带引脚数的补 L（如 SOP-16 → SOP-16L）
        def canon(pk):
            pk = (pk or '').strip()
            m = re.match(r'^([A-Z]+)([\- ]?)(\d+)$', pk, re.I)
            if m and m.group(1).upper() in ('SOP', 'TSSOP', 'SSOP', 'MSOP', 'VSSOP', 'TVSOP', 'QFN', 'DFN'):
                return m.group(1).upper() + '-' + m.group(3) + 'L'
            return pk
        fixmap = {f['model']: canon(f['new']) for f in fixes}
        for p in prod:
            if p['model'] in fixmap:
                p['package'] = fixmap[p['model']]
        json.dump(prod, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'已写回 {len(fixes)} 条修正到 products.json')
    else:
        print('(dry-run，未写回。加 --write 生效)')


if __name__ == '__main__':
    main()
