#!/usr/bin/env python3
"""用PDF封面标题纠错function字段。只写data/products.json。
规则：按封面关键词推正确function，与现有function比对，不一致则列出人工确认。
用法: python3 scripts/fix_function.py [--apply]
"""
import json, re, sys

KW2FUNC = [
    (r'shift register', '移位寄存器'),
    (r'flip-flop', '触发器'),
    (r'transceiver', '收发器'),
    (r'multiplexer|mux/de-mux|2:1 usb|differential 2:1', '多路复用器'),
    (r'decoder|demultiplexer(?!.*decoder)', '译码器'),
    (r'schmitt.*nand|nand.*schmitt', '与非门'),
    (r'schmitt.*nor|nor.*schmitt', '或非门'),
    (r'schmitt.*and\b|and.*schmitt', '与门'),
    (r'schmitt.*inverter|inverter.*schmitt', '施密特反相器'),
    (r'schmitt.*buffer|buffer.*schmitt', '施密特缓冲器'),
    (r'schmitt trigger(?!.*(nand|nor|and|inverter|buffer))', '施密特触发器'),
    (r'xor|exclusive-or', '异或门'),
    (r'xnor', '异或非门'),
    (r'nand', '与非门'),
    (r'nor', '或非门'),
    (r'\band\b(?!.*schmitt)', '与门'),
    (r'\bor\b(?!.*(xor|schmitt))', '或门'),
    (r'open.drain.*invert|invert.*open.drain', '开漏反相器'),
    (r'inverter', '反相器'),
    (r'buffer|line driver', '同相缓冲器'),
    (r'latch', '锁存器'),
    (r'analog switch|spdt|spst|dpdt', '模拟开关'),
    (r'translat', '电平转换收发器'),
    (r'configurable.*gate|multi.function', '多功能可配置门'),
    (r'counter', '计数器'),
]

def infer(desc):
    d = desc.lower()
    for pat, func in KW2FUNC:
        if re.search(pat, d):
            return func
    return ''

def main():
    apply = '--apply' in sys.argv
    titles = json.load(open('/tmp/cover_titles.json', encoding='utf-8'))
    # PDF名stem -> 描述
    pdf_desc = {}
    for pdf, t in titles.items():
        m = re.match(r'^(.+?)(?:_Product|_Draft|_Drft)', pdf)
        stem = m.group(1) if m else pdf
        desc = t.split('||')[1].strip() if '||' in t else ''
        pdf_desc[stem] = desc
    data = json.load(open('/Users/hu/fae-knowledge-web/data/products.json', encoding='utf-8'))
    SUFFIX = re.compile(r'(GV|GW|GX|GS|GM|DRL|PW|RGY|RSA|UD|MS|RSW|DRC|DRB|YFC|YFQ|YFG|MSV|RSV|N|Q|D)$')
    def base(m):
        return SUFFIX.sub('', m or '')
    def tokens(s):
        return set(re.findall(r'EM74|EMS|EXS|EL|\d+G\d+|[A-Z]+', s))
    n_flag = 0
    n_fix = 0
    for x in data:
        b = base(x['model'])
        bt = tokens(b)
        best = None
        bestscore = 0
        for stem, desc in pdf_desc.items():
            if not desc:
                continue
            mnum = re.search(r'\d+G\d+', b)
            if mnum and mnum.group(0) not in stem:
                continue
            score = len(bt & tokens(stem))
            if score > bestscore:
                bestscore = score
                best = desc
        if not best:
            continue
        want = infer(best)
        if want and want != x.get('function'):
            n_flag += 1
            if n_flag <= 40:
                print('  ' + x['model'] + ': 网页=' + str(x.get('function')) + ' vs PDF封面=' + want + ' (' + best[:55] + ')', flush=True)
            if apply:
                x['function'] = want
                n_fix += 1
    print('标记' + str(n_flag) + '条' + ('，已修复' + str(n_fix) if apply else '（预览，未写回）'), flush=True)
    if apply:
        json.dump(data, open('/Users/hu/fae-knowledge-web/data/products.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
