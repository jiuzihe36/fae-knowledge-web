# 网页数据更新说明 (2026-10-12 · 应用电路图栏目整体删除)

### 删除内容（按需求：应用电路图太丑，全部下线）
| 位置 | 处理 |
|------|------|
| 顶部导航 | 移除「应用电路图」标签（现为 产品 / 应用 / 技术文档 / 封装与可靠性 四个） |
| 独立页 | 删除 `gallery.html` + `gallery.js`（原 `/gallery` 入口） |
| 详情抽屉 | 移除「应用电路图」区块（抽屉现只剩 引脚图 + 电气参数） |
| 图片文件 | 删除 `app_schematics/` 652 张 SVG（27MB），部署体积相应减少 |
| 发布清单 | `scripts/deploy.sh` 不再 rsync `app_schematics/`，不再拷贝 gallery 两文件 |
| 老链接 | 新增 `_redirects`：`/gallery`、`/gallery.html` → 301 回首页，避免书签 404 |
| 缓存头 | `/*.svg` 由 600s 恢复 604800s（SVG 只剩 favicon，不再持续精修） |
| 其他 | 清理 `.gal*` / `#appSchematicImg` / `.app-schematic-note` 样式、`safeCircuitName()`、抽屉无用 `el` 引用；meta 描述与关键词去掉「应用电路图」 |

版本号 bump 至 `?v=20261012b`。本地实测：导航 4 标签互切正常、抽屉引脚图与灯箱放大正常、全站 0 个失败请求（不再请求 `app_schematics/`）、各宽度无横向溢出。
删除文件全部留在 git 历史（`git revert` / `git checkout HEAD~1 -- app_schematics` 可找回）。

---

# 网页数据更新说明 (2026-10-12 · 规格书最新版本号 + 版本发布日期全站上线)

### 1. 新增：每份规格书的最新版本号与该版本发布日期
| 位置 | 展示内容 |
|------|----------|
| 产品详情抽屉 | 新增「规格书版本」（如 V1.8）与「版本更新日期」（如 2026-07-10）两栏，紧接「规格书 查看/下载」 |
| 技术文档列表 | 新增「规格书版本」「更新日期」两列，表头可点击排序（版本按数值比较，V1.10 > V1.9），搜索框支持按版本/日期过滤 |

数据来源：逐份解析 `datasheets/*.pdf` 末页「Revision History」修订记录表（Document ID / Release Date），
与页眉「Rev. x.y – Mon DD, YYYY」交叉校验。**197 份规格书 100% 提取到版本号与日期，文件名版本与正文版本 0 处不一致。**

### 2. 新增脚本与数据
- `scripts/extract_ds_meta.py` → `data/ds_meta.json`（197 份：ver / date / src / file_ver）
- `scripts/gen_pages.py` 注入：`products.json` 加 `ds_ver`/`ds_date`（652 款）、`docs.json` 加 `dv`/`dd`（652 款）+ stats（ds_files 197 / ds_latest）
- `update.sh` 新增 Step 1.2（提取规格书版本）+ Step 1.3（重建栏目页数据），换新规格书 PDF 后自动跟随

### 3. 版式
「技术文档」表由 8 列增至 10 列；新增 ≤980px 断点（隐藏系列/工作电压/工艺三列并同步收敛栅格），
实测 1440 / 1009 / 980 / 820 / 700 / 600 px 无横向溢出、无截断（改动前 820px 即无截断，未倒退）；
≤560px 仍为 4 列移动版式。样式与脚本版本号 bump 至 `?v=20261012a`。

---

# 网页数据更新说明 (2026-09-24 · Q100 车规型号补回 + specs html 全量规范)

### 1. 补回 Q100 车规型号（2 条，9-21 清洗时被误删的真实订购码）
| 型号 | 封装 | 温度 | 规格书 |
|------|------|------|--------|
| EMS3157GW-Q100 | SOT363 | -40~+125 ℃ | EMS3157-Q100_Draft_DS_V0.92.pdf |
| EMS23157MS-Q100 | MSOP-10L | -40~+125 ℃ | EMS23157-Q100_Drft_DS_V0.9.pdf |

specs 取自 wiki 实体页电气特性全集（四块结构，含 kind 分类），车规温度覆盖 AEC-Q100 Grade 1。

### 2. 修复 sync_from_wiki.py 裸占位回潮缺陷
原脚本每次同步会把 244 条裸基础名（EM74HC00、EMS3157 等）重新加回——这些正是 9-21
按「真实订购码后缀」清洗掉的占位。已加 covered() 跳过规则（已有带封装后缀变体即跳过，
含 -Q100 等分级后缀），复跑验证 新增 0。

### 3. specs 下标 html 全量规范化
重跑 subscript_format.py：param_html 粘连修复 6164 处（如 `voltageIO =` → `voltage IO =`）、
conditions_html 补下标 95 处；抽样 0 处回退。

### 4. 数据规模
668 → **670 条**（+2 Q100）。README 中过时的 920 口径已更正为 670。

### 5. 停用 update.sh 的应用域注入步骤
inject_applications.py 会把 40 条中文精编 applications/domains 覆盖为含 ◼ PUA 与
题头噪音（Rev.x/页码/型号行）的 PDF 原文，与全库 630 条中文口径冲突。本次先恢复
这 40 条精编字段，再在 update.sh 中注释停用该步（脚本保留，清洗数据源后可恢复）。
部署后验证：junk 0 条，线上与 GitHub 存档一致（670 条，sha 一致）。

---

# 网页数据更新说明 (2026-09-18)

## 更新内容

### 1. 新增 EXS 电平转换器全族（12 条记录，原缺失）
| 型号 | 封装 | 引脚图 |
|------|------|--------|
| EXS0102 / EXS0102DC / EXS0102DCN | VSSOP-8 / SOT23-8 | pins/202.png |
| EXS0104 / EXS0104D / EXS0104PW / EXS0104RGY / EXS0104RSA | SOP-14 / TSSOP-14 / QFN-14 / QFN-12 | pins/73.png |
| EXS0106 / EXS0106PW | TSSOP-16 | pins/203.png |
| EXS0108 / EXS0108PW / EXS0108UD | TSSOP-20 / QFN-20 | pins/204.png |

### 2. 修正数据错误
- `XS0104`（假型号）→ `EXS0104`，series `XS` → `EXS`，恢复正确功能分类「收发器」
- 系列 `XS` 残留清零

### 3. 数据规模
- 908 条 → **920 条**（+12 新增）
- 全部字段完整、id 唯一、pin 图引用完整

## 推送方式
将本目录 `data/products.json` 与新增 `pins/202.png, 203.png, 204.png` 推送到
`jiuzihe36/fae-knowledge-web` 仓库 main 分支即可生效。

## 数据来源
本地 ~/项目/资料/wiki 知识库（197 实体页 + 197 raw JSON），单向导出，未反向污染知识库。
EXS 数据来自实体页 exs0102/0104/0106/0108 的电气特性全集（Round8 重构后的权威数据）。
