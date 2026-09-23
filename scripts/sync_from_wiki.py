#!/usr/bin/env python3
"""从本地 wiki 同步数据到 products.json（增量更新）"""
import json, os, re, glob
from pathlib import Path

WIKI = Path.home() / "wiki"
WEB = Path.home() / "fae-knowledge-web"
RAW_DIR = WIKI / "raw" / "datasheets"
ENTITIES_DIR = WIKI / "entities"
PRODUCTS_FILE = WEB / "data" / "products.json"

def parse_entity_specs(slug):
    """从实体页电气特性全集解析 specs"""
    ef = ENTITIES_DIR / f"{slug}.md"
    if not ef.exists():
        return []
    content = ef.read_text(encoding="utf-8")
    m = re.search(r"## 电气特性全集\n(.*?)(?=\n## 封装|\n## 应用|\n## 参见|\Z)", content, re.S)
    if not m:
        return []
    sec = m.group(1)
    specs = []
    src = re.search(r"提取自 (\S+\.pdf)", sec)
    sl = src.group(1) if src else None
    for line in sec.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")]
        cells = [c for c in cells if c]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            continue
        if cells[0] in ("符号", "参数"):
            continue
        if len(cells) == 3:
            specs.append({"param": cells[0], "value": cells[2], "source_label": sl})
        elif len(cells) >= 4:
            specs.append({"param": f"{cells[0]}|{cells[1]}", "value": cells[-1], "source_label": sl})
    return specs

def get_info(raw_name):
    ln = raw_name.lower()
    if "ems" in ln:
        return "模拟开关", "EMS"
    elif "exs" in ln:
        return "电平转换器", "EXS"
    elif "el" in ln:
        return "逻辑芯片", "EL"
    return "逻辑芯片", "EM74"

def main():
    print("📦 从 wiki 同步数据...")
    existing = json.loads(PRODUCTS_FILE.read_text(encoding="utf-8")) if PRODUCTS_FILE.exists() else []
    have_models = set(x["model"] for x in existing)
    print(f"   现有: {len(existing)} 条")
    
    raw_files = sorted(glob.glob(str(RAW_DIR / "*.json")))
    new_count = 0
    
    for rp in raw_files:
        rn = os.path.basename(rp)
        rd = json.loads(Path(rp).read_text(encoding="utf-8"))
        sl = rd.get("source_basename", rn)
        pkgs = rd.get("packages", [])
        pns = rd.get("part_numbers", [])
        
        # 从文件名提取型号（当 part_numbers 为空时）
        if not pns:
            m = re.match(r"^([A-Z0-9]+)_", rn)
            if m:
                pns = [m.group(1)]
        
        if not pns:
            continue
        
        family, series = get_info(rn)
        slug = sl.replace(".pdf", "").lower().replace("_", "-")
        specs = parse_entity_specs(slug)
        
        # 交叉组合 part_numbers × packages
        models_pkgs = []
        if pns and pkgs:
            for pn in pns:
                for pkg in pkgs:
                    models_pkgs.append((pn, pkg))
        elif pns:
            for pn in pns:
                models_pkgs.append((pn, "未知"))
        
        def covered(pn, existing):
            """跳过裸占位：已有带封装后缀的真实订购码变体时不再补裸名
            （2026-09-21 清洗策略；否则每次同步会把 244 条占位加回来）"""
            if pn in existing:
                return True
            if '-' in pn:
                core, grade = pn.split('-', 1)
                if any(m.startswith(core) and m.endswith('-' + grade) for m in existing):
                    return True
            return any(m.startswith(pn) and m != pn for m in existing)

        for model, pkg in models_pkgs:
            if model in have_models or covered(model, have_models):
                continue
            new_id = 20000 + len(existing) + new_count
            existing.append({
                "id": new_id, "model": model, "family": family,
                "series": series, "function": "其他",
                "description": rd.get("title_line", ""),
                "package": pkg, "package_size": None,
                "voltage": None, "pin_image": None,
                "logic_type": "CMOS", "temp_range": None,
                "source_document_id": None, "source_label": sl,
                "specs": specs
            })
            have_models.add(model)
            new_count += 1
    
    PRODUCTS_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✅ 新增 {new_count} 条, 总计 {len(existing)} 条")

if __name__ == "__main__":
    main()
