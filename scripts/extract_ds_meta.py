#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐份解析 datasheets/*.pdf，提取「最新版本号 + 该版本发布日期」→ data/ds_meta.json

数据来源优先级（均为规格书原文，不推测）：
  1. 规格书末页「Revision History」表（权威：Document ID / Release Date）
  2. 首页/页眉「Rev. x.y – Mon DD, YYYY」抬头
版本号以文件名为准做交叉校验，不一致会在输出里标 mismatch（供人工复核）。

用法：python3 scripts/extract_ds_meta.py
输出：data/ds_meta.json
  {"generated": "...", "stats": {...}, "items": {"EM74LVC1G00_Product_DS_V1.1.pdf": {"ver": "1.1", "date": "2025-12-15"}}}
"""
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DS_DIR = BASE / 'datasheets'
OUT = BASE / 'data' / 'ds_meta.json'

MON = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}

REV_NUM = r'([0-9]+(?:\.[0-9]+)*)'
MONTH = r'([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})'
# 末页修订记录表：「Rev. 1.1」换行「Dec 15, 2025」（可能夹着 Document ID）
RE_TABLE = re.compile(r'Rev\.?\s*' + REV_NUM + r'\s*\n\s*' + MONTH)
# 页眉抬头：「Rev. 1.1 – Dec 15, 2025」/「Rev1.1– Dec, 2025」（缺日期的退化形态也收）
RE_HEAD = re.compile(r'Rev\.?\s*' + REV_NUM + r'\s*[–\-—]?\s*' + MONTH)
RE_FILE = re.compile(r'_(?:Product|Draft|Drft)_DS_V(' + REV_NUM + r')\.pdf$')


def vkey(v):
    try:
        return tuple(int(x) for x in str(v).split('.'))
    except Exception:
        return (0,)


def iso(mon, day, year):
    m = MON.get(str(mon)[:3].lower())
    if not m:
        return None
    return '%04d-%02d-%02d' % (int(year), m, int(day))


def parse(pdf):
    """→ (ver, date, source)  ver/date 为该规格书最新版本及其发布日期"""
    import fitz
    doc = fitz.open(str(pdf))
    pages = [doc[i].get_text() for i in range(doc.page_count)]
    doc.close()

    # ① 修订记录表（最后 3 页）
    tail = '\n'.join(pages[-3:])
    entries = [(m.group(1), iso(m.group(2), m.group(3), m.group(4)))
               for m in RE_TABLE.finditer(tail)]
    entries = [e for e in entries if e[1]]
    if entries:
        ver, date = max(entries, key=lambda e: vkey(e[0]))
        return ver, date, 'revision-history'

    # ② 页眉抬头（首页优先，其次全文）
    for scope in (pages[0] if pages else '', '\n'.join(pages)):
        m = RE_HEAD.search(scope)
        if m:
            d = iso(m.group(2), m.group(3), m.group(4))
            if d:
                return m.group(1), d, 'header'
    return None, None, None


def main():
    if not DS_DIR.is_dir():
        print('❌ 找不到目录: %s' % DS_DIR)
        return 1

    items, missing, mismatch = {}, [], []
    for pdf in sorted(DS_DIR.glob('*.pdf')):
        ver, date, src = parse(pdf)
        fver = RE_FILE.search(pdf.name)
        fver = fver.group(1) if fver else None
        if ver and fver and vkey(ver) != vkey(fver):
            mismatch.append((pdf.name, fver, ver, date, src))
        if not ver or not date:
            missing.append((pdf.name, fver))
            ver, date = (ver or fver), date
        items[pdf.name] = {'ver': ver, 'date': date, 'src': src, 'file_ver': fver}

    ver_by = {}
    for name, it in items.items():
        ver_by[it['ver']] = ver_by.get(it['ver'], 0) + 1
    latest = max((it['date'] for it in items.values() if it['date']), default=None)

    payload = {
        'generated': None,
        'stats': {
            'total': len(items),
            'with_ver': sum(1 for it in items.values() if it['ver']),
            'with_date': sum(1 for it in items.values() if it['date']),
            'latest_date': latest,
            'by_version': dict(sorted(ver_by.items(), key=lambda kv: vkey(kv[0]))),
        },
        'items': items,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    print('规格书版本元数据: %d 份 → %s' % (len(items), OUT))
    print('  有版本号 %d / 有日期 %d / 最新发布日期 %s'
          % (payload['stats']['with_ver'], payload['stats']['with_date'], latest))
    print('  版本分布: %s' % payload['stats']['by_version'])
    if mismatch:
        print('  ⚠️ 文件名版本与 PDF 内版本不一致 %d 份:' % len(mismatch))
        for row in mismatch:
            print('     %s  文件名 V%s ≠ 正文 Rev.%s (%s, %s)' % row)
    if missing:
        print('  ⚠️ 未能从 PDF 提取 %d 份（版本回退用文件名，日期为空）:' % len(missing))
        for row in missing:
            print('     %s (文件名 V%s)' % row)
    return 0


if __name__ == '__main__':
    sys.exit(main())
