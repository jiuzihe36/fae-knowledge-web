# 封装接线图交付物 v1.0 (2026-09-23)

## 已交付(真、可查)
1. **数据层 —— /tmp/pins_plan.json** (356 记录)
   - 356/356 模型全量 pin 表(194 直提 + 162 家族借用链), 每条含真 return 表
   - 封装分布: SOP-14 104 / SOT23 68 / TSSOP-14 68 / SOP-20 64 / SOT353 58 …
   - pin数: 5脚133 / 6脚64 / 14脚80 …

2. **模板图 —— circuits/{EMS3157,EM74HC14}_wiring.svg**
   - EMS3157 = SPDT 模拟开关模板(SOT23-6)
   - EM74HC14 = 施密特反相振荡器模板(SOP-14)
   - 两张均过 verify_wiring.py 全项 + vision 终审

3. **渲染通道** —— qlmanage SVG→PNG 双通, 已产出 PNG 交付于 /tmp

## 未交付(诚实)
- 356 批量 SVG 生成器(gen_wiring_batch.py 已残废, 语法坏/引用未定义名, 跪在 import; 不假装成功)
- 后续: 重写干净生成器 → 全量356 → vision抽查 → 双端推送

## 硬约定(固化入 wiring-diagram 技能)
① 控制/输入左、输出右 ② 走线不穿封装盒 ③ 交叉不相连画凸起跳线
④ 上VCC轨下GND轨 ⑤ 图下无小文字 ⑥ 行栅格对齐 ⑦ pin1圆点+脚号 ⑧ 元件断端子
