#!/usr/bin/env python3
"""封装核对 v2：正确处理 PDF 订购表的「封装继承」（同组后续型号继承首个封装）。
用法: python3 scripts/pkg_audit2.py
输出: /tmp/pkg_audit2.json + 终端摘要，只读不写回。
"""
import fitz, json, glob, os, re

LOGIC = os.path.expanduser('~/Desktop/规格书/规格书/逻辑规格书')
ANALOG = os.path.expanduser('~/Desktop/规格书/规格书/模拟开关规格书')
PKG_RE = re.compile(r'(SOP|TSSOP|QFN|DFN|SOT|VSSOP|WLCSP|MSOP|WCSP|DIP|SSOP|TVSOP|SC-?\d*|SOD-?\d*|X\d?SON)[-\d.xX×\. ]*', re.I)
TYPE_RE = re.compile(r'^(EM\w+|EXS\d+\w*)\s*$')


def extract_ordering(pdf):
    """返回 {型号: 封装名}，正确处理继承（同组后续型号沿用首个封装名）。"""
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
                # 找当前型号后紧邻的封装名（若本身行带有）
                pkg = ''
                for j in range(i + 1, min(i + 6, len(lines))):
                    if TYPE_RE.match(lines[j]):
                        break  # 遇到下一个型号，停止
                    pm = PKG_RE.search(lines[j])
                    if pm:
                        pkg = pm.group(0).strip()
                        break
                if pkg:
                    cur_pkg = pkg
                out[model] = pkg or cur_pkg  # 无封装名则继承上一组
    doc.close()
    return out


def norm(s):
    # 归一化：忽略大小写/非字母数字（自动统一 × / x / 空格）/尾部 Leads 标记 L
    t = re.sub(r'[X×]', '', (s or '').upper())      # 乘号 x/× 一律忽略（QFN4x4 == QFN 4 × 4）
    t = re.sub(r'[^A-Z0-9]', '', t)
    if t.endswith('L') and len(t) > 2 and t[-2].isdigit():
        t = t[:-1]          # SOP-16L == SOP-16
    return t


def main():
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if not p.endswith('.DS_Store')]
    print(f'PDF 总数: {len(pdfs)}', flush=True)

    web = {}
    prod = json.load(open(os.path.expanduser('~/fae-knowledge-web/data/products.json'), encoding='utf-8'))
    for x in prod:
        web.setdefault(x['model'], []).append((x.get('package'), x.get('package_size')))

    pdf_pkg = {}
    for pdf in pdfs:
        for m, pk in extract_ordering(pdf).items():
            if pk and m not in pdf_pkg:
                pdf_pkg[m] = (pk, os.path.basename(pdf))

    mismatch, checked = [], 0
    for m, (pk, src) in pdf_pkg.items():
        if m not in web:
            continue
        checked += 1
        webpkgs = [norm(w[0]) for w in web[m]]
        if norm(pk) not in webpkgs:
            mismatch.append({'model': m, 'web': [w[0] for w in web[m]], 'pdf': pk, 'src': src})

    report = {'checked': checked, 'mismatch': mismatch,
              'pdf_only': sorted(set(pdf_pkg) - set(web)),
              'web_only': sorted(set(web) - set(pdf_pkg))}
    json.dump(report, open('/tmp/pkg_audit2.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'可比对型号: {checked}', flush=True)
    print(f'封装不一致: {len(mismatch)}', flush=True)
    for r in mismatch[:25]:
        print(f"  {r['model']}: 网页={r['web']} vs PDF={r['pdf']} ({r['src']})", flush=True)


if __name__ == '__main__':
    main()
