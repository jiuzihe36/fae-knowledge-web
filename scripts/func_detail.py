#!/usr/bin/env python3
"""从PDF封面标题生成function_detail（四路2输入与非门/八路缓冲三态等）。
用法: python3 scripts/func_detail.py
"""
import json, re

NUM = {'single': '单路', 'dual': '双路', 'triple': '三路', 'quad': '四路',
       'hex': '六路', 'octal': '八路', '1': '单', '2': '双', '4': '四', '8': '八'}

def parse(title):
    t = title.strip()
    if not t:
        return ''
    # 位宽：2-input/3-input/4-input
    mw = re.search(r'(\d+)-input', t, re.I)
    width = mw.group(1) + '输入' if mw else ''
    # 路数
    roads = ''
    for k, v in NUM.items():
        if re.match(r'^' + k + r'\b', t, re.I):
            roads = v
            break
    # 三态/开漏/施密特
    feats = []
    if re.search(r'3-state', t, re.I):
        feats.append('三态输出')
    if re.search(r'open-drain', t, re.I):
        feats.append('开漏输出')
    if re.search(r'schmitt', t, re.I):
        feats.append('施密特输入')
    # 核心功能中译
    core = ''
    tl = t.lower()
    if 'analog switch' in tl or 'spdt' in tl or 'spst' in tl or 'dpdt' in tl:
        # 模拟开关：提路数（Single/DUAL/Quad）
        for k, v in NUM.items():
            if re.match(r'^' + k + r'\b', t, re.I):
                roads = v
                break
        if re.match(r'^dual\b', t, re.I):
            roads = '双路'
        core = '模拟开关'
        out = roads + core
        if feats:
            out += '（' + '、'.join(feats) + '）'
        return out or t[:60]
    if 'shift register' in tl:
        core = '移位寄存器'
    elif 'flip-flop' in tl:
        core = '触发器'
    elif 'transceiver' in tl:
        core = '收发器'
    elif 'multiplexer' in tl or 'mux' in tl:
        core = '多路复用器'
    elif 'decoder' in tl:
        core = '译码器'
    elif 'nand' in tl:
        core = '与非门'
    elif 'nor' in tl:
        core = '或非门'
    elif 'xor' in tl:
        core = '异或门' if 'xnor' not in tl else '异或非门'
    elif re.search(r'\band\b', tl):
        core = '与门'
    elif re.search(r'\bor\b', tl):
        core = '或门'
    elif 'inverter' in tl or 'inverting buffer' in tl:
        core = '反相器'
    elif 'buffer' in tl or 'line driver' in tl:
        core = '缓冲器'
    elif 'latch' in tl:
        core = '锁存器'
    elif 'analog switch' in tl:
        core = '模拟开关'
    elif 'translator' in tl or 'translat' in tl:
        core = '电平转换器'
    elif 'bus switch' in tl or 'bus-switch' in tl:
        core = '总线开关'
    elif 'gate' in tl:
        core = '逻辑门'
    # 核心词表没命中时禁止吐"路数孤字"（如 4-bit bus switch → "四"），
    # 回退整条标题，宁可英文也不要残缺中文（2026-09-23）
    if not core:
        return t[:60]
    out = roads + width + core
    if feats:
        out += '（' + '、'.join(feats) + '）'
    return out or t[:60]

def main():
    titles = json.load(open('/tmp/cover_titles.json', encoding='utf-8'))
    pdf_desc = {}
    for pdf, t in titles.items():
        m = re.match(r'^(.+?)(?:_Product|_Draft|_Drft)', pdf)
        stem = m.group(1) if m else pdf
        desc = t.split('||')[1].strip() if '||' in t else ''
        pdf_desc[stem] = desc
    p = '/Users/hu/fae-knowledge-web/data/products.json'
    d = json.load(open(p, encoding='utf-8'))
    SUFFIX = re.compile(r'(GV|GW|GX|GS|GM|DRL|PW|RGY|RSA|UD|MS|RSW|DRC|DRB|YFC|YFQ|YFG|MSV|RSV|N|Q|D)$')
    def base(m):
        return SUFFIX.sub('', m or '')
    def numcore(s):
        m = re.search(r'(\d+G\d+|\d{2,4}[A-Z]*)$', s)
        return m.group(1) if m else s
    n = 0
    ex = []
    for x in d:
        nc = numcore(base(x['model']))
        best = None
        for stem, desc in pdf_desc.items():
            if nc in stem and desc:
                best = desc
                break
        if best:
            fd = parse(best)
            if fd:
                x['function_detail'] = fd
                n += 1
                if len(ex) < 8:
                    ex.append((x['model'], fd))
    print('function_detail:', n, flush=True)
    for m, f in ex:
        print('  ' + m + ': ' + f, flush=True)
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
