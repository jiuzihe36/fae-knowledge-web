#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按 id 升序分块：data/index.json（轻量索引）+ data/specs/chunk-NN.<hash8>.json（每块 42 款）。

为什么按块而不是按系列 / 按型号：
  * 系列分片会随规格书增长而变成超大文件（74LVC 已 204 款 / 2.1 MB）；
  * 一号一文件又会产生 658 次请求，HTTP 开销大；
  * 按 id 升序每 42 款一块，块数只随数据量缓慢增长，
    前端先用 index.json 搜索/筛选，点开型号时按 item.chunk 取 chunks_meta[chunk].file。

产物：
  data/index.json
    {"generated": "...", "total": 658, "chunk_size": 42, "chunks": 16,
     "chunks_meta": [{"i": 0, "file": "chunk-00.a1b2c3d4.json", "n": 42}, ...],
     "items": [{id, model, family, series, function, function_detail,
                package, voltage, temp_range, status, line, chunk}, ...]}
  data/specs/chunk-00.<hash8>.json … chunk-15.<hash8>.json
    {"<id>": [{param, value, kind}, ...], ...}   # 块内 id 升序；html 字段由前端现算

块文件名里的 hash8 = 文件内容 md5 前 8 位：内容变则文件名变，配合
`_headers` 对 /data/specs/* 设 immutable 缓存即可长期缓存且不会读到旧版本。
旧 hash / 旧命名的同号文件在重建时自动清理。

用法：
  python3 scripts/build_chunks.py                        # 全量重建 16 块 + index
  python3 scripts/build_chunks.py --only EM74LVC245APW   # 只重写该型号所在块 + index
  python3 scripts/build_chunks.py --only A,B --only C    # 逗号 / 多次 --only 均可
  python3 scripts/build_chunks.py --check                # 只读校验，不写文件

工程约束：
  * 原子写：先写 <name>.tmp，再 os.replace()；
  * 单块校验：JSON 可解析、块内 id 与 index 分配一致、specs 非空且只含三个字段；
    不合格的块不落盘；
  * 对账：16 块 id 并集 == index.total == products.json 条数，否则 exit 1；
  * 全量模式清理超出范围的旧块 / 无法识别的块文件。
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data"

CHUNK_SIZE = 42
CHUNK_SUBDIR = "specs"
INDEX_NAME = "index.json"
CHUNK_FILE_RE = re.compile(r"^chunk-(\d{2,})\.([0-9a-f]{8})\.json$")
LEGACY_CHUNK_RE = re.compile(r"^chunk-(\d{2,})\.json$")
SPEC_KEYS = ("param", "value", "kind")  # param_html/value_html 由前端现算，不落盘

REQUIRED_FIELDS = ("model", "id", "series", "package", "voltage", "temp_range", "specs")
INDEX_FIELDS = ("id", "model", "family", "series", "function", "function_detail",
                "package", "voltage", "temp_range", "status", "line", "chunk",
                # 2026-11-06：详情抽屉直接用这些字段渲染基础信息，
                # 补进索引后首次开详情不再额外拉一次 374 KB 的 products_lite.json
                "description", "source_label", "pin_image", "applications_domains",
                # 2026-11-12：抽屉「逻辑类型 / 封装尺寸 / 规格书版本 / 版本更新日期」四行
                # 一直显示「-」——这四个字段只在 products_lite 里，索引没带就等于没渲染
                "logic_type", "package_size", "ds_ver", "ds_date")
SAFE_MODEL = re.compile(r"^[A-Za-z0-9._-]+$")
MAX_DETAIL = 8


def fail(msg: str) -> NoReturn:
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(1)


def load_products(data_dir: Path):
    path = data_dir / "products.json"
    if not path.exists():
        fail(f"找不到 {path}")
    try:
        with open(path, encoding="utf-8") as f:
            products = json.load(f)
    except json.JSONDecodeError as e:
        fail(f"{path} 不是合法 JSON：{e}")
    if not isinstance(products, list) or not products:
        fail("products.json 顶层应为非空数组")
    return products


def product_line(series) -> str:
    """与 unified.js selLine() 同口径。"""
    x = str(series or "").upper()
    if x == "EXS":
        return "电平转换"
    if x in ("EMS", "EL", "EMBMS"):
        return "模拟开关"
    return "逻辑"


def product_status(rec: dict) -> str:
    """与 unified.js selStatus() 同口径：规格书名含 Draft/Drft 即未量产。"""
    return "Draft" if re.search(r"draft|drft", str(rec.get("source_label") or ""), re.I) else "正式版"


def is_empty(v) -> bool:
    return v is None or (isinstance(v, (str, list, dict)) and len(v) == 0)


def record_errors(rec: dict):
    if not isinstance(rec, dict):
        return [f"顶层不是对象（{type(rec).__name__}）"]
    errs = [f"缺 {f}" if f not in rec else f"{f} 为空" for f in REQUIRED_FIELDS if is_empty(rec.get(f))]
    if not is_empty(rec.get("specs")) and not isinstance(rec.get("specs"), list):
        errs.append("specs 不是数组")
    return errs


def index_entry(rec: dict, chunk: int) -> dict:
    entry = {k: rec.get(k) for k in INDEX_FIELDS if k not in ("status", "line", "chunk")}
    entry["status"] = product_status(rec)
    entry["line"] = product_line(rec.get("series"))
    entry["chunk"] = chunk
    return {k: entry[k] for k in INDEX_FIELDS}  # 固定字段顺序


def dumps_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def atomic_write(path: Path, payload: bytes) -> None:
    """先写 <name>.tmp 再原子替换，避免半截 JSON。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def assign_chunks(products):
    """按 id 升序切块；返回 (chunks, by_id, chunk_of)。"""
    by_id = {}
    for p in products:
        pid = p.get("id")
        if not isinstance(pid, int):
            fail(f"products.json 存在非整数 id：{pid!r}（model={p.get('model')}）")
        if pid in by_id:
            fail(f"products.json 中 id={pid} 重复")
        by_id[pid] = p
    ordered = sorted(products, key=lambda p: p["id"])
    chunks = [ordered[i:i + CHUNK_SIZE] for i in range(0, len(ordered), CHUNK_SIZE)]
    chunk_of = {p["id"]: ci for ci, part in enumerate(chunks) for p in part}
    return chunks, by_id, chunk_of


def chunk_name(i: int) -> str:
    return f"chunk-{i:02d}"


def expected_ids(part) -> list:
    return [str(p["id"]) for p in part]


def slim_specs(specs):
    """只保留 {param, value, kind}；param_html/value_html 由前端现算。"""
    return [{k: s.get(k) for k in SPEC_KEYS} for s in specs]


def build_chunk_payload(part):
    """{'<id>': [{param,value,kind}]}，按 id 升序；返回 (payload, errors)。"""
    payload, errors = {}, []
    for p in part:
        pid = str(p["id"])
        specs = p.get("specs")
        if not isinstance(specs, list) or not specs:
            errors.append(f"id {pid} specs 为空")
            continue
        if any(not isinstance(s, dict) for s in specs):
            errors.append(f"id {pid} specs 含非对象条目")
            continue
        payload[pid] = slim_specs(specs)
    return payload, errors


def file_hash(blob: bytes) -> str:
    return hashlib.md5(blob).hexdigest()[:8]


def validate_chunk(payload, expected):
    """单块校验：id 集合、specs 非空、JSON 可解析。返回 (blob, errors)。"""
    errors = []
    exp = set(expected)
    got = set(payload)
    extra = sorted(got - exp)
    lack = sorted(exp - got)
    if extra:
        errors.append(f"多出 id：{cap(extra)}")
    if lack:
        errors.append(f"缺 id：{cap(lack)}")
    for pid, specs in payload.items():
        if not isinstance(specs, list) or not specs:
            errors.append(f"id {pid} specs 非空校验失败")
            continue
        for j, s in enumerate(specs, 1):
            if not isinstance(s, dict) or set(s) != set(SPEC_KEYS):
                errors.append(f"id {pid} 第 {j} 条字段不是 {SPEC_KEYS}")
                break
            empty = [k for k in SPEC_KEYS if is_empty(s.get(k))]
            if empty:
                errors.append(f"id {pid} 第 {j} 条缺 {'/'.join(empty)}")
                break
    try:
        blob = dumps_bytes(payload)
        json.loads(blob)  # 显式 round-trip，确保落盘后可解析
    except (TypeError, ValueError) as e:
        return b"", errors + [f"JSON 序列化/解析失败：{e}"]
    return blob + b"\n", errors


def chunk_variants(spec_dir: Path, ci: int):
    """同一块号的所有历史文件（含无 hash 的旧命名）。"""
    out = []
    if not spec_dir.exists():
        return out
    for path in spec_dir.glob("chunk-*.json"):
        m = CHUNK_FILE_RE.match(path.name) or LEGACY_CHUNK_RE.match(path.name)
        if m and int(m.group(1)) == ci:
            out.append(path)
    return out


def write_chunk(data_dir: Path, ci: int, part, report: bool = True):
    """校验并原子写入一块（文件名带内容 hash）；返回 (ok, bytes, file, error)。"""
    payload, errors = build_chunk_payload(part)
    blob, verrs = validate_chunk(payload, expected_ids(part))
    errors.extend(verrs)
    if errors:
        if report:
            print(f"❌ {chunk_name(ci)} 校验失败，未写入：")
            for e in errors[:MAX_DETAIL]:
                print(f"   - {e}")
        return False, 0, "", "；".join(errors)

    fname = f"chunk-{ci:02d}.{file_hash(blob)}.json"
    atomic_write(data_dir.parent / CHUNK_SUBDIR / fname, blob)
    # 内容变则文件名变：清理同块号的旧 hash / 旧命名文件
    removed = []
    for path in chunk_variants(data_dir.parent / CHUNK_SUBDIR, ci):
        if path.name != fname:
            try:
                path.unlink()
                removed.append(path.name)
            except OSError:
                pass
    if report:
        print(f"   ✅ {fname}  {len(payload)} 条 / {len(blob) / 1024:.1f} KB"
              f" / gzip {len(gzip.compress(blob, 6)) / 1024:.1f} KB")
        if removed:
            print(f"      🧹 清理旧块文件：{'、'.join(removed)}")
    return True, len(blob), fname, ""


def write_index(data_dir: Path, products, chunk_of, loaded) -> int:
    ordered = sorted(products, key=lambda p: p["id"])
    items = [index_entry(p, chunk_of[p["id"]]) for p in ordered]
    meta = []
    for ci in range(len(loaded)):
        payload, path, err = loaded[ci]
        meta.append({
            "i": ci,
            "file": path.name if payload is not None else "",
            "n": len(payload) if isinstance(payload, dict) else 0,
        })
    index = {
        "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "total": len(items),
        "spec_total": sum(len(p.get("specs") or []) for p in products),
        "chunk_size": CHUNK_SIZE,
        "chunks": (len(products) + CHUNK_SIZE - 1) // CHUNK_SIZE,
        "chunks_meta": meta,
        "items": items,
    }
    blob = dumps_bytes(index) + b"\n"
    atomic_write(data_dir / INDEX_NAME, blob)
    return len(blob)


def find_chunk_files(spec_dir: Path):
    """返回 ({ci: [paths]}, extras)；忽略 *.tmp。"""
    by, extras = {}, []
    if not spec_dir.exists():
        return by, extras
    for path in spec_dir.glob("chunk-*.json"):
        m = CHUNK_FILE_RE.match(path.name)
        if m:
            by.setdefault(int(m.group(1)), []).append(path)
            continue
        m2 = LEGACY_CHUNK_RE.match(path.name)
        if m2:
            by.setdefault(int(m2.group(1)), []).append(path)
        else:
            extras.append(path.name)
    return by, extras


def load_all_chunks(data_dir: Path, n_chunks: int):
    """返回 {ci: (payload|None, path, error)}；优先选 hash 校验通过的文件。"""
    spec_dir = data_dir.parent / CHUNK_SUBDIR
    files, _ = find_chunk_files(spec_dir)
    out = {}
    for ci in range(n_chunks):
        cands = files.get(ci, [])
        if not cands:
            out[ci] = (None, spec_dir / f"{chunk_name(ci)}.json", "文件缺失")
            continue
        chosen, parse_err = None, ""
        for path in sorted(cands):
            try:
                raw = path.read_bytes()
                data = json.loads(raw)
            except Exception as e:  # noqa: BLE001
                parse_err = f"{path.name} JSON 解析失败：{e}"
                continue
            m = CHUNK_FILE_RE.match(path.name)
            if m and file_hash(raw) == m.group(2):
                chosen = (path, data)
                break
            if chosen is None:
                chosen = (path, data)
        if chosen is None:
            out[ci] = (None, sorted(cands)[0], parse_err or "没有可解析的块文件")
        else:
            out[ci] = (chosen[1], chosen[0], "")
    return out


def cap(items):
    items = list(items)
    head = "、".join(str(x) for x in items[:MAX_DETAIL])
    return head + (f" …（共 {len(items)} 项）" if len(items) > MAX_DETAIL else "")


def size_table(data_dir: Path, chunks, loaded, written=None):
    written = written or set()
    print(f"\n{'块':<4}{'型号 id 范围':<18}{'条数':>5}{'原始':>11}{'gzip':>10}  {'文件':<27}状态")
    print("-" * 100)
    rows = []
    for ci, part in enumerate(chunks):
        payload, path, err = loaded.get(ci, (None, None, "未加载"))
        n = len(payload) if isinstance(payload, dict) else len(part)
        raw = path.stat().st_size if path and path.exists() else 0
        gz = len(gzip.compress(path.read_bytes(), 6)) if path and path.exists() else 0
        state = "本次写入" if ci in written else ("ok" if not err else err)
        lo, hi = part[0]["id"], part[-1]["id"]
        label = f"{lo}–{hi}"
        fname = path.name if path else "-"
        print(f"{ci:<4}{label:<18}{n:>5}{raw / 1024:>9.1f} KB{gz / 1024:>8.1f} KB  {fname:<27}{state}")
        if raw:
            rows.append((raw, gz))
    print("-" * 100)
    if rows:
        raw = [r[0] for r in rows]
        gz = [r[1] for r in rows]
        print(f"合计 {len(chunks)} 块 / {sum(len(p) for p in chunks)} 款："
              f"原始 {sum(raw) / 1024 / 1024:.2f} MB（中位 {statistics.median(raw) / 1024:.1f} KB / "
              f"最大 {max(raw) / 1024:.1f} KB），gzip {sum(gz) / 1024:.1f} KB")
    return rows


def reconcile(data_dir: Path, products, chunks, loaded):
    """块并集 vs products vs index.total。返回 (ok, problems)。"""
    problems = []
    union = set()
    for ci, (payload, path, err) in loaded.items():
        if err:
            problems.append(f"{path.name}: {err}")
            continue
        union |= set(payload)
    want = {str(p["id"]) for p in products}
    missing = sorted(want - union)
    extra = sorted(union - want)
    if missing:
        problems.append(f"块并集缺 {len(missing)} 个 id：{cap(missing)}")
    if extra:
        problems.append(f"块并集多 {len(extra)} 个 id：{cap(extra)}")
    if len(union) != len(products):
        problems.append(f"块并集 {len(union)} ≠ products {len(products)}")

    index_path = data_dir / INDEX_NAME
    if not index_path.exists():
        problems.append(f"缺 {index_path.name}")
        return False, problems
    try:
        with open(index_path, encoding="utf-8") as f:
            idx = json.load(f)
    except Exception as e:  # noqa: BLE001
        problems.append(f"index.json 解析失败：{e}")
        return False, problems
    if idx.get("total") != len(products):
        problems.append(f"index.total={idx.get('total')} ≠ products {len(products)}")
    if len(idx.get("items") or []) != idx.get("total"):
        problems.append(f"index.items {len(idx.get('items') or [])} ≠ index.total {idx.get('total')}")
    idx_ids = {str(it.get("id")) for it in idx.get("items") or []}
    if idx_ids != want:
        problems.append(f"index id 集合与 products 不符（缺 {len(want - idx_ids)} / 多 {len(idx_ids - want)}）")

    # 逐块核对：块内 id == index 中 chunk 字段指向该块的 id
    index_by_chunk = {}
    for it in idx.get("items") or []:
        index_by_chunk.setdefault(it.get("chunk"), set()).add(str(it.get("id")))
    for ci, (payload, path, err) in loaded.items():
        if err:
            continue
        if set(payload) != index_by_chunk.get(ci, set()):
            problems.append(f"{path.name} 的 id 与 index chunk={ci} 的分配不一致")
    return not problems, problems


def cmd_build(args, data_dir: Path, products) -> int:
    chunks, by_id, chunk_of = assign_chunks(products)
    n_chunks = len(chunks)

    by_model = {str(p.get("model")): p for p in products}
    if len(by_model) != len(products):
        fail("products.json 中存在重复或缺失的 model（索引会指向不确定的型号）")
    only_names, unknown = [], []
    if args.only:
        lookup = {m.casefold(): m for m in by_model}
        for raw in args.only:
            for name in raw.split(","):
                name = name.strip()
                if not name:
                    continue
                if name in by_model:
                    only_names.append(name)
                elif name.casefold() in lookup:
                    only_names.append(lookup[name.casefold()])
                else:
                    unknown.append(name)
        only_names = list(dict.fromkeys(only_names))
        if not only_names:
            print("❌ --only 没有匹配到任何型号，未写文件。", file=sys.stderr)
            return 1

    # 文件名级预检（型号只用于索引展示，但提前拦住脏数据）
    seen_ci = {}
    for p in products:
        model = str(p.get("model") or "")
        if model and model.casefold() in seen_ci and seen_ci[model.casefold()] != model:
            fail(f"型号大小写冲突：{seen_ci[model.casefold()]} 与 {model}")
        if model:
            seen_ci[model.casefold()] = model

    if args.only:
        target_chunks = sorted({chunk_of[by_model[m]["id"]] for m in only_names})
        print(f"🎯 增量：{len(only_names)} 个型号 → 重写 {len(target_chunks)} 块 "
              f"({', '.join(chunk_name(c) for c in target_chunks)})")
    else:
        target_chunks = list(range(n_chunks))
        print(f"🎯 全量：{len(products)} 款 → {n_chunks} 块 × {CHUNK_SIZE} 款"
              f"（末块 {len(chunks[-1])} 款）")

    errors, written = [], []
    for name in unknown:
        errors.append(f"找不到型号：{name}")
    for ci in target_chunks:
        ok, nbytes, fname, err = write_chunk(data_dir, ci, chunks[ci])
        if ok:
            written.append(ci)
        else:
            errors.append(f"{chunk_name(ci)}: {err}")

    # 全量模式清理超出当前范围的旧块 / 无法识别的块文件
    pruned = []
    if not args.only:
        spec_dir = data_dir.parent / CHUNK_SUBDIR
        files_by, extras = find_chunk_files(spec_dir)
        stale = [p for ci, paths in files_by.items() if ci >= n_chunks for p in paths]
        stale += [spec_dir / name for name in extras]
        for path in stale:
            try:
                path.unlink()
                pruned.append(path.name)
            except OSError as e:
                errors.append(f"{path.name}: 清理失败 {e}")
        for tmp in spec_dir.glob("*.tmp") if spec_dir.exists() else []:
            try:
                tmp.unlink()
            except OSError:
                pass

    loaded = load_all_chunks(data_dir, n_chunks)
    index_size = write_index(data_dir, products, chunk_of, loaded)
    ok, problems = reconcile(data_dir, products, chunks, loaded)
    if errors:
        ok = False
        problems = [f"{len(errors)} 个块/参数错误"] + problems

    print(f"\n🗂  index.json：{len(products)} 条 / {index_size / 1024:.1f} KB"
          f"（chunk_size={CHUNK_SIZE}, chunks={n_chunks}）")
    if pruned:
        print(f"🧹 清理旧块 {len(pruned)} 个：{cap(pruned)}")
    size_table(data_dir, chunks, loaded, set(written))

    print(f"\n🔎 对账：块 id 并集 / index.total / products = "
          f"{len(set().union(*[set(p) for p, _, e in loaded.values() if not e]))} / "
          f"{len(products)} / {len(products)}")
    if not ok:
        print("❌ 对账失败")
        for p in problems:
            print(f"   - {p}")
        for e in errors[:MAX_DETAIL]:
            print(f"   - {e}")
        return 1
    print(f"✅ 完成：{n_chunks} 块 / {len(products)} 款 / index {len(products)} 条，全部一致")
    return 0


def cmd_check(data_dir: Path, products) -> int:
    chunks, by_id, chunk_of = assign_chunks(products)
    n_chunks = len(chunks)
    issues = []

    spec_dir = data_dir.parent / CHUNK_SUBDIR
    files_by, extras = find_chunk_files(spec_dir)
    if extras:
        issues.append(f"多 {len(extras)} 个无法识别的块文件：{cap(extras)}")
    for ci, paths in sorted(files_by.items()):
        if ci >= n_chunks:
            issues.append(f"多出块号 {ci} 的文件：{cap([p.name for p in paths])}")
        elif len(paths) > 1:
            issues.append(f"块 {ci} 存在 {len(paths)} 个版本（旧 hash 未清理）：{cap([p.name for p in paths])}")

    loaded = load_all_chunks(data_dir, n_chunks)
    for ci, part in enumerate(chunks):
        payload, path, err = loaded[ci]
        if err:
            issues.append(f"{path.name}: {err}")
            continue
        m = CHUNK_FILE_RE.match(path.name)
        if not m:
            issues.append(f"{path.name} 文件名不含内容 hash（旧命名）")
        elif file_hash(path.read_bytes()) != m.group(2):
            issues.append(f"{path.name} 文件名 hash 与内容 md5 不一致")
        exp = set(expected_ids(part))
        got = set(payload)
        if got != exp:
            issues.append(f"{path.name} id 不符（缺 {len(exp - got)} / 多 {len(got - exp)}）："
                          f"{cap(sorted(exp - got) or sorted(got - exp))}")
        bad, bad_fields = [], []
        for pid, specs in payload.items():
            if not isinstance(specs, list) or not specs:
                bad.append(pid)
                continue
            if any(not isinstance(s, dict) or set(s) != set(SPEC_KEYS)
                   or any(is_empty(s.get(k)) for k in SPEC_KEYS) for s in specs):
                bad_fields.append(pid)
        if bad:
            issues.append(f"{path.name} 有 {len(bad)} 条 specs 为空：{cap(bad)}")
        if bad_fields:
            issues.append(f"{path.name} 有 {len(bad_fields)} 条 specs 字段不是 {SPEC_KEYS}：{cap(bad_fields)}")

    # index 校验
    index_path = data_dir / INDEX_NAME
    index_size = index_path.stat().st_size if index_path.exists() else 0
    idx = None
    if not index_path.exists():
        issues.append("缺 index.json")
    else:
        try:
            with open(index_path, encoding="utf-8") as f:
                idx = json.load(f)
        except Exception as e:  # noqa: BLE001
            issues.append(f"index.json 解析失败：{e}")
    if isinstance(idx, dict):
        items = idx.get("items") or []
        if idx.get("total") != len(products):
            issues.append(f"index.total={idx.get('total')} ≠ products {len(products)}")
        if len(items) != idx.get("total"):
            issues.append(f"index.items {len(items)} ≠ index.total {idx.get('total')}")
        if idx.get("chunk_size") != CHUNK_SIZE:
            issues.append(f"index.chunk_size={idx.get('chunk_size')} ≠ {CHUNK_SIZE}")
        if idx.get("chunks") != n_chunks:
            issues.append(f"index.chunks={idx.get('chunks')} ≠ {n_chunks}")
        meta = idx.get("chunks_meta") or []
        if len(meta) != n_chunks:
            issues.append(f"index.chunks_meta 有 {len(meta)} 项 ≠ {n_chunks}")
        else:
            bad_meta = []
            for ci, ent in enumerate(meta):
                payload, path, err = loaded[ci]
                n_expected = len(payload) if isinstance(payload, dict) else 0
                if (ent.get("i") != ci or not path or ent.get("file") != path.name
                        or ent.get("n") != n_expected):
                    bad_meta.append(f"{ci}:{ent.get('file')}≠{path.name if path else '-'}")
            if bad_meta:
                issues.append(f"{len(bad_meta)} 条 chunks_meta 与实际文件不符：{cap(bad_meta)}")
        ids = [str(it.get("id")) for it in items]
        want = [str(p["id"]) for p in products]
        if sorted(ids) != sorted(want):
            miss = set(want) - set(ids)
            extra = set(ids) - set(want)
            issues.append(f"index 型号集合不符（缺 {len(miss)} / 多 {len(extra)}）："
                          f"{cap(sorted(miss) or sorted(extra))}")
        bad_fields, bad_chunk, stale = [], [], []
        for it in items:
            if any(k not in it for k in INDEX_FIELDS):
                bad_fields.append(str(it.get("model")))
                continue
            pid = it.get("id")
            p = by_id.get(pid)
            if p is None:
                continue
            ci = chunk_of[pid]
            if it.get("chunk") != ci:
                bad_chunk.append(f"{it.get('model')}={it.get('chunk')}≠{ci}")
            if any(it.get(k) != v for k, v in index_entry(p, ci).items()):
                stale.append(str(it.get("model")))
        if bad_fields:
            issues.append(f"{len(bad_fields)} 条索引字段不全：{cap(bad_fields)}")
        if bad_chunk:
            issues.append(f"{len(bad_chunk)} 条 chunk 编号错误：{cap(bad_chunk)}")
        if stale:
            issues.append(f"{len(stale)} 条索引内容与 products.json 不一致：{cap(stale)}")

    print(f"🔎 校验：products {len(products)} 款 / 应为 {n_chunks} 块")
    print(f"🗂  index.json：{(len(idx.get('items') or []) if isinstance(idx, dict) else 0)} 条 / "
          f"{index_size / 1024:.1f} KB")
    size_table(data_dir, chunks, loaded)

    if issues:
        print(f"\n❌ 校验失败：{len(issues)} 类问题")
        for i in issues:
            print(f"   - {i}")
        return 1
    print(f"\n✅ 校验通过：{n_chunks} 块齐全、id 与 index 一致、index 与 products 一致")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="按 id 分块生成 data/index.json + data/specs/chunk-NN.<hash>.json")
    ap.add_argument("--only", action="append", metavar="MODEL",
                    help="只重写指定型号所在块（逗号分隔，可重复），并刷新 index")
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA),
                    help=f"数据目录（默认 {DEFAULT_DATA}）")
    args = ap.parse_args()

    if args.check and args.only:
        ap.error("--check 与 --only 不能同时使用")
    data_dir = Path(args.data_dir).expanduser().resolve()
    products = load_products(data_dir)

    if args.check:
        return cmd_check(data_dir, products)
    return cmd_build(args, data_dir, products)


if __name__ == "__main__":
    sys.exit(main())
