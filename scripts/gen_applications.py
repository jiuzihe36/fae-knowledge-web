#!/usr/bin/env python3
"""应用场景按「功能 × 电气特性」划分（B 方案 v2）

背景：旧数据按「功能」整批套 4 个场景名 → 「信号缓冲增强驱动 / 时钟分配 /
长走线信号中继 / 接口隔离驱动」点开是完全相同的 129 款，名不副实。

v1 教训：写「宽判据」（如 三态 → 总线隔离 + 时钟分配 都收）仍会产生
完全相同的场景集合 —— 判据宽窄不是关键，**集合是否唯一**才是。

v2 做法：**划分（partition）**—— 每个型号按 (功能, 电气特性) 归入**恰好一个**场景。
数学上保证任意两个场景的型号集合不相同（划分的块两两不相交）。

特性优先级（一个型号可能同时有多标签，取第一个命中的）：
  三态输出 > 开漏输出 > 施密特输入 > TTL输入 > 通用

工程语义（判据来自 products.json 的 function_detail 真实标签，非臆造）：
  三态输出   → 有使能脚可切高阻 → 总线隔离 / 多路驱动 / 共享总线
  开漏输出   → 需外部上拉、可线与 → I2C / 中断线 / LED 驱动 / 电平转换
  施密特输入 → 有迟滞抗慢边沿     → 按键去抖 / 振荡器 / 噪声环境
  TTL输入    → 与 5V TTL 兼容    → 5V 系统接口
  通用       → 普通型            → 通用逻辑 / 信号缓冲

用法：python3 scripts/gen_applications.py            # 预览
      python3 scripts/gen_applications.py --write    # 写入 products.json
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

W = Path('/Users/hu/fae-knowledge-web/data')
PROD_FILE = W / 'products.json'

FEAT_ORDER = ['三态输出', '开漏输出', '施密特输入', 'TTL输入']


def feat_of(p):
    fd = p.get('function_detail') or ''
    m = re.search(r'[（(]([^）)]*)[）)]', fd)
    s = set()
    if m:
        for t in re.split(r'[、,]', m.group(1)):
            t = t.strip()
            if t and t != '输入':
                s.add(t)
    return s


def primary_feat(p):
    """主特性（按优先级取第一个命中的）"""
    fs = feat_of(p)
    for f in FEAT_ORDER:
        if f in fs:
            return f
    return '通用'


# ---------- 场景名映射：(功能, 主特性) → 场景名 ----------
# 未列出的组合走 DEFAULT_SCENE[功能]。
SCENE = {
    # 缓冲器
    ('同相缓冲器', '三态输出'):   '总线隔离（三态使能）',
    ('同相缓冲器', '开漏输出'):   '开漏输出与电平转换',
    ('同相缓冲器', '施密特输入'): '噪声环境信号缓冲',
    ('同相缓冲器', 'TTL输入'):    '5V TTL 系统缓冲',
    ('同相缓冲器', '通用'):      '信号缓冲与长走线驱动',

    # 反相器
    ('反相器', '三态输出'):      '三态反相与总线驱动',
    ('反相器', '开漏输出'):      '开漏输出与电平转换',
    ('反相器', '施密特输入'):    '按键去抖与振荡器',
    ('反相器', 'TTL输入'):       '5V TTL 电平兼容',
    ('反相器', '通用'):         '信号反相',

    # 施密特专用器件
    ('施密特反相器', '施密特输入'): '按键去抖与振荡器',
    ('施密特反相器', '通用'):     '按键去抖与振荡器',
    ('施密特缓冲器', '三态输出'):  '施密特输入（抗噪声）',
    ('施密特缓冲器', '施密特输入'): '施密特输入（抗噪声）',
    ('施密特缓冲器', '通用'):     '施密特输入（抗噪声）',

    # 门电路（与/或/与非/或非 共用一套）
    ('与门',   '施密特输入'): '慢边沿/噪声环境整形',
    ('与门',   'TTL输入'):   '5V TTL 电平兼容',
    ('与门',   '开漏输出'):  '开漏线与逻辑',
    ('与门',   '通用'):     '通用逻辑门组合',
    ('或门',   '施密特输入'): '慢边沿/噪声环境整形',
    ('或门',   'TTL输入'):   '5V TTL 电平兼容',
    ('或门',   '开漏输出'):  '开漏线与逻辑',
    ('或门',   '通用'):     '通用逻辑门组合',
    ('与非门', '施密特输入'): '慢边沿/噪声环境整形',
    ('与非门', 'TTL输入'):   '5V TTL 电平兼容',
    ('与非门', '开漏输出'):  '开漏线与逻辑',
    ('与非门', '通用'):     '通用逻辑门组合',
    ('或非门', '施密特输入'): '慢边沿/噪声环境整形',
    ('或非门', 'TTL输入'):   '5V TTL 电平兼容',
    ('或非门', '开漏输出'):  '开漏线与逻辑',
    ('或非门', '通用'):     '通用逻辑门组合',

    # 异或族
    ('异或门',  '施密特输入'): '数据比较/校验',
    ('异或门',  'TTL输入'):   '5V TTL 电平兼容',
    ('异或门',  '开漏输出'):  '数据比较/校验',
    ('异或门',  '通用'):     '数据比较/校验',
    ('异或非门', '施密特输入'): '数据比较/校验',
    ('异或非门', 'TTL输入'):   '5V TTL 电平兼容',
    ('异或非门', '开漏输出'):  '数据比较/校验',
    ('异或非门', '通用'):     '数据比较/校验',

    # 开漏反相器（本身即开漏型）
    ('开漏反相器', '开漏输出'): 'I2C 总线与中断驱动',
    ('开漏反相器', '通用'):    'I2C 总线与中断驱动',

    # 时序/存储
    ('移位寄存器', '三态输出'): 'LED/数码管驱动',
    ('移位寄存器', 'TTL输入'):  '5V TTL 电平兼容',
    ('移位寄存器', '通用'):    '串并转换/I/O 扩展',
    ('触发器',    '三态输出'): '数据锁存与状态保持',
    ('触发器',    'TTL输入'):  '5V TTL 电平兼容',
    ('触发器',    '通用'):    '数据锁存与状态保持',
    ('锁存器',    '三态输出'): '数据锁存与状态保持',
    ('锁存器',    'TTL输入'):  '5V TTL 电平兼容',
    ('锁存器',    '通用'):    '数据锁存与状态保持',

    # 开关/复用
    ('多路复用器', '通用'): '信号通道选择',
    ('多路复用器', 'SPST'): '信号通道选择',

    # 其他
    ('多功能可配置门', '通用'): '可配置逻辑（替代多颗门）',
    ('电平转换收发器', '通用'): 'I2C/SPI/UART 电平转换',
    ('收发器',      '三态输出'): '总线双向收发',
    ('收发器',      '通用'):    '总线双向收发',
    ('译码器',      'TTL输入'):  '5V TTL 电平兼容',
    ('译码器',      '通用'):    '地址译码与片选',
}

DEFAULT_SCENE = {
    '模拟开关': '音频/视频信号切换',
}

# 模拟开关内部再分：EMS 系列走高速/音频专用场景
EMS_SWITCH_SCENE = {
    'EMS3': 'USB/高速信号切换',      # EMS31xx/35xx 高速开关
    'EMS4': 'USB/高速信号切换',      # EMS4xxx 高速/音频开关
    'EL':   '音频/视频信号切换',      # EL3157 等
    'EM74CBTLV': '总线开关与隔离',
}


def scene_of(p):
    fn = p.get('function') or ''
    pf = primary_feat(p)

    # 模拟开关/多路复用器：按 function_detail 的真实用途分（不用系列粗判）
    if fn in ('模拟开关', '多路复用器'):
        fd = p.get('function_detail') or ''
        # 总线开关（CBT/CBTLV 系列，用于总线隔离与热插拔）
        if '总线开关' in fd or (p.get('series') or '').startswith('74CBT'):
            return '多路信号选择'
        # 音频相关（音频开关/耳机/Type-C 音频/HiFi 音频）
        if any(k in fd for k in ('音频', '耳机', 'HiFi', 'Type-C')):
            return '音频/模拟信号切换'
        # USB 相关
        if 'USB' in fd:
            return 'USB 信号切换'
        # 差分/多路复用
        if '多路复用' in fd or 'Mux' in fd or 'DeMux' in fd:
            return '多路信号选择'
        # 其余通用模拟开关
        return '音频/模拟信号切换'

    if (fn, pf) in SCENE:
        return SCENE[(fn, pf)]
    if fn in DEFAULT_SCENE:
        return DEFAULT_SCENE[fn]
    return None


def main():
    write = '--write' in sys.argv
    prod = json.load(open(PROD_FILE, encoding='utf-8'))

    scenes = defaultdict(list)
    unmatched = []
    for p in prod:
        s = scene_of(p)
        if s:
            scenes[s].append(p)
        else:
            unmatched.append(p)

    print(f"场景数: {len(scenes)}（原 73）")
    print(f"有场景归属: {len(prod) - len(unmatched)} / {len(prod)} 款")
    print()
    print("=== 各场景型号数 ===")
    for name, ps in sorted(scenes.items(), key=lambda kv: -len(kv[1])):
        fns = sorted(set(x.get('function') or '?' for x in ps))
        feats = sorted(set(primary_feat(x) for x in ps))
        print(f"  {name:<26} {len(ps):>4} 款  {','.join(fns[:3]):<20} [{','.join(feats)}]")

    print()
    print(f"=== 无场景归属: {len(unmatched)} 款 ===")
    for k, n in Counter(x.get('function') for x in unmatched).most_common():
        print(f"  {k:<18} {n:>4} 款")

    # ---------- 验收：不允许任何两个场景型号集合相同 ----------
    print()
    print("=== 验收：场景两两不得完全相同 ===")
    sig = defaultdict(list)
    for name, ps in scenes.items():
        sig[tuple(sorted(x['model'] for x in ps))].append(name)
    dups = {k: v for k, v in sig.items() if len(v) > 1}
    if dups:
        print(f"  ❌ {len(dups)} 组完全相同:")
        for k, names in dups.items():
            print(f"     {len(k)} 款 → {names}")
    else:
        print("  ✅ 无任何两个场景型号集合相同")

    # 重叠检查（划分下应只在模拟开关再分处有重叠）
    names = list(scenes.keys())
    high = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a = set(x['model'] for x in scenes[names[i]])
            b = set(x['model'] for x in scenes[names[j]])
            if not a or not b:
                continue
            ov = len(a & b) / min(len(a), len(b))
            if ov > 0.9:
                high.append((names[i], names[j], ov))
    if high:
        print(f"  ⚠️ 高重叠对（>90%）: {len(high)}")
        for a, b, ov in high[:10]:
            print(f"     {a} ↔ {b}: {ov:.0%}")

    if not write:
        print()
        print("（预览模式，加 --write 写入）")
        return

    for p in prod:
        s = scene_of(p)
        p['applications'] = s or ''
        p['applications_domains'] = [s] if s else []
    PROD_FILE.write_text(json.dumps(prod, ensure_ascii=False, indent=1), encoding='utf-8')
    print()
    print(f"✅ 已写入 products.json（{len(prod)} 款）")


if __name__ == '__main__':
    main()
