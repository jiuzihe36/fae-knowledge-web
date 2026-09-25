#!/usr/bin/env python3
"""全库specs重提：find_tables宽表 -> 易读 Min/Typ/Max specs（静态/动态/绝对最大/推荐）"""
import fitz, os, re, json, glob, sys
from pathlib import Path

DIR = Path(__file__).resolve().parent.parent
PDFDIR = Path('/Users/hu/Desktop/规格书/规格书')

def clean(s):
    if not s: return ''
    s = s.replace('\n',' ')
    s = re.sub(r'\s+',' ',s).strip()
    s = re.sub(r'V\s*CC\s*\(A\)','VCC(A)',s)
    s = re.sub(r'V\s*CC\s*\(B\)','VCC(B)',s)
    s = re.sub(r'V\s*CC\b','VCC',s)
    s = re.sub(r'V\s*-\s*([\d.]+)\s*CC\(A\)',r'VCC(A)-\1',s)
    s = re.sub(r'V\s*-\s*([\d.]+)\s*CC\(B\)',r'VCC(B)-\1',s)
    s = re.sub(r'V\s*=\s*([\d.]+)\s*V\s*to\s*([\d.]+)\s*V\s*;?\s*CC\(A\)',r'VCC(A)=\1V to \2V;',s)
    s = re.sub(r'V\s*=\s*([\d.]+)\s*V\s*to\s*([\d.]+)\s*V\s*;?\s*CC\(B\)',r'VCC(B)=\1V to \2V;',s)
    return s

_UNIT_CHARS = re.compile(r'^[A-Za-zΩΩ℃°%µμ/·]+$')


def _pick_unit(rows, unit_col, label_cols):
    """取单位：从 unit_col 及左侧 2 列找「纯单位符号」单元格。

    PDF 表格常多一个尾部空列，真实单位在 unit_col-1 / unit_col-2。
    注意 Ω 有两种码位：U+03A9 GREEK OMEGA 与 U+2126 OHM SIGN，
    datasheet 普遍用后者 —— 字符类必须同时收，否则单位会被判非单位而丢掉。
    只接受纯单位符号、不含数字，避免把 max 的数值当单位
    （曾产生 "max=4.0 Ω Ω" 的单位重复）。
    """
    cands = [c for c in (unit_col, unit_col - 1, unit_col - 2) if 0 <= c < len(rows[0])]
    for r in rows:
        for c in cands:
            if c < len(r):
                v = clean(r[c]).replace('\u2126', '\u03a9')   # OHM SIGN → GREEK OMEGA
                if v and _UNIT_CHARS.match(v) and not re.search(r'\d', v):
                    return v
    return ''


def _find_header(rows):
    """探测表头行下标。

    不能固定用 rows[1]：有的 PDF 第 1 行就是表头（EMS 系列
    ['','Symbol','','','Parameter','','','Min','','Max','Unit','']），
    rows[1] 已经是数据行 → label_cols 找不到 min/max → 整表返回 0 条。
    在前 3 行里找命中最多 min/typ/max 的那行作为表头。
    """
    best_i, best_n = None, 0
    for i, r in enumerate(rows[:3]):
        n = 0
        for c in r:
            cs = (str(c) if c else '').strip().lower()
            if cs in ('min', 'typ', 'max'):
                n += 1
        if n > best_n:
            best_i, best_n = i, n
    return best_i if best_n >= 1 else None


def extract_wide(doc, pno, ti, kind, src_label):
    tabs = list(doc[pno].find_tables())
    if ti >= len(tabs): return []
    rows = tabs[ti].extract()
    if len(rows) < 2: return []
    hi = _find_header(rows)
    if hi is None: return []
    header = rows[hi]
    label_cols = {}
    for i, c in enumerate(header):
        c = (str(c) if c else '').strip().lower()
        if c in ('min', 'typ', 'max') and c not in label_cols:
            label_cols[c] = i
    if not label_cols: return []
    unit_col = len(rows[0]) - 1
    # 数据行：表头之后，且跳过紧邻的重复表头行
    data_rows = [r for r in rows[hi + 1:] if _find_header([r]) is None]
    specs = []
    cur_sym = cur_param = ''
    for r in data_rows:
        sym = clean(r[0]) if len(r) > 0 else ''
        param = clean(r[1]) if len(r) > 1 else ''
        # 有的表把 symbol/param 放在非 0/1 列（前面有空列）
        if not sym:
            for ci in range(len(r)):
                v = clean(r[ci])
                if v and ci != label_cols.get('min') and not re.match(r'^[\d±\-.]', v):
                    sym = v
                    break
        if not param and len(r) > 1:
            for ci in range(1, len(r)):
                v = clean(r[ci])
                if v and re.search(r'[a-z]{3}', v) and ci not in label_cols.values():
                    param = v
                    break
        if sym: cur_sym = sym
        if param: cur_param = param
        vals = {}
        for k, ci in label_cols.items():
            for cand in (ci, ci - 1, ci + 1):
                if 0 <= cand < len(r):
                    # 不能回退到 unit 列（会把单位当数值 → "max=4.0" + "unit=Ω" 变 "Ω Ω"）
                    if cand == unit_col:
                        continue
                    v = clean(r[cand])
                    if v and v not in ('—', '-', '–') and re.search(r'[\d±]', v):
                        vals[k] = v
                        break
        if not vals: continue
        unit = _pick_unit([r], unit_col, label_cols)
        parts = [f"{k}={vals[k]}" for k in ('min', 'typ', 'max') if k in vals]
        value = '; '.join(parts) + (f' {unit}' if unit else '')
        title = f"{cur_sym} {cur_param}".strip()
        cond = ''
        for ci in range(2, len(r)):
            if ci in label_cols.values() or ci == unit_col: continue
            v = clean(r[ci])
            if v and re.search(r'[=<>VmA]', v) and len(v) > 4:
                cond = v; break
        if cond: title += f" | {cond}"
        specs.append({'param': title, 'value': value, 'source_label': src_label, 'kind': kind})
    return specs


# 章节标题模式（kind 归属用）——必须锚定到章节标题，不能用页内关键词
_SEC_PATTERNS = [
    ('绝对最大', re.compile(r'\d+\.?\s*Absolute Maximum Ratings?', re.I)),
    ('推荐工作条件', re.compile(r'\d+\.?\s*Recommend(?:ed)?\s+Operating\s+(?:Conditions|Ratings)', re.I)),
    ('推荐工作条件', re.compile(r'\d+\.?\s*Recommend\s+operating\s+ratings', re.I)),
    ('静态', re.compile(r'\d+\.?\s*Static\s+[Cc]haracteristics', re.I)),
    ('动态', re.compile(r'\d+\.?\s*Dynamic\s+[Cc]haracteristics', re.I)),
]


def _page_sections(page):
    """返回该页所有章节标题 [(y, kind)]，按 y 升序。

    按行聚合 words 后匹配，避免「页内任意位置出现关键词」误判——
    推荐工作条件页的正文里常出现 "design to Absolute Maximum Ratings" 这句，
    按关键词判页会把推荐工作表误标成绝对最大（803 条错误即此因）。
    """
    lines = {}
    for w in page.get_text('words'):
        lines.setdefault((w[5], w[6]), []).append(w)
    out = []
    for _, ws in lines.items():
        ws.sort(key=lambda x: x[0])
        text = ' '.join(w[4] for w in ws)
        y = min(w[1] for w in ws)
        for name, r in _SEC_PATTERNS:
            if r.search(text):
                out.append((y, name))
                break
    return sorted(out)


def extract_pdf(pdf_path, src_label):
    """按「表所属章节」判 kind：每张表归属到它上方最近的章节标题。

    不能按页判 kind：同一页常有多张表分属不同章节
    （EMS3580 p4 = 表4 绝对最大 + 表5 推荐工作条件，两表都有 VCC supply voltage；
     按页判会把两张表标成同一个 kind）。
    """
    doc = fitz.open(pdf_path)
    out = []
    for pno in range(len(doc)):
        page = doc[pno]
        secs = _page_sections(page)          # [(y, kind)]
        if not secs:
            continue
        tabs = list(page.find_tables())
        for ti, tb in enumerate(tabs):
            ty = tb.bbox[1]                  # 表顶 y
            owner = None
            for y, name in secs:
                if y <= ty:
                    owner = name
            if owner is None:
                continue                     # 表在第一个章节标题之上 → 归属不明，跳过
            out.extend(extract_wide(doc, pno, ti, owner, src_label))
    doc.close()
    return out


def main():
    only = sys.argv[1] if len(sys.argv)>1 else None
    pdfs = sorted(glob.glob(str(PDFDIR/'逻辑规格书'/'*.pdf'))+glob.glob(str(PDFDIR/'模拟开关规格书'/'*.pdf')))
    if only: pdfs=[p for p in pdfs if only in os.path.basename(p)]
    allspecs={}
    for p in pdfs:
        bn=os.path.basename(p)
        try:
            sp=extract_pdf(p,bn)
            allspecs[bn]=sp
            print(f"  {bn}: {len(sp)}条")
        except Exception as e:
            print(f"  {bn}: 失败 {e}")
    out=DIR/'data'/'specs_reextracted.json'
    json.dump(allspecs,open(out,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
    tot=sum(len(v) for v in allspecs.values())
    print(f"✅ 共{len(allspecs)}个PDF, {tot}条specs -> {out}")

if __name__=='__main__': main()
