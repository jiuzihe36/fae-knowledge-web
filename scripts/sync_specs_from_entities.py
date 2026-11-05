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
    def _n(x):
        try:
            return float(str(x).replace("−", "-").replace("–", "-"))
        except Exception:
            return None

    if items and all(num.match(x) for x in items):
        if len(items) == 2:
            a, b = _n(items[0]), _n(items[1])
            if a is not None and b is not None and a > b:
                return " · ".join(items) + (f" {unit}" if unit else "")   # min>max → 不标，原样
            return cond + f"min={items[0]}; max={items[1]}" + (f" {unit}" if unit else "")
        if len(items) == 3:
            a, b, c = _n(items[0]), _n(items[1]), _n(items[2])
            if a is not None and c is not None and a > c:
                return " · ".join(items) + (f" {unit}" if unit else "")
            return cond + f"min={items[0]}; typ={items[1]}; max={items[2]}" + (f" {unit}" if unit else "")
    return cond + " · ".join(items) + (f" {unit}" if unit and not any(unit in x for x in items) else "")


# 长前缀必须排在短前缀前（AHCT 先于 AHC、LVCH 先于 LVC），否则 EM74AHCT 会被截成 AHC，两组变体被合并成一组
FAMILY_RE = re.compile(r"^(?:EM74)?(AHCT|AHC|LVCH|LVC|HCU|HCT|HC|AUP1T|AUP|LV1T|CBTLV|CBT)", re.I)

def col_groups(header):
    """从表头（第 4 列起、去掉 Unit 列）解析每个数值列的「组名 + Min/Typ/Max」。
    例："EM74HC365 Min","EM74HC365 Typ","EM74HC365 Max","EM74HCT365 Min"… →
        [("HC","min"),("HC","typ"),("HC","max"),("HCT","min"),…]
    单变体表头（只有 Min/Typ/Max）→ 组名为空。"""
    if not header or len(header) < 5:
        return []
    cols = header[3:]
    # 去掉末尾单位列（Unit/单位/℃/V…）
    if cols and re.search(r"unit|单位", cols[-1], re.I):
        cols = cols[:-1]
    out = []
    for c in cols:
        m = re.search(r"\b(min|typ|max)\b\.?$", c, re.I)
        if m:
            role = m.group(1).lower()
            label = c[: m.start()].strip(" .·")
        else:
            role = None
            label = c.strip(" .·")
        fam = ""
        fm = FAMILY_RE.match(label.replace(" ", ""))
        if fm:
            fam = fm.group(1).upper()
        elif re.search(r"°C|℃", label):
            fam = label.replace(" ", "")
        out.append((fam, role))
    return out

def fmt_grouped(rest, groups):
    """按列组格式化：HC：min=2.0; typ=5.0; max=6.0 ｜ HCT：min=4.5; typ=5.0; max=5.5 V"""
    # 关键：**保留空位**（— 占位），否则与列组 zip 会整体错位（VI 的 typ=— 会导致 max 落到 typ 位）
    items = [x.strip() for x in rest]
    unit = ""
    if items and UNIT_RE.match(items[-1]):
        unit = items[-1]
        items = items[:-1]
    if not groups or len(groups) != len(items):
        # 列组与数值个数必须严格相等；不等说明表头结构特殊（温度档×Min/Typ/Max 混排），
        # 宁可原样连接也不要错标（曾出现 min=1.2; max=1.05 这种 min>max 的荒谬结果）
        return None
    # 按组聚集
    from collections import OrderedDict
    bucket = OrderedDict()
    for (fam, role), val in zip(groups, items):
        if val in ("", "—", "–", "-", "－", "/"):
            continue
        bucket.setdefault(fam or "", {})[role or "val"] = val
    if len(bucket) == 1:
        fam0, d0 = next(iter(bucket.items()))
        if not fam0:
            # 单变体表：仍按 Min/Typ/Max 角色标注（比原样连接可读）
            segs = [f"{r}={d0[r]}" for r in ("min", "typ", "max") if r in d0]
            if "val" in d0:
                segs.append(d0["val"])
            return "; ".join(segs) + (f" {unit}" if unit else "") if segs else None
    if len(bucket) < 2:
        return None          # 多组但组名相同 → 交给原 fmt_value
    def _num(x):
        try:
            return float(str(x).replace("−", "-").replace("–", "-"))
        except Exception:
            return None

    parts = []
    for fam, d in bucket.items():
        if "min" in d and "max" in d:
            a, b = _num(d["min"]), _num(d["max"])
            if a is not None and b is not None and a > b:
                return None      # 数值顺序反常 → 不做格式化
        segs = []
        for role in ("min", "typ", "max"):
            if role in d:
                segs.append(f"{role}={d[role]}")
        if "val" in d:
            segs.append(d["val"])
        if not segs:
            continue
        parts.append((fam + "：" if fam else "") + "; ".join(segs))
    return " ｜ ".join(parts) + (f" {unit}" if unit else "") if parts else None


def fix_sub(s):
    """实体页从 PDF 抄录时下标被拆成两个 token（V CC、I IK、T amb），这里拼回去。"""
    s = re.sub(r"\bV\s+(CC|I|O|IH|IL|OH|OL|SW)\b", r"V\1", s)
    s = re.sub(r"\bI\s+(IK|OK|CC|GND)\b", r"I\1", s)
    s = re.sub(r"\bT\s+(amb|stg|j|J)\b", r"T\1", s)
    return s


def cond_index(header, ncols):
    """返回条件列的下标；数值列从该下标 +1 开始。
    表头含「条件/Conditions」→ 用其位置；否则默认第 3 列（index 2）有条件列，
    但只有列表长度与表头一致时才信任表头。"""
    if header and len(header) == ncols:
        for i, c in enumerate(header):
            if re.search(r"条件|condition", c, re.I):
                return i
        # 表头是 符号|参数|min|… 这种没有条件列的
        if len(header) >= 4 and re.search(r"\b(min|typ|max)\b", header[2], re.I):
            return 1
    return 2

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
        if ("符号" in cells[0] or "参数" in cells[0] or "symbol" in cells[0].lower()
                or "parameter" in cells[0].lower()):
            cur_header = cells
            continue
        if len(cells) < 2:
            continue
        sym = cells[0]
        if sym in ("符号", "参数", "—", "-", ""):
            continue
        ci = cond_index(cur_header, len(cells))
        ci = min(ci, len(cells) - 1)
        # param = 符号 + 参数名 + 条件；rest = 纯数值列（+ 末尾单位）
        param = " ".join(x for x in cells[: ci + 1] if x not in ("—", "-", "")).strip()
        rest = cells[ci + 1:]
        if not rest and len(cells) >= 3:
            # 3 列表（符号 | 参数 | 值/限制），没有独立条件列 → 第 3 列就是值
            param = " ".join(x for x in cells[:2] if x not in ("—", "-", "")).strip()
            rest = cells[2:]
        if not rest:
            continue
        groups = col_groups(cur_header)
        value = fmt_grouped(rest, groups) if groups else None
        if value is None:
            value = fmt_value(rest)
        if not value:
            continue
        param = fix_sub(param)
        value = fix_sub(value)
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
