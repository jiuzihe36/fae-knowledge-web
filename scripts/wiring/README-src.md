# 芯祥 FAE Logic — 电气部署包

所有电气类目录统一放这里，**整个文件夹可直接上传服务器**。

## 目录结构

| 目录 | 内容 | 体积 |
|---|---|---|
| `datasheets/` | 197 份芯祥官方 datasheet PDF | 183M |
| `pins/` | 204 张官方引脚分布图 PNG | 22M |
| `circuits/` | 芯祥原厂接线图 SVG（9 张） | 68K |
| `data/` | products.json / p2p.json / specs_reextracted.json | 5.8M |
| `应用电路SVG/` | 按 wiring-diagram 规范批量生成的应用电路图 + 生成器 `_gen.py` | 40K |

## 部署

```bash
rsync -avz --exclude='_gen.py' --exclude='__pycache__' \
  "~/芯祥fae logic/" user@server:/var/www/fae-logic/
```

## 数据源关系

- `datasheets/`、`pins/`、`circuits/`、`data/` 的权威源在 `~/fae-knowledge-web`（git 仓库，网页站用）；
  本部署包是**副本**，更新先改仓库源，再重新拷贝。
- `应用电路SVG/` 由 `_gen.py` 生成（用 `/tmp/p4/venv` 跑，依赖 pymupdf），真实引脚从 datasheet 抽取。
- 网页站：https://logic-qbu.pages.dev
