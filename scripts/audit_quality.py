#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""封装与可靠性数据审计 v2（只读）

修正 v1 的两个误报源：
  1. 温度只认「Recommended Operating Conditions」表内的 Tamb（v1 全文搜，会抓到静态特性表的测试条件 -40~85）
  2. Tamb 行是 Min/Typ/Max 三列（-40 / 25 / 125），取 min 与 max，不取前两个数字
  3. 封装尺寸按「订购码逐型号」对齐（v1 拿第一处尺寸比第一个型号，必然错配）

输出: /tmp/quality_audit.json + 终端摘要
"""
import fitz, json, re
from pathlib import Path
from collections import defaultdict

WEB = Path(__file__).resolve().parent.parent
DS = WEB / "datasheets"
PROD = json.load(open(WEB / "data" / "products.json", encoding="utf-8"))

SEC_END = re.compile(r"\n\s*(?:Static|Dynamic|Electrical|AC |DC |Absolute Maximum|Package Outline|Application)", re.I)

def recommended_section(text):
    i = text.find("Recommended Operating Conditions")
    if i < 0:
        return ""
    seg = text[i:]
    m = SEC_END.search(seg[40:])
    return seg[: m.start() + 40] if m else seg[:3000]

def extract_temp_rec(text):
    """推荐工作条件表内的 Tamb → (min, max)

    表格文本按单元格逐行输出，典型形态：
        Tamb
        ambient temperature

        -40

        125
        -40

        125
        °C
    取「Tamb 之后连续的纯数字行」前 3 个（Min/Typ/Max）或前 2 个（Min/Max），
    不能用 chunk 内的 max()——后面的 ns/V 档位值（139/164/200）会污染。
    """
    seg = recommended_section(text)
    if not seg:
        return None, "无推荐工作条件表"
    for m in re.finditer(r"\bTamb\b", seg):
        rest = seg[m.end(): m.end() + 400]
        nums, started = [], False
        for line in rest.split("\n"):
            l = line.strip()
            if not l:
                continue
            if re.fullmatch(r"[−–-]?\d{1,3}", l):
                started = True
                v = int(l.replace("−", "-").replace("–", "-"))
                if -60 <= v <= 200:
                    nums.append(v)
            elif started:
                break
            if len(nums) >= 6:
                break
        # nums 可能是 Min/Typ/Max（-40,25,125）或双变体（-40,125,-40,125）或 Min/Max（-40,125）
        lo = nums[0] if nums and nums[0] <= 0 else None
        hi = next((n for n in nums[1:] if 40 <= n <= 200), None)
        if lo is None or hi is None:
            continue
        if -60 <= lo <= 0 and 40 <= hi <= 200:
            return (lo, hi), "推荐表"
    return None, "推荐表无 Tamb 行"

ORDER_CODE = re.compile(r"^(EM|EXS|EL|EMS|EMBMS)[0-9A-Z\-]+$")
PKG_LINE = re.compile(r"^(SOT\d{2,3}(?:-\d+L)?|SOT\d{3}|SOP-\d+L|SSOP-\d+L|TSSOP-\d+L|VSSOP-\d+L|MSOP-\d+L|QFN[\d.\sxX×-]*\d*L?|DFN[\d.\sxX×-]*\d*L?|WLCSP-?\d*B?|BGA[\d.\sxX×-]*\d*B?|WCSP-?\d*)$", re.I)
SIZE_LINE = re.compile(r"(\d+(?:\.\d+)?)\s*mm\s*[×xX]\s*(\d+(?:\.\d+)?)\s*mm[^;\n]*?;\s*(\d+(?:\.\d+)?)\s*mm\s*\(Max\)", re.I)

def parse_ordering(text):
    """返回 {订购码: {pkg, size, hmax}}；按 Ordering 段逐行解析"""
    i = text.find("Ordering Information")
    if i < 0:
        return {}
    seg = text[i: i + 6000]
    lines = [l.strip() for l in seg.split("\n")]
    out = {}
    cur = None
    buf = []
    def flush():
        if cur and buf:
            pkg = next((l for l in buf if PKG_LINE.match(l)), None)
            sm = None
            for l in buf:
                m = SIZE_LINE.search(l)
                if m:
                    sm = (m.group(1), m.group(2), m.group(3)); break
            if not sm:
                joined = " ".join(buf)
                m = SIZE_LINE.search(joined)
                if m:
                    sm = (m.group(1), m.group(2), m.group(3))
            if pkg:
                out[cur] = {"pkg": re.sub(r"\s+", "", pkg), "size": sm}
    for l in lines:
        if ORDER_CODE.match(l):
            flush(); cur = l; buf = []
        elif cur:
            buf.append(l)
    flush()
    return out

def norm_pkg(p):
    if not p:
        return ""
    x = p.upper().replace(" ", "").replace("×", "X")
    x = re.sub(r"^SOT23-(\d)L$", r"SOT23-\1L", x)
    return x

results = []
for pdf in sorted(DS.glob("*.pdf")):
    try:
        doc = fitz.open(str(pdf))
        t = "\n".join(doc[i].get_text() for i in range(doc.page_count))
        doc.close()
    except Exception as e:
        results.append({"file": pdf.name, "error": str(e)})
        continue
    temp, src = extract_temp_rec(t)
    results.append({"file": pdf.name, "temp_raw": list(temp) if temp else None,
                    "temp_src": src, "ordering": parse_ordering(t)})

by_src = defaultdict(list)
for p in PROD:
    by_src[p.get("source_label") or ""].append(p)

temp_bad, temp_na, pkg_bad, pkg_na = [], [], [], []
for r in results:
    plist = by_src.get(r["file"], [])
    if not plist:
        continue
    prod_temp = plist[0].get("temp_range") or ""
    m = re.search(r"(-?\d+)\s*°C\s*to\s*\+?(-?\d+)\s*°C", prod_temp)
    pv = (int(m.group(1)), int(m.group(2))) if m else None
    if r["temp_raw"] is None:
        temp_na.append((r["file"], prod_temp, len(plist), r["temp_src"]))
    elif pv != tuple(r["temp_raw"]):
        temp_bad.append((r["file"], prod_temp, "%d~%d °C" % tuple(r["temp_raw"]), len(plist)))
    # 封装逐型号
    for p in plist:
        model = p.get("model", "")
        o = r["ordering"].get(model)
        if not o:
            pkg_na.append((model, p.get("package"), p.get("package_size")))
            continue
        want = o["size"]
        have = p.get("package_size") or ""
        if want:
            w = "%s×%s" % (want[0], want[1])
            if w.replace("×", "x") not in have.replace("×", "x").replace(" ", ""):
                pkg_bad.append((model, p.get("package"), have[:44], w))

print("=" * 74)
print("规格书 %d 份 ｜ 温度：真错 %d 份 / 推荐表未列 %d 份 ｜ 封装尺寸：错/缺 %d 款 / 订购码未匹配 %d 款"
      % (len(results), len(temp_bad), len(temp_na), len(pkg_bad), len(pkg_na)))
print()
print("--- 温度真错（products vs 推荐表）---")
for f, a, b, n in temp_bad:
    print(f"  {f}\n      products {a}  |  规格书 {b}  |  {n} 款")
print("\n--- 推荐表未列 Tamb（需看 Absolute/Features）---")
for f, a, n, why in temp_na:
    print(f"  {f}  |  products {a}  |  {n} 款  ({why})")
print("\n--- 封装尺寸不一致（前 30）---")
for m, pkg, have, want in pkg_bad[:30]:
    print(f"  {m:22} [{pkg:16}] products: {have:44} | 订购表: {want}")
print(f"  … 共 {len(pkg_bad)} 款")
print("\n--- 订购码未在 Ordering 段匹配（前 15）---")
for m, pkg, size in pkg_na[:15]:
    print(f"  {m:22} [{pkg}] size={size}")

json.dump({"results": results, "temp_bad": temp_bad, "temp_na": temp_na,
           "pkg_bad": pkg_bad, "pkg_na": pkg_na},
          open("/tmp/quality_audit2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n明细: /tmp/quality_audit2.json")
