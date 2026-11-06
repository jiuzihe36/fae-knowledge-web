#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 wiki 的 14 篇应用指南渲染成站点静态页 + 索引 JSON

产物：
  site/guides/<slug>.html   —— 套站点样式的指南页
  data/guides.json          —— 应用页用：标题 / 摘要 / 覆盖场景 / 链接

用法: python3 scripts/build_guides.py
"""
import json, re
from pathlib import Path

import markdown

SITE = Path(__file__).resolve().parent.parent
WIKI = Path.home() / "项目" / "资料" / "wiki" / "applications"
OUT = SITE / "guides"

# 指南文件 → 覆盖的站点场景（用于应用页挂链接）
SCENES = {
    "level-translation-app-guide": ["I2C/SPI/UART 电平转换", "5V TTL 电平兼容"],
    "logic-gates-app-guide": ["通用逻辑门组合", "信号反相", "数据比较/校验", "可配置逻辑（替代多颗门）"],
    "schmitt-trigger-app-guide": ["慢边沿/噪声环境整形", "施密特输入（抗噪声）"],
    "usb-hdmi-switching-app-guide": ["USB/HDMI 高速信号切换"],
    "shift-register-io-guide": ["串并转换/I/O 扩展", "LED/数码管驱动"],
    "ems-analog-switch-app-guide": ["通用模拟开关/多路复用"],
    "audio-switch-app-guide": ["音频信号切换"],
    "automotive-q100-guide": ["车规应用（AEC-Q100）"],
    "bus-isolation-guide": ["总线开关与隔离", "总线隔离（三态使能）"],
    "debounce-oscillator-guide": ["按键去抖与振荡器"],
    "bus-driver-guide": ["信号缓冲与长走线驱动", "三态反相与总线驱动", "总线双向收发"],
    "open-drain-i2c-guide": ["开漏输出与电平转换", "开漏线与逻辑", "I2C 总线与中断驱动"],
    "latch-decoder-guide": ["数据锁存与状态保持", "地址译码与片选"],
    "ttl-compat-fixed-direction-guide": ["5V TTL 电平兼容", "单向电平转换（DIR 型）"],
}

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · 芯祥应用指南</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="../style.css">
<style>
  .guide-wrap {{ max-width: 980px; margin: 0 auto; padding: 0 20px 64px; }}
  .guide-nav {{ position: sticky; top: 0; z-index: 10; padding: 12px 0; margin-bottom: 8px;
    background: var(--bg, #fff); border-bottom: 1px solid var(--border, #e3e6e9); font-size: 13px; }}
  .guide-nav a {{ color: inherit; text-decoration: none; opacity: .75; }}
  .guide-nav a:hover {{ opacity: 1; text-decoration: underline; }}
  .guide-body {{ font-size: 14.5px; line-height: 1.75; }}
  .guide-body h1 {{ font-size: 24px; margin: 24px 0 8px; }}
  .guide-body h2 {{ font-size: 18px; margin: 28px 0 10px; padding-top: 8px; border-top: 1px solid var(--border, #eee); }}
  .guide-body h3 {{ font-size: 15.5px; margin: 20px 0 8px; }}
  .guide-body table {{ border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; display: block; overflow-x: auto; }}
  @media (max-width: 720px) {{
    .guide-body table {{ min-width: 620px; }}
    .guide-body th, .guide-body td {{ white-space: nowrap; }}
  }}
  .guide-body th, .guide-body td {{ border: 1px solid var(--border, #e3e6e9); padding: 7px 10px; text-align: left; vertical-align: top; }}
  .guide-body th {{ background: rgba(0,0,0,.03); }}
  .guide-body code {{ background: rgba(0,0,0,.05); padding: 1px 5px; border-radius: 4px; font-size: .92em; }}
  .guide-body pre {{ background: rgba(0,0,0,.04); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }}
  .guide-body blockquote {{ margin: 12px 0; padding: 8px 14px; border-left: 3px solid var(--accent, #888); background: rgba(0,0,0,.025); }}
  .guide-body ul, .guide-body ol {{ padding-left: 22px; }}
  :root[data-theme="dark"] .guide-body th, :root:not([data-theme="light"]) .guide-body th {{ background: rgba(255,255,255,.06); }}
  :root[data-theme="dark"] .guide-body code, :root:not([data-theme="light"]) .guide-body code,
  :root[data-theme="dark"] .guide-body pre, :root:not([data-theme="light"]) .guide-body pre {{ background: rgba(255,255,255,.07); }}
</style>
</head>
<body>
<div class="guide-wrap">
  <nav class="guide-nav"><a href="../index.html">← 返回产品目录</a> · <a href="../index.html#page=apps">应用场景</a></nav>
  <article class="guide-body">
{html}
  </article>
</div>
</body>
</html>
"""

def frontmatter(t):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", t, re.S)
    if not m:
        return {}, t
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, t[m.end():]

def first_para(body):
    for line in body.split("\n"):
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("|") and not s.startswith(">"):
            s = re.sub(r"[*_`\[\]]", "", s)
            return s[:110]
    return ""

OUT.mkdir(exist_ok=True)
md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"])
items = []
for f in sorted(WIKI.glob("*.md")):
    slug = f.stem
    raw = f.read_text(encoding="utf-8")
    fm, body = frontmatter(raw)
    title = fm.get("title") or slug
    title = re.sub(r"^#+\s*", "", title)
    desc = first_para(body)
    md.reset()
    html = md.convert(body)
    (OUT / f"{slug}.html").write_text(
        PAGE.format(title=title, desc=desc.replace('"', "&quot;"), html=html), encoding="utf-8")
    items.append({
        "slug": slug, "title": title, "desc": desc,
        "scenes": SCENES.get(slug, []),
        "url": f"./guides/{slug}.html",
        "words": len(re.findall(r"[\u4e00-\u9fa5]", body)),
    })

json.dump({"generated": "2026-11-06", "total": len(items), "items": items},
          open(SITE / "data" / "guides.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

covered = set()
for it in items:
    covered.update(it["scenes"])
print(f"guides: {len(items)} 篇 → guides/ + data/guides.json")
print(f"覆盖场景 {len(covered)} 个")
for it in items:
    print(f"  {it['title'][:34]:36} {len(it['scenes'])} 场景 · {it['words']} 字")
