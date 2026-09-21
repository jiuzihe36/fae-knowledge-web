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

def extract_wide(doc, pno, ti, kind, src_label):
    tabs = list(doc[pno].find_tables())
    if ti >= len(tabs): return []
    rows = tabs[ti].extract()
    if len(rows) < 3: return []
    header = rows[1]
    label_cols = {}
    for i,c in enumerate(header):
        c = (c or '').strip().lower()
        if c in ('min','typ','max') and c not in label_cols:
            label_cols[c] = i
    if not label_cols: return []
    unit_col = len(rows[0])-1
    specs=[]; cur_sym=cur_param=''
    for r in rows[2:]:
        sym=clean(r[0]); param=clean(r[1]); cond=clean(r[2]) if len(r)>2 else ''
        if sym: cur_sym=sym
        if param: cur_param=param
        vals={}
        for k,ci in label_cols.items():
            for cand in (ci, ci-1):
                if 0<=cand<len(r):
                    v=clean(r[cand])
                    if v and v not in ('—','-','–'):
                        vals[k]=v; break
        if not vals: continue
        unit=clean(r[unit_col]) if unit_col<len(r) else ''
        parts=[f"{k}={vals[k]}" for k in ('min','typ','max') if k in vals]
        value='; '.join(parts)+(f' {unit}' if unit else '')
        title=f"{cur_sym} {cur_param}".strip()
        if cond: title+=f" | {cond}"
        specs.append({'param':title,'value':value,'source_label':src_label,'kind':kind})
    return specs

def extract_pdf(pdf_path, src_label):
    doc = fitz.open(pdf_path)
    out=[]
    for pno in range(len(doc)):
        t=doc[pno].get_text()
        kind=None
        if 'Static characteristics' in t: kind='静态'
        elif 'Dynamic characteristics' in t: kind='动态'
        elif 'Absolute Maximum' in t: kind='绝对最大'
        elif 'Recommended' in t: kind='推荐'
        if not kind: continue
        for ti in range(len(list(doc[pno].find_tables()))):
            out.extend(extract_wide(doc,pno,ti,kind,src_label))
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
