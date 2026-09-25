#!/usr/bin/env python3
"""封装全量核对 v3 —— 用 find_tables 取订购表结构化单元格，覆盖 v2 漏掉的订购码。

v2 (pkg_audit2.py) 的两个盲区：
  ① TYPE_RE 只认「整行就是型号」的行 → PDF 里 `EM74LVC1G00GW V1YW`（型号+丝印同格）
     被跳过，整批 LVC1G 系列的带后缀订购码没被提取（web_only 92 款的来源）
  ② 用 get_text() 逐行猜封装 → 遇到「继承」排版（同组后续型号封装只在首个出现）易错

本脚本改用 page.find_tables() 取结构化单元格：
  订购表列通常为 [Type number, Topside marking, Package.Name, Package.Description, Quantity]
  取第 0 列（订购码）+ 找含封装关键词的列（名称列）。
只读，输出 /tmp/pkg_audit3.json
"""
import fitz, json, glob, os, re

LOGIC = os.path.expanduser('~/Desktop/规格书/规格书/逻辑规格书')
ANALOG = os.path.expanduser('~/Desktop/规格书/规格书/模拟开关规格书')

# 订购码：EM/EXS/EL 开头，可含 -Q100 车规后缀
TYPE_RE = re.compile(r'^(EM[0-9A-Za-z]+|EXS[0-9A-Za-z]+|EL[0-9A-Za-z]+)(-Q100)?$')
# 封装名候选：以封装家族词开头
PKG_RE = re.compile(r'^(SOP|TSSOP|QFN|DFN|SOT|VSSOP|WLCSP|MSOP|WCSP|DIP|SSOP|TVSOP|SC-?\d*|SOD-?\d*)[-\d.xX×\. ]*', re.I)


def norm(s):
    """归一化封装名：忽略大小写/乘号/分隔符/尾部 L。"""
    t = re.sub(r'[X×]', '', (s or '').upper())
    t = re.sub(r'[^A-Z0-9]', '', t)
    if t.endswith('L') and len(t) > 2 and t[-2].isdigit():
        t = t[:-1]
    return t


def extract_ordering(pdf):
    """返回 [(订购码, 封装名, 来源PDF)]，用 find_tables 结构化解析。"""
    out = []
    src = os.path.basename(pdf)
    try:
        doc = fitz.open(pdf)
    except Exception:
        return out
    for pno in range(min(len(doc), 6)):
        page = doc[pno]
        txt = page.get_text()
        if 'Ordering' not in txt and '订购' not in txt:
            continue
        try:
            tabs = page.find_tables()
        except Exception:
            continue
        for tb in tabs:
            try:
                rows = tb.extract()
            except Exception:
                continue
            # 同一表格内：封装名格为空的订购码行「继承」上一个有封装名的行
            # （PDF 订购表把同一封装组的多个型号排在一起，封装名只在组首出现）
            inherited = ''
            for r in rows:
                if not r:
                    continue
                cells = ['' if c is None else str(c).replace('\n', ' ').strip() for c in r]
                if not any(cells):
                    continue
                # 找订购码格
                model = None
                for c in cells:
                    if TYPE_RE.match(c):
                        model = c
                        break
                if not model:
                    continue
                m2 = re.match(r'^((?:EM|EXS|EL)[0-9A-Za-z]+(?:-Q100)?)', model)
                if m2:
                    model = m2.group(1)
                # 找封装名格（多为 Package.Name 列）
                pkg = ''
                for c in cells:
                    if PKG_RE.match(c) and c != model:
                        pkg = c
                        break
                if pkg:
                    inherited = pkg
                    out.append((model, pkg, src))
                elif inherited:
                    out.append((model, inherited, src))
    doc.close()
    return out


def main():
    pdfs = sorted(glob.glob(LOGIC + '/*.pdf') + glob.glob(ANALOG + '/*.pdf'))
    pdfs = [p for p in pdfs if not p.endswith('.DS_Store')]
    print(f'PDF 总数: {len(pdfs)}', flush=True)

    prod = json.load(open(os.path.expanduser('~/fae-knowledge-web/data/products.json'), encoding='utf-8'))
    web = {}
    for x in prod:
        web.setdefault(x['model'], []).append((x.get('package'), x.get('package_size')))

    pdf_pkg = {}
    for pdf in pdfs:
        for m, pk, src in extract_ordering(pdf):
            # 保留首次（同名型号可能出现在多份文档，取第一份）
            pdf_pkg.setdefault(m, (pk, src))

    print(f'PDF 提取到订购码: {len(pdf_pkg)}', flush=True)

    both = sorted(set(pdf_pkg) & set(web))
    mismatch = []
    for m in both:
        pk, src = pdf_pkg[m]
        webpkgs = [norm(w[0]) for w in web[m]]
        if norm(pk) not in webpkgs:
            mismatch.append({'model': m, 'web': [w[0] for w in web[m]], 'pdf': pk, 'src': src})

    report = {
        'pdf_total': len(pdfs),
        'pdf_models': len(pdf_pkg),
        'checked': len(both),
        'mismatch': mismatch,
        'pdf_only': sorted(set(pdf_pkg) - set(web)),
        'web_only': sorted(set(web) - set(pdf_pkg)),
    }
    json.dump(report, open('/tmp/pkg_audit3.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'可比对: {len(both)}  |  封装不一致: {len(mismatch)}', flush=True)
    for r in mismatch[:40]:
        print(f"  {r['model']}: 网页={r['web']} vs PDF={r['pdf']} ({r['src']})", flush=True)
    print(f"\npdf_only(PDF有站点无): {len(report['pdf_only'])}", flush=True)
    print(f"web_only(站点有PDF无): {len(report['web_only'])}", flush=True)


if __name__ == '__main__':
    main()
