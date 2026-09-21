#!/usr/bin/env python3
"""全文档封装审计：201 PDF订购表 vs products.json package比对。
输出 /tmp/pkg_audit.json + 终端摘要。只读PDF和products.json，不写回。
用法: python3 scripts/pkg_audit.py
"""
import fitz, json, glob, os, re, sys

LOGIC = '/Users/hu/Desktop/规格书/规格书/逻辑规格书'
ANALOG = '/Users/hu/Desktop/规格书/规格书/模拟开关规格书'

def extract_ordering(pdf):
    """返回 [(型号, 封装名, 描述)]，找不到返回[]"""
    try:
        doc = fitz.open(pdf)
    except Exception as e:
        return ('ERR:' + str(e)[:50], [])
    out = []
    for pno in range(len(doc)):
        t = doc[pno].get_text()
        if 'Ordering' not in t:
            continue
        # 按行切，找含EM/EXS的型号行 + 其后封装 token
        lines = [l.strip() for l in t.split('\n')]
        for i, l in enumerate(lines):
            m = re.match(r'^(EM\w+|EXS\d+\w*)\s*$', l)
            if not m:
                continue
            model = m.group(1)
            # 后续5行内找封装名
            pkg, desc = '', ''
            for j in range(i + 1, min(i + 8, len(lines))):
                pm = re.search(r'(SOP|TSSOP|QFN|DFN|SOT|VSSOP|WLCSP|MSOP|WCSP|DIP|SSOP|TVSOP|SC-?\d*|SOD-?\d*|X\d?SON)[-\d.xXL×. ]*', lines[j], re.I)
                if pm:
                    pkg = pm.group(0).strip()
                    desc = ' | '.join(lines[j:j + 3])[:150]
                    break
            out.append((model, pkg, desc))
        doc.close()
        if out:
            return ('OK', out)
        doc = fitz.open(pdf)
    doc.close()
    return ('NO_ORDERING', [])

def main():
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if os.path.basename(p) != '.DS_Store']
    print(f'PDF总数: {len(pdfs)}', flush=True)
    d = json.load(open(os.path.expanduser('~/fae-knowledge-web/data/products.json'), encoding='utf-8'))
    web = {}
    for x in d:
        web.setdefault(x['model'], []).append((x.get('package'), x.get('package_size')))
    report = {'mismatch': [], 'web_missing_pdf': [], 'pdf_missing_web': [], 'no_ordering': [], 'errors': []}
    for pdf in pdfs:
        status, rows = extract_ordering(pdf)
        base = os.path.basename(pdf)
        if status != 'OK':
            (report['errors'] if status.startswith('ERR') else report['no_ordering']).append(base)
            continue
        for model, pkg, desc in rows:
            if model not in web:
                report['pdf_missing_web'].append({'model': model, 'pdf_pkg': pkg, 'pdf': base})
            else:
                for wpkg, wsize in web[model]:
                    # 宽松比：封装字母相同即过，L后缀/大小写忽略
                    norm = lambda s: re.sub(r'[^A-Z0-9]', '', (s or '').upper())
                    if norm(wpkg) != norm(pkg) and pkg:
                        report['mismatch'].append({
                            'model': model, 'web_pkg': wpkg, 'pdf_pkg': pkg,
                            'pdf': base, 'desc': desc})
    # 网页有但PDF订购表没出现的型号
    pdf_models = set()
    for pdf in pdfs:
        st, rows = extract_ordering(pdf)
        if st == 'OK':
            for m, _, _ in rows:
                pdf_models.add(m)
    for m in sorted(set(web) - pdf_models):
        report['web_missing_pdf'].append(m)
    json.dump(report, open('/tmp/pkg_audit.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"mismatch(封装不一致): {len(report['mismatch'])}", flush=True)
    print(f"pdf有网页无: {len(report['pdf_missing_web'])}", flush=True)
    print(f"网页有pdf订购表无: {len(report['web_missing_pdf'])}", flush=True)
    print(f"无Ordering页: {len(report['no_ordering'])}", flush=True)
    print(f"打不开: {len(report['errors'])}", flush=True)
    for r in report['mismatch'][:30]:
        print(f"  {r['model']}: 网页={r['web_pkg']} vs PDF={r['pdf_pkg']} ({r['pdf']})", flush=True)

if __name__ == '__main__':
    main()
