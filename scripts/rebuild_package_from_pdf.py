#!/usr/bin/env python3
"""从 PDF 订购表重建 products.json 的 package / package_size（唯一权威源）。
特点：
  - 订购表里每个型号自带「封装名 + 描述」，成对可信（无需继承推理）
  - 封装名统一：X/x/× 归一、去空格、前缀大写、尾号 L 统一
  - 尺寸：从描述里抽 "a × b mm; c mm (Max) height"
用法: python3 scripts/rebuild_package_from_pdf.py [--write]
输出: /tmp/pkg_rebuild.json（映射表）+ 终端摘要
"""
import fitz, json, glob, os, re, sys
from collections import Counter

BASE = os.path.expanduser('~/Desktop/规格书/规格书')
DIRS = [BASE + '/逻辑规格书', BASE + '/模拟开关规格书']
# 封装名：行首即封装前缀，且整行仅为封装名（Description 行含分号/leads/plastic，排除）
PKG_RE = re.compile(r'^((?:SOP|TSSOP|QFN|DFN|SOT|VSSOP|WLCSP|MSOP|WCSP|DIP|SSOP|TVSOP|SOD|X\d?SON)[-\d.xX×\.]*L?)\s*$', re.I)
TYPE_RE = re.compile(r'^(EM\w+|EXS\d+\w*)\s*$')
SIZE_RE = re.compile(r'(\d[\d.\- ]*mm\s*[×xX]\s*[\d.\- ]*mm)')          # 8.45-8.85 mm × 5.8-6.2 mm
BODYW_RE = re.compile(r'body\s+width\s+([\d.]+)\s*mm', re.I)             # body width 3.9 mm


# 别名：坐标顺序颠倒/等价写法 → 标准名
ALIAS = {
    'DFN1.45x1-6L': 'DFN1x1.45-6L',   # 统一成「小×大」顺序
    'DFN0.8x0.8': 'DFN0.8x0.8-4L',     # 缺脚数（查证：0.8×0.8 为 4/5 脚，主用 4 脚）
}


def norm_pkg(s):
    """封装名归一：×/x 统一、去空格、前缀大写、带 -数字 的补尾号 L。"""
    s = (s or '').strip().rstrip('-.').strip()
    s = re.sub(r'\s*[×xX·]\s*', 'x', s)
    s = re.sub(r'\s*-\s*', '-', s)
    s = re.sub(r'\s+', '', s)
    m = re.match(r'^([A-Za-z]+)', s)
    if m:
        s = m.group(1).upper() + s[len(m.group(1)):]
    if s in ALIAS:
        return ALIAS[s]
    if re.match(r'^[A-Z]+[\d.x]*-\d+$', s) and not s.endswith('L'):
        s += 'L'
    # TSSOP16L / SOP16L → TSSOP-16L（前缀与数字间补连字符，仅对纯字母前缀+数字）
    m2 = re.match(r'^([A-Z]+)(\d+)(L?)$', s)
    if m2 and m2.group(1) in ('SOP', 'TSSOP', 'SSOP', 'MSOP', 'VSSOP', 'TVSOP', 'QFN', 'DFN'):
        s = f'{m2.group(1)}-{m2.group(2)}L'
    return s


def norm_size(s):
    s = (s or '').strip()
    # 保护 (Max)/(min)/(typ) 里的 x 不被当乘号
    s = re.sub(r'\((max|min|typ)\)', lambda m: '\u00a7' + m.group(1) + '\u00a7', s, flags=re.I)
    # 只把「数字间的 x/X/×」当乘号
    s = re.sub(r'(?<=\d)\s*[×xX]\s*(?=\d)', ' × ', s)
    s = re.sub(r'\s*;\s*', '；', s)
    s = re.sub(r'(\d)\s*mm', r'\1 mm', s)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'\u00a7(max|min|typ)\u00a7', lambda m: '(' + m.group(1) + ')', s, flags=re.I)
    return s.strip()


def extract(pdf):
    """返回 {型号: (归一封装名, 归一尺寸)}。"""
    out = {}
    doc = fitz.open(pdf)
    for pno in range(len(doc)):
        t = doc[pno].get_text()
        if 'Ordering' not in t:
            continue
        lines = [l.strip() for l in t.split('\n')]
        for i, l in enumerate(lines):
            if not TYPE_RE.match(l):
                continue
            model = l.strip()
            pkg, size = '', ''
            for j in range(i + 1, min(i + 9, len(lines))):
                if TYPE_RE.match(lines[j]):
                    break
                if not pkg and not re.match(r'^\d', lines[j]) and 'package' not in lines[j].lower() and 'lead' not in lines[j].lower():
                    pm = PKG_RE.search(lines[j])
                    if pm:
                        pkg = pm.group(0)
                        continue
                if pkg and not size:
                    sm = SIZE_RE.search(lines[j])
                    if sm:
                        size = sm.group(0)
                        # 尺寸可能跨行（"2.92 mm × 1.6 mm;" + 下一行 "1.25 mm (Max) height"）
                        if j + 1 < len(lines) and 'height' in lines[j + 1].lower():
                            size += '; ' + lines[j + 1].strip()
                        break
                    bw = BODYW_RE.search(lines[j])
                    if bw:
                        size = f'body width {bw.group(1)} mm'
            if pkg and model not in out:
                out[model] = (norm_pkg(pkg), norm_size(size))
        doc.close()
        break
    return out


def main():
    files = []
    for d in DIRS:
        files += sorted(glob.glob(d + '/*.pdf'))
    files = [f for f in files if not f.endswith('.DS_Store')]

    mapping = {}
    for pdf in files:
        for model, (pkg, size) in extract(pdf).items():
            if model not in mapping:
                mapping[model] = {'package': pkg, 'package_size': size or None}

    print(f'PDF: {len(files)}  抽取型号: {len(mapping)}')
    c = Counter(v['package'] for v in mapping.values())
    print(f'封装名种类: {len(c)}')
    for k, n in c.most_common():
        print(f'  {n:4d}× {k}')
    json.dump(mapping, open('/tmp/pkg_rebuild.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('映射已存 /tmp/pkg_rebuild.json')

    if '--write' in sys.argv:
        path = os.path.expanduser('~/fae-knowledge-web/data/products.json')
        prod = json.load(open(path, encoding='utf-8'))
        hit = chg = 0
        for p in prod:
            d = mapping.get(p['model'])
            if d and d['package']:
                if p.get('package') != d['package']:
                    chg += 1
                p['package'] = d['package']
                # 尺寸：仅当现有为空时才用 PDF 值（现有尺寸源自更完整的资料）
                if not (p.get('package_size') or '').strip() and d['package_size']:
                    p['package_size'] = d['package_size']
                hit += 1
        json.dump(prod, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'已写回 {hit} 条（其中封装名变更 {chg} 条）')


if __name__ == '__main__':
    main()
