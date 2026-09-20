# 芯祥 FAE 型号速查（网页版）

> **芯祥(EM)半导体现场应用工程师(FAE)专属知识库的静态发布版**
> 一个可搜索、可筛选、带引脚图的芯片型号速查站点。

[![pages](https://img.shields.io/badge/Cloudflare%20Pages-在线-F38020)](https://logic-qbu.pages.dev)
[![数据](https://img.shields.io/badge/型号-920%20条-2ea44f)]()

---

## 🌐 访问

| 入口 | 网址 | 说明 |
|------|------|------|
| **正式发布站** | https://logic-qbu.pages.dev | 全球 CDN，国内访问流畅 |
| **GitHub 存档** | 本仓库 | 只读存档 / 版本历史 |

---

## 📦 这是什么

芯祥(EM)半导体产品（74 系列逻辑芯片 + EMS 模拟开关 + EXS 电平转换器）的**型号速查工具**。本地维护人员从 201 份 PDF 规格书提炼出结构化知识库，本仓库将其发布为**零依赖静态网页**，供现场 FAE 快速下拉式过滤：

- 🔍 **搜索**：按型号 / 功能 / 封装 / 参数任意关键词
- 🎛️ **筛选**：按系列（EM74 / EMS / EXS）、功能、封装、电压
- 📌 **引脚图**：每个型号配真实规格书引脚图，悬停/点击放大
- 📊 **电气参数**：VCC 范围、逻辑类型、温度范围、封装尺寸

**数据规模**：920 条型号记录 · 204 张引脚图 · 13 个产品系列。

---

## 🔄 数据从哪来 & 一次更新怎么做

数据**单向来自本地知识库**（权威源），本仓库只是发布产物，**绝不反向污染本地 wiki**。

维护人员在本机执行一条命令即可完成全端发布：

```bash
~/fae-knowledge-web/update.sh
```

自动完成四步：
1. 📦 **同步**：从本地 wiki 重建 `data/products.json`
2. 📤 **存档**：commit + push 到 GitHub（本仓库）
3. 🚀 **发布**：wrangler 部署到 Cloudflare Pages
4. 📋 **对账**：输出 commit + 发布网址

> 💡 更新方向**严格单向**：本地 wiki（权威）→ 本仓库 + Cloudflare Pages。网页端任何数据都不会写回本地 wiki。

---

## 🗂 目录结构

```
├── index.html          # 页面骨架
├── app.js              # 搜索/筛选/引脚弹窗逻辑
├── style.css           # 样式
├── data/
│   └── products.json   # 920 条型号数据（自动生成）
├── pins/               # 204 张引脚图
├── scripts/
│   ├── sync_from_wiki.py   # wiki → products.json 同步
│   └── deploy.sh           # Cloudflare Pages 部署
└── update.sh           # 一键全端更新（推荐入口）
```

---

## 🛠 本地开发

```bash
# 克隆
git clone https://github.com/jiuzihe36/fae-knowledge-web.git
cd fae-knowledge-web

# 本地预览
python3 -m http.server 8000
# 打开 http://localhost:8000
```

---

## 📄 型号命名速记

| 前缀 | 系列 | 说明 |
|------|------|------|
| `EM74...` | 逻辑芯片 | 74 系列标准逻辑（AHC/AHCT/LVC/HC/HCT/AUP 等） |
| `EMS...`  | 模拟开关 | 模拟开关/多路复用器 |
| `EXS...`  | 电平转换器 | 双电源电平转换/收发器 |

---

## 🔒 数据完整性

- 920 条记录，id 全唯一、无重复
- 全部型号有电气参数、封装、引脚图
- 引脚图引用可访问性逐张校验通过
- 验证脚本：`scripts/verify_product.py`（数据 + 引用 + 唯一性三盲 API 级验收）

---

*芯祥 FAE 知识库 · 由本地 wiki 单向驱动 · Cloudflare Pages 全球发布*
