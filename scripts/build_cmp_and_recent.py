#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成两个前端用的小数据文件（避免对比/更新页去拉 6.8MB 的 products.json）

1) data/specs_cmp.json —— 每型号 6 个关键参数，供选型表「勾选对比」用（约 200KB）
2) data/recent.json     —— 按规格书日期分组的变更记录（198 份去重，供「更新记录」页）

用法: python3 scripts/build_cmp_and_recent.py
"""
import json, re
from collections import OrderedDict
from pathlib import Path

W = Path(__file__).resolve().parent.parent
PROD = json.load(open(W / "data" / "products.json", encoding="utf-8"))

def pick_vcc(specs):
    for s in specs:
        if s.get("kind") == "推荐工作条件" and "VCC supply voltage" in s.get("param", ""):
            v = s.get("value", "")
            m = re.search(r"min=([\d.\-]+).*?max=([\d.\-]+)", v)
            if m:
                return f"{m.group(1)}–{m.group(2)} V"
            m = re.search(r"([\d.\-]+)\s*[–~-]\s*([\d.\-]+)\s*V", v)
            if m:
                return f"{m.group(1)}–{m.group(2)} V"
            return v.replace("min=", "").replace("; max=", "–")[:24]
    return ""

def pick_tpd(specs):
    """动态参数 tpd：优先 typ，其次第一段 min，再次最小数值"""
    rows = [x for x in specs if x.get("kind") == "动态"
            and ("tpd" in x.get("param", "").lower() or "tPLH" in x.get("param", "") or "tPHL" in x.get("param", ""))
            and "ns" in x.get("value", "")]
    # 优先 3.3 V 档（最常用的选型参考点）
    rows.sort(key=lambda x: (0 if ("3.3" in x.get("param", "") or "3.0 ~ 3.6" in x.get("param", "")) else 1))
    best = ""
    for s_ in rows:
        p_ = s_.get("param", "")
        v = s_.get("value", "")
        if "ns" not in v:
            continue
        m = re.search(r"typ=([\d.]+)", v)
        if m:
            return f"{m.group(1)} ns"
        # "1.5 / 7.0 / 9.7 ns" → 取中间（typ）
        seg = v.split("·")[0]
        nums = re.findall(r"[\d.]+", seg)
        if len(nums) >= 3:
            return f"{nums[1]} ns"
        if len(nums) == 2:
            return f"{nums[0]}–{nums[1]} ns"
        if nums and not best:
            best = f"{nums[0]} ns"
    return best


def pick_icc(specs):
    for s_ in specs:
        p_ = s_.get("param", "")
        if s_.get("kind") != "静态" or "ICC" not in p_ or "supply" not in p_:
            continue
        v = s_.get("value", "")
        nums = re.findall(r"[\d.]+", v)
        if not nums:
            continue
        unit = "µA" if any(k in v for k in ("µA", "μA", "uA")) else ("mA" if "mA" in v else "")
        return f"max {nums[-1]} {unit}".strip()
    return ""


def pick_tamb(specs):
    for s in specs:
        if "Tamb" in s.get("param", "") and s.get("kind") == "推荐工作条件":
            v = s.get("value", "")
            m = re.search(r"min=([\-\d.]+).*?max=([\-\d.]+)", v)
            if m:
                return f"{m.group(1)}–{m.group(2)} ℃"
            return v[:18]
    return ""

def pick_ron(specs):
    """模拟开关的关键参数：导通电阻 Ron（取最小/典型值）与带宽"""
    for s in specs:
        p = s.get("param", "")
        if "Ron" in p or "on-resistance" in p.lower() or "导通电阻" in p:
            v = s.get("value", "")
            m = re.search(r"typ=([\d.]+)|max=([\d.]+)|min=([\d.]+)", v)
            if m:
                return (m.group(1) or m.group(2) or m.group(3)) + " Ω"
            m2 = re.search(r"([\d.]+)\s*Ω", v)
            if m2:
                return m2.group(1) + " Ω"
            return v[:14]
    return ""

def pick_bw(specs):
    for s in specs:
        p = s.get("param", "")
        if ("带宽" in p or "bandwidth" in p.lower() or "-3dB" in p.replace(" ", "")) and "MHz" in s.get("value", ""):
            m = re.search(r"([\d.]+)\s*MHz", s["value"])
            if m:
                return m.group(1) + " MHz"
    return ""

def pick_drive(specs):
    """取静态表里出现过的最大测试电流（IO = -XX mA / IO = XX mA）"""
    neg = pos = 0
    for s in specs:
        if s.get("kind") != "静态":
            continue
        p = s.get("param", "")
        for m in re.finditer(r"IO\s*=\s*(-?)(\d+(?:\.\d+)?)\s*mA", p):
            v = float(m.group(2))
            if m.group(1) == "-":
                neg = max(neg, v)
            else:
                pos = max(pos, v)
    out = []
    if neg:
        out.append(f"-{neg:g} mA")
    if pos:
        out.append(f"{pos:g} mA")
    return " / ".join(out)

cmp_out = OrderedDict()
for p in PROD:
    specs = p.get("specs") or []
    cmp_out[p["model"]] = {
        "vcc": pick_vcc(specs),
        "ron": pick_ron(specs),
        "bw": pick_bw(specs),
        "tpd": pick_tpd(specs),
        "drive": pick_drive(specs),
        "icc": pick_icc(specs),
        "tamb": pick_tamb(specs),
        "pkg": p.get("package") or "",
    }
json.dump(cmp_out, open(W / "data" / "specs_cmp.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
size = (W / "data" / "specs_cmp.json").stat().st_size
filled = sum(1 for v in cmp_out.values() if v["vcc"])
print(f"specs_cmp.json: {len(cmp_out)} 款 / {size/1024:.0f} KB / VCC 有值 {filled}")

# ---------- recent.json ----------
DOCS = json.load(open(W / "data" / "docs.json", encoding="utf-8"))
SRC = {p["model"]: (p.get("source_label") or "") for p in PROD}
seen, docs = set(), []
for it in DOCS["items"]:
    key = SRC.get(it.get("m")) or ((it.get("dv") or "") + "|" + (it.get("dd") or "") + "|" + (it.get("fn") or ""))
    # 按规格书去重：同一 (版本, 日期, 系列) 只留一条，型号收集起来
    if key in seen:
        for d in docs:
            if d["src"] == key:
                d["models"].append(it["m"])
                break
        continue
    seen.add(key)
    docs.append({"src": key, "dv": it.get("dv") or "", "dd": it.get("dd") or "",
                 "se": it.get("se") or "", "fn": it.get("fn") or "",
                 "models": [it["m"]]})

docs.sort(key=lambda d: d["dd"], reverse=True)
from datetime import date
today = date(2026, 11, 6)
def age(d):
    try:
        y, m, dd = [int(x) for x in d["dd"].split("-")]
        return (today - date(y, m, dd)).days
    except Exception:
        return 99999
for d in docs:
    d["age"] = age(d)
buckets = [
    {"label": "最近 30 天", "items": [d for d in docs if d["age"] <= 30]},
    {"label": "31–90 天", "items": [d for d in docs if 30 < d["age"] <= 90]},
    {"label": "91–365 天", "items": [d for d in docs if 90 < d["age"] <= 365]},
    {"label": "一年以上", "items": [d for d in docs if d["age"] > 365]},
]
recent = {"generated": "2026-11-06", "latest": DOCS["stats"].get("ds_latest"),
          "total": len(docs), "buckets": buckets}
json.dump(recent, open(W / "data" / "recent.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("recent.json: %d 份规格书 | %s" % (len(docs), " / ".join(f"{b['label']} {len(b['items'])}" for b in buckets)))
for b in buckets[:2]:
    for d in b["items"][:4]:
        print(f"  {b['label']}: {d['dd']} {d['dv']:6} {d['se']:6} {len(d['models'])} 款")
