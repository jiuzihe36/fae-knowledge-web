#!/usr/bin/env python3
"""标准下标格式：给specs加param_html（V<sub>IH</sub>），value/conditions同理。
用法: python3 scripts/subscript_format.py
"""
import json, re

# 符号库：主字母 + 下标（按主字母分组，下标原样放<sub>）
SUBS = {
    'V': ['OH', 'OL', 'IH', 'IL', 'O', 'I', 'CC', 'SEL', 'A', 'B0', 'B1', 'DD', 'SW', 'SEL',
          'HYS', 'T', 'IK', 'OK', 'DDQ', 'SS', 'REF', 'IN', 'OUT', 'BAT', 'BUS'],
    'I': ['CC', 'O', 'I', 'OZ', 'OFF', 'IK', 'OK', 'OZ', 'GND', 'Q', 'DD', 'S', 'LEAK',
          'max', 'peak'],
    'T': ['amb', 'stg', 'J', 'L', 'opr', 'C'],
    'R': ['ON', 'FLAT', 'JA', 'JC', 'TH'],
    'C': ['I', 'PD', 'OFF', 'ON', 'L', 'IN', 'OUT'],
    't': ['pd', 't', 'en', 'dis', 'W', 'SU', 'h', 'PHL', 'PLH', 'PZL', 'PZH', 'PLZ', 'PHZ',
          'sk', 'rec', 'rise', 'fall'],
    'P': ['tot', 'D'],
    'f': ['max', 'T'],
    'B': ['W'],
}

def sub_symbol(text):
    """V IH -> V<sub>IH</sub>；VOL/VIH/VCC等连体也拆下标"""
    parts = text.split('|', 1)
    head = parts[0].strip()
    rest = ('|' + parts[1]) if len(parts) > 1 else ''
    toks = head.split()
    if len(toks) >= 2 and toks[0] in SUBS and toks[1] in SUBS[toks[0]]:
        head = toks[0] + '<sub>' + toks[1] + '</sub>' + (' ' + ' '.join(toks[2:]) if len(toks) > 2 else '')
    elif len(toks) >= 1:
        m = re.match(r'^(V)(OH|OL|IH|IL|CC|DD|SS|SEL|A|O|I)(?![A-Za-z])', toks[0])
        if m:
            head = m.group(1) + '<sub>' + m.group(2) + '</sub>' + head[len(m.group(1) + m.group(2)):]
        else:
            m2 = re.match(r'^(R|I|T|C)(ON|FLAT|CC|OZ|OFF|amb|stg|PD|JA|O|I)(?![A-Za-z])', toks[0])
            if m2:
                head = m2.group(1) + '<sub>' + m2.group(2) + '</sub>' + head[len(m2.group(1) + m2.group(2)):]
            else:
                m3 = re.match(r'^(Δ[A-Za-z]+)\s+(\w+)(.*)$', head)
                if m3:
                    head = m3.group(1) + '<sub>' + m3.group(2) + '</sub>' + m3.group(3)
    return head + rest

def sub_value(text):
    """value/conditions里的符号：VIH/VIL/VCC/V Gutiérrez 等合并词暂不动；
    处理散开的：V CC->VCC太危险（会误伤单位V），只处理明确模式：
    - 'V IH'/'V IL'/'V OH'/'V OL'（带空格，两端是边界）-> V<sub>IH</sub>
    - 'I CC'/'I O '/'R ON'/'T amb' 同理
    """
    s = text
    for main, subs in SUBS.items():
        for sub in subs:
            # 主+空格+下标，两边必须是边界/标点
            pat = r'(?<![A-Za-z<>])' + re.escape(main) + r'\s+' + re.escape(sub) + r'(?![A-Za-z<>])'
            s = re.sub(pat, main + '<sub>' + sub + '</sub>', s)
    # ΔR ON / ΔI CC / Δt/ΔV
    s = re.sub(r'Δ(R|I)\s+(ON|CC)\b', r'Δ\1<sub>\2</sub>', s)
    return s

def main():
    p = '/Users/hu/fae-knowledge-web/data/products.json'
    d = json.load(open(p, encoding='utf-8'))
    n = 0
    for x in d:
        for s in (x.get('specs') or []):
            ph = sub_symbol(str(s.get('param', '')))
            if ph != s.get('param'):
                s['param_html'] = ph
                n += 1
            vh = sub_value(str(s.get('value', '')))
            if vh != s.get('value'):
                s['value_html'] = vh
            if s.get('conditions'):
                ch = sub_value(str(s['conditions']))
                if ch != s['conditions']:
                    s['conditions_html'] = ch
    print('param_html新增:', n, flush=True)
    # 抽查
    for x in d:
        if x['model'] == 'EMS3157GV':
            for s in x['specs'][:16]:
                if 'param_html' in s:
                    print(' ', s['param_html'][:60], '=', str(s.get('value'))[:30], flush=True)
                    break
            break
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
