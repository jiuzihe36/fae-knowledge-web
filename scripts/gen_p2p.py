#!/usr/bin/env python3
"""gen_p2p.py — 解析 wiki comparisons/p2p-ti-full-mapping.md → data/p2p.json.

输出 schema 对齐 p2p_fixture.json:
  {"generated", "source", "ti_index": {PN: {status, evidence}},
   "logic": [{slug, em, vcc_em, vcc_ti, ti[], verdict, note}],
   "analog": [{slug, ti_text, verdict, note, evidence}]}

对账: §1/§3/§4 物理数据行数 == 解析条数 == 原文声明值(165/235/32)
      且 §1 判定分布 == §1 统计行; 任一不符 → stderr 报错 + exit 1。
只读 wiki, 只写 data/p2p.json。
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "wiki" / "comparisons" / "p2p-ti-full-mapping.md"
OUT = ROOT / "data" / "p2p.json"

EXPECTED = {"logic": 165, "ti_index": 235, "analog": 32}
SOURCE_LABEL = "wiki comparisons/p2p-ti-full-mapping.md + p3 取证"
VALID_STATUS = {"ACTIVE", "OBSOLETE", "NOTFOUND", "UNCERTAIN"}
SEP_RE = re.compile(r"^\|[\s\-:|]+\|?$")


def die(msg: str) -> NoReturn:
    print(f"[gen_p2p] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def split_section(lines: list[str], start_h: str, end_h: str) -> list[str]:
    try:
        si = next(i for i, l in enumerate(lines) if l.startswith(start_h))
        ei = next(i for i, l in enumerate(lines) if l.startswith(end_h))
    except StopIteration:
        die(f"section heading not found: {start_h!r} / {end_h!r}")
    return lines[si:ei]


def raw_cells(line: str) -> list[str]:
    parts = line.split("|")
    if parts[0].strip() or parts[-1].strip():
        die(f"table row missing edge pipes: {line[:120]!r}")
    return [p.strip() for p in parts[1:-1]]


def balance(s: str) -> int:
    return s.count("(") - s.count(")")


def parse_table(sec: list[str], ncol: int) -> list[list[str]]:
    """取 section 内数据行(去表头/分隔行), 修复单元格内裸 | 造成的多列。"""
    rows = [l for l in sec if l.startswith("|")]
    rows = [l for l in rows if not SEP_RE.match(l)]
    if len(rows) < 2:
        die("empty table")
    body = rows[1:]  # 首行是表头
    out = []
    for line in body:
        c = raw_cells(line)
        while len(c) > ncol:
            # 裸 | 在证据列: 上一格括号未闭合; 否则在备注列(合并其后所有格)
            if len(c) > 2 and balance(c[2]) > 0:
                c = c[:2] + [c[2] + " | " + c[3]] + c[4:]
            else:
                c = c[: ncol - 1] + [" | ".join(c[ncol - 1:])]
        if len(c) < ncol:
            die(f"row has {len(c)} cells (<{ncol}): {line[:120]!r}")
        out.append(c)
    return out


def main() -> None:
    if not SRC.is_file():
        die(f"source not found: {SRC}")
    text = SRC.read_text(encoding="utf-8")
    lines = text.split("\n")

    # --- §1 逻辑 165 ---
    s1 = parse_table(split_section(lines, "## 1.", "## 2."), 11)
    logic = []
    for c in s1:
        slug = c[1]
        m = re.fullmatch(r"\[\[(.+?)\]\]", slug)
        if not m:
            die(f"§1 slug not [[..]]: {slug!r}")
        logic.append(
            {
                "slug": m.group(1),
                "em": c[2],
                "vcc_em": c[3],
                "vcc_ti": c[8],
                "ti": [t.strip() for t in c[6].split("/") if t.strip()],
                "verdict": c[9],
                "note": c[10],
            }
        )

    # --- §3 证据表 235 ---
    s3 = parse_table(split_section(lines, "## 3.", "## 4."), 4)
    ti_index: dict[str, dict[str, str]] = {}
    for pn, status, evidence, _note in s3:
        if status not in VALID_STATUS:
            die(f"§3 bad STATUS {status!r} for {pn!r}")
        if not evidence:
            die(f"§3 empty evidence for {pn!r}")
        if pn in ti_index:
            die(f"§3 duplicate TI PN: {pn}")
        ti_index[pn] = {"status": status, "evidence": evidence}

    # --- §4 模拟 32 (老行: （见备注）| verdict | cell文本 | 来源; 新行: TI_PN | verdict | NOTE | evidence) ---
    s4 = parse_table(split_section(lines, "## 4.", "## 5."), 6)
    analog = []
    for c in s4:
        m = re.fullmatch(r"\[\[(.+?)\]\]", c[1])
        if not m:
            die(f"§4 slug not [[..]]: {c[1]!r}")
        if c[2] == "（见备注）":  # 老行: TI 文本在第 5 列, note 空
            ti_text, note = c[4], ""
        else:  # 新行
            ti_text, note = c[2], c[4]
        analog.append(
            {
                "slug": m.group(1),
                "ti_text": ti_text,
                "verdict": c[3],
                "note": note,
                "evidence": c[5],
            }
        )

    # --- 对账: 物理行数 == 解析条数 == 原文声明值 ---
    counts = {"logic": len(logic), "ti_index": len(ti_index), "analog": len(analog)}
    physical = {"logic": len(s1), "ti_index": len(s3), "analog": len(s4)}
    errors = []
    for key, want in EXPECTED.items():
        if physical[key] != counts[key]:
            errors.append(f"{key}: 物理行 {physical[key]} != 解析 {counts[key]}")
        if counts[key] != want:
            errors.append(f"{key}: 解析 {counts[key]} != 期望 {want}")

    declared: dict[str, int] = {}
    for key, pat in {
        "logic": r"（(\d+) 实体",
        "logic_stats": r"§1 统计：(\d+) 实体行",
        "analog": r"(\d+) 型 TI 对标总表",
        "ti_index": r"：(\d+) 个候选",
    }.items():
        m = re.search(pat, text)
        if m:
            declared[key if key != "logic_stats" else "logic"] = int(m.group(1))
    for key, val in declared.items():
        if val != counts[key]:
            errors.append(f"{key}: 原文声明 {val} != 解析 {counts[key]}")

    # --- §1 判定分布 vs §1 统计行 ---
    v_logic = Counter(e["verdict"] for e in logic)
    v_analog = Counter(e["verdict"] for e in analog)
    m = re.search(r"§1 统计：\d+ 实体行 — \[OK\] (\d+) · \[!\] (\d+) · ✖ (\d+)", text)
    if m:
        want = {"[OK]": int(m.group(1)), "[!]": int(m.group(2)), "✖": int(m.group(3))}
        got = dict(v_logic)
        if {k: got.get(k, 0) for k in want} != want or len(got) != len(want):
            errors.append(f"§1 判定分布 {got} != 统计行 {want}")
    else:
        errors.append("§1 统计行未找到")

    # --- 重复 slug 检查 ---
    for name, entries in (("logic", logic), ("analog", analog)):
        dups = [s for s, n in Counter(e["slug"] for e in entries).items() if n > 1]
        if dups:
            errors.append(f"{name} duplicate slug: {dups}")

    # --- 输出 ---
    fm = re.search(r"^updated:\s*(\S+)", text, re.M)
    generated = fm.group(1) if fm else date.today().isoformat()
    data = {
        "generated": generated,
        "source": SOURCE_LABEL,
        "ti_index": ti_index,
        "logic": logic,
        "analog": analog,
    }

    print(f"[gen_p2p] source : {SRC}")
    print(f"[gen_p2p] counts  : logic={counts['logic']} analog={counts['analog']} "
          f"ti_index={counts['ti_index']}")
    print(f"[gen_p2p] verdict : logic={dict(v_logic)}")
    print(f"[gen_p2p] verdict : analog={dict(v_analog)}")
    print(f"[gen_p2p] 对账    : §1 物理={physical['logic']}/解析={counts['logic']}/声明={declared.get('logic')}"
          f" | §3 物理={physical['ti_index']}/解析={counts['ti_index']}/声明={declared.get('ti_index')}"
          f" | §4 物理={physical['analog']}/解析={counts['analog']}/声明={declared.get('analog')}")

    if errors:
        for e in errors:
            print(f"[gen_p2p] 对账失败: {e}", file=sys.stderr)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"[gen_p2p] wrote   : {OUT} ({OUT.stat().st_size} bytes) — 对账全部通过")


if __name__ == "__main__":
    main()
