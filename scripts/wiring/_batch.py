# 全量批量生成 670 款应用电路 SVG
# - 引脚抽取按 datasheet(source_label) 去重缓存
# - 任何一步失败(无PDF/抽不到引脚/分侧失败/生成异常)只记录不硬画
# - 输出: SVG 到本目录; 汇总打印到 stdout
import json, os, re, sys, time
from collections import Counter
sys.path.insert(0, '/Users/hu/fae-knowledge-web/scripts/wiring')
from _gen import extract_pins, func_type, gen, DS, OUT

d = json.load(open('/Users/hu/fae-knowledge-web/data/products.json'))
prods = d if isinstance(d, list) else d.get('products', [])
cache, ok, fails = {}, [], []
by_kind = {}
t0 = time.time()
for i, p in enumerate(prods):
    m = p.get('model') or ''
    sl = p.get('source_label')
    if not m:
        fails.append(('(缺model)', '目录条目无型号')); continue
    if not sl:
        fails.append((m, '缺source_label')); continue
    if sl not in cache:
        path = f'{DS}/{sl}'
        try:
            cache[sl] = extract_pins(path) if os.path.exists(path) else None
        except Exception:
            cache[sl] = None
    pins = cache[sl]
    if not pins:
        fails.append((m, f'引脚抽取为空|{sl}')); continue
    fd = p.get('function_detail') or ''
    kind = func_type(fd)
    try:
        volt = p.get('voltage') or '见 datasheet'
        svg, err = gen(m, p.get('package', ''), pins, kind,
                       p.get('function', '') or fd, volt, fd)
    except Exception as e:
        svg, err = None, f'生成异常 {type(e).__name__}: {e}'
    if err:
        fails.append((m, f'{err}|{fd}')); continue
    fn = re.sub(r'[^A-Za-z0-9\-]', '_', m) + '_wiring.svg'   # 保留连字符(型号 -Q100 后缀)

    open(os.path.join(OUT, fn), 'w').write(svg)
    ok.append((m, kind, len(pins), fn))
    by_kind[kind] = by_kind.get(kind, 0) + 1
    if (i + 1) % 100 == 0:
        print(f'... {i+1}/{len(prods)}', flush=True)

print(f'生成完成: 成功 {len(ok)}, 失败 {len(fails)}, 用时 {time.time()-t0:.0f}s')
print(f'按模板: {dict(sorted(by_kind.items()))}')
print(f'唯一datasheet {len(cache)} 份, 其中抽取为空 {sum(1 for v in cache.values() if not v)} 份')
rc = Counter()
for _, r in fails:
    key = r.split('|')[0].split(':')[0][:40]
    rc[key] += 1
print('失败原因分布:', dict(rc.most_common()))
print('--- 失败清单 (型号\t原因) ---')
for m, r in fails:
    print(f'{m}\t{r}')
# 每模板取1款作为抽检样本
seen = set()
print('--- 抽检样本 ---')
for m, k, n, fn in ok:
    if k not in seen:
        seen.add(k); print(f'{k}\t{m}\t{n}脚\t{fn}')
    if len(seen) == len(by_kind): break
