#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把实体页「电气特性全集」的表格同步到 products.json 的 specs 字段

为什么：products 的 specs 是早期 PDF 自动提取（平均 29.8 条，EXS 只有 10 条），
而实体页四块表是人工核对过的完整参数（合计 7746 行）。101 个实体页比 products 多 5 行以上，
覆盖 368 款——客户在详情抽屉里看不到这些参数。

口径：实体页是单一事实源（SYSTEM.md 数据流）。本脚本按 实体页 → 同 source_label 的所有型号 写入 specs。
用法:
  python3 scripts/sync_specs_from_entities.py --dry-run   # 只看统计与样例
  python3 scripts/sync_specs_from_entities.py --write
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
WIKI = Path.home() / "项目" / "资料" / "wiki"
PROD = SITE / "data" / "products.json"

def kind_of(header):
    """把实体页 ### 小标题（常带页码/表号）归一到 6 个稳定分组，
    否则前端会把 "传输特性 VT+/VT-/VH (p10 Table 10)" 这类标题当成独立分组，碎成一堆。"""
    h = header or ""
    if "绝对最大" in h:
        return "绝对最大额定值"
    if "推荐工作" in h:
        return "推荐工作条件"
    if any(k in h for k in ("传输特性", "施密特", "转移特性", "阈值")):
        return "传输特性 / 阈值"
    if any(k in h for k in ("过压", "ESD", "保护")):
        return "保护与 ESD"
    if any(k in h for k in ("动态", "交流", "开关特性", "AC", "时序")):
        return "动态"
    if any(k in h for k in ("静态", "直流", "DC", "电源电流", "漏电", "电容")):
        return "静态"
    return "其他"

def esc_html(s):
    s = (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    return s

def sub_html(s):
    """把 VCC(A)/VCC(B)/VIH 这类下标化，供详情抽屉渲染"""
    h = esc_html(s)
    h = re.sub(r"\bVCC\(([AB])\)", r"V<sub>CC</sub>(\1)", h)
    h = re.sub(r"\bV(CC|IH|IL|OH|OL|I|O|T\+|T-)\b", r"V<sub>\1</sub>", h)
    return h

UNIT_RE = re.compile(r"^(V|mV|kV|mA|µA|uA|nA|µs|us|ns|ps|ms|s|pF|nF|µF|uF|Ω|ohm|kΩ|MΩ|Hz|kHz|MHz|GHz|°C|℃|%|dB|W|mW|V/ns|ns/V|mA/V|A)$")

def fmt_value(rest):
    """把表格余下列转成可读数值：2 数值 → min/max；3 数值 → min/typ/max；含条件则原样连接"""
    BLANK = ("", "—", "–", "-", "－", "/", "N/A", "n/a")
    items = [x.strip() for x in rest if x.strip() not in BLANK]
    if not items:
        return ""
    unit = ""
    if UNIT_RE.match(items[-1]):
        unit = items[-1]
        items = items[:-1]
    num = re.compile(r"^[-+±]?[\d.]+$")
    cond = ""
    # 「条件 + min + max」形态（如 "Active mode · 0 · VCC"）：首个非数值项视为条件
    if len(items) >= 3 and not num.match(items[0]) and not UNIT_RE.match(items[0]):
        cond = items.pop(0) + " · "
    if items and all(num.match(x) for x in items):
        if len(items) == 2:
            return cond + f"min={items[0]}; max={items[1]}" + (f" {unit}" if unit else "")
        if len(items) == 3:
            return cond + f"min={items[0]}; typ={items[1]}; max={items[2]}" + (f" {unit}" if unit else "")
    return cond + " · ".join(items) + (f" {unit}" if unit and not any(unit in x for x in items) else "")

def split_row(line):
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells

def parse_entity(path):
    t = path.read_text(encoding="utf-8")
    m = re.search(r"## 电气特性全集(.*?)(?=\n## (?!.*特性)|$)", t, re.S)
    if not m:
        return []
    sec = m.group(1)
    specs = []
    cur_kind = "电气特性"
    cur_header = None
    for raw in sec.split("\n"):
        line = raw.strip()
        if line.startswith("###"):
            cur_kind = kind_of(line.lstrip("#").strip())
            cur_header = None
            continue
        if not line.startswith("|"):
            # 小节内的表题（如「Table 6. Static characteristics」）
            if line.lower().startswith("table"):
                cur_kind = cur_kind or "电气特性"
            continue
        if re.fullmatch(r"\|[\s\-:|]+\|", line):
            continue
        cells = split_row(line)
        if not cells or not any(cells):
            continue
        head = " ".join(cells).lower()
        if ("符号" in cells[0] or "参数" in cells[0]) and ("条件" in head or "限制" in head or "单位" in head or len(cells) <= 3):
            cur_header = cells
            continue
        if len(cells) < 2:
            continue
        sym = cells[0]
        if sym in ("符号", "参数", "—", "-", ""):
            continue
        # param = 符号 + 参数名（第二列不是纯数值时视为参数名/条件）
        col2 = cells[1]
        numeric = bool(re.fullmatch(r"[-—–\d.\s~+/]*", col2))
        if numeric:
            param = sym
            rest = cells[1:]
        else:
            param = f"{sym} {col2}".strip()
            rest = cells[2:]
        value = fmt_value(rest)
        if not value:
            continue
        specs.append({
            "param": param[:180],
            "value": value[:220],
            "kind": cur_kind,
            "param_html": sub_html(param[:180]),
            "value_html": "<strong>" + sub_html(value[:220]) + "</strong>",
        })
    return specs

def main():
    write = "--write" in sys.argv
    prod = json.load(open(PROD, encoding="utf-8"))
    by_src = defaultdict(list)
    for p in prod:
        by_src[p.get("source_label") or ""].append(p)

    total_old = sum(len(p.get("specs") or []) for p in prod)
    updated_models, no_entity = 0, []
    samples = []
    for ef in sorted((WIKI / "entities").glob("*.md")):
        t = ef.read_text(encoding="utf-8")
        m = re.search(r"sources:\s*\[?raw/datasheets/([^\],\s]+)", t)
        if not m:
            continue
        src = m.group(1).replace(".json", ".pdf")
        plist = by_src.get(src)
        if not plist:
            continue
        specs = parse_entity(ef)
        if not specs:
            continue
        if len(samples) < 3:
            samples.append((ef.stem, len(plist[0].get("specs") or []), len(specs), specs[:3]))
        for p in plist:
            p["specs"] = specs
            updated_models += 1

    total_new = sum(len(p.get("specs") or []) for p in prod)
    print(f"{'[dry-run] ' if not write else ''}更新 {updated_models} 款型号的 specs：{total_old} → {total_new} 条（{total_new-total_old:+d}）")
    for s, old, new, sp in samples:
        print(f"\n样例 {s}: {old} → {new} 条")
        for x in sp:
            print(f"   [{x['kind']}] {x['param'][:60]} = {x['value'][:70]}")
    empty = [p["model"] for p in prod if not (p.get("specs") or [])]
    print(f"\n仍无 specs 的型号: {len(empty)} {empty[:8]}")
    if write:
        txt = PROD.read_text(encoding="utf-8")
        indent = 1 if txt.startswith("[\n ") else None
        json.dump(prod, open(PROD, "w", encoding="utf-8"), ensure_ascii=False,
                  indent=indent, separators=None if indent else (",", ":"))
        print("已写回 products.json")
    else:
        print("（dry-run，加 --write 落盘）")

if __name__ == "__main__":
    main()
