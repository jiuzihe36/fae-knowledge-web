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
本地 ~/wiki 知识库（197 实体页 + 197 raw JSON），单向导出，未反向污染知识库。
EXS 数据来自实体页 exs0102/0104/0106/0108 的电气特性全集（Round8 重构后的权威数据）。
