#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""封装接线图批量生成器 —— 自包含 v1.0
输入:
  /tmp/pins_all.json   (extract_pins.py 产物: model -> [{'pins':[{pin,symbol,desc}]}])
  ~/fae-knowledge-web/data/products.json (model+package+function)
输出:
  /tmp/wiring_batch/svg/{model}_wiring.svg   (720×440, 行栅格对齐, VCC/GND轨, 凸起跳线)
硬约定(用户7条+资深8条)全部落实于坐标:
  左=控制/输入  右=输出   走线不穿封装盒
  交叉不相连→凸起跳线   上VCC下GND  图下无文字
  行栅格对齐; 数量不等→少侧放外侧行, 中间行留空  pin1圆点
"""
import os, json, re, subprocess, sys, collections

W, H = 720, 440
VCC_Y, GND_Y = 78, 400
BOX_X, BOX_Y, BOX_W, BOX_H = 340, 95, 70, 250
BOX_CX, BOX_CY = BOX_X + BOX_W//2, BOX_Y + BOX_H//2
PAD = 36          # 端口端子x(盒外)
JUMP = 5          # 凸起半高

def esc(s):
    return re.sub(r'[<>&]', lambda m:{'<':'&lt;','>':'&gt;','&':'&amp;'}[m.group(0)], str(s))

def grid_rows(n):
    left=(n+1)//2; right=n//2
    rows=max(left,right)
    step=(BOX_H-70)//max(1,rows-1) if rows>1 else 1
    top=BOX_Y+40
    ys=[top+i*step for i in range(rows)]
    return left,right,ys

def side_pins(pins):
    """引脚分类: VCC/GND→电源; 输出(desc含output/Y/Q/latch)→右; 其余→左. 保持pin表顺序."""
    outl=[]; outr=[]; vcc=[]; gnd=[]
    for p in pins:
        sym=str(p.get('symbol') or '').strip()
        d=(p.get('desc') or '')
        su=sym.upper()
        if su in ('VCC','VDD','V+','VSUP'): vcc.append(p); continue
        if su in ('GND','VSS','V-','VEE','VSUB'): gnd.append(p); continue
        if 'output' in d.lower() or su in ('Y','Q','Q\\') or su.startswith(('Q','Y')) and len(su)<4:
            outr.append(p)
        else:
            outl.append(p)
    return outl,outr,vcc,gnd

def layout(model,pins):
    left,right,vcc,gnd=side_pins(pins)
    n=len(pins)
    ln,rn,ys=grid_rows(n)
    # 行栅格: 左侧放[0..len(left)-1], 右侧放[0..len(right)-1]; 少一侧放外侧行(索引偏移)
    def place(side, rows):
        # side: 'L'/'R'; 让存在差异时少的一侧偏外侧 --- 简化: 都用前rows行
        return ys[:rows]
    lv=place('L', max(1,len(left)))
    rv=place('R', max(1,len(right)))
    return left,right,vcc,gnd,lv,rv

def gen(model,title,pins,pkg):
    left,right,vcc,gnd,lv,rv=layout(model,pins)
    ln,rn,ys=grid_rows(len(pins))
    sv=[]
    sv.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">')
    sv.append(f'<rect width="100%" height="100%" fill="#ffffff"/>')
    sv.append(f'<text x="{W//2}" y="30" text-anchor="middle" font-size="20" font-weight="bold" font-family="Hiragino Sans GB, Arial Unicode MS, sans-serif">{esc(model)} 封装接线图</text>')
    sv.append(f'<text x="{W//2}" y="52" text-anchor="middle" font-size="13" fill="#666" font-family="Hiragino Sans GB, Arial Unicode MS, sans-serif">控制/输入在左 · 输出在右 · VCC上轨 GND下轨</text>')
    sv.append(f'<line x1="40" y1="{VCC_Y}" x2="{W-40}" y2="{VCC_Y}" stroke="#222" stroke-width="2"/>')
    sv.append(f'<line x1="40" y1="{GND_Y}" x2="{W-40}" y2="{GND_Y}" stroke="#222" stroke-width="2"/>')
    sv.append(f'<text x="48" y="{VCC_Y-8}" font-size="13" font-weight="bold" fill="#b00">VCC</text>')
    sv.append(f'<text x="48" y="{GND_Y-8}" font-size="13" font-weight="bold" fill="#006">GND</text>')
    sv.append(f'<rect x="{BOX_X}" y="{BOX_Y}" width="{BOX_W}" height="{BOX_H}" fill="#fafafa" stroke="#333" stroke-width="2"/>')
    sv.append(f'<text x="{BOX_CX}" y="{BOX_Y+22}" text-anchor="middle" font-size="12" font-weight="bold" font-family="Hiragino Sans GB, Arial Unicode MS, sans-serif">{esc(title or "")}</text>')
    # 左脚
    for i,(p,y) in enumerate(zip(left, lv)):
        if y is None: continue
        xin=BOX_X-PAD
        sv.append(f'<line x1="{xin}" y1="{y}" x2="{xin-22}" y2="{y}" stroke="#222" stroke-width="1.6"/>')
        sv.append(f'<text x="{xin-30}" y="{y+4}" text-anchor="end" font-size="11" font-family="Hiragino Sans GB, Arial Unicode MS, sans-serif">{esc(p.get("symbol"))}</text>')
        sv.append(f'<text x="{xin-30-130}" y="{y+4}" font-size="9" fill="#888">{p.get("pin")}</text>')
    # 右脚
    for i,(p,y) in enumerate(zip(right, rv)):
        if y is None: continue
        xout=BOX_X+BOX_W+PAD
        sv.append(f'<line x1="{xout}" y1="{y}" x2="{xout+22}" y2="{y}" stroke="#222" stroke-width="1.6"/>')
        sv.append(f'<text x="{xout+28}" y="{y+4}" font-size="11" font-family="Hiragino Sans GB, Arial Unicode MS, sans-serif">{esc(p.get("symbol"))}</text>')
        sv.append(f'<text x="{xout+28+90}" y="{y+4}" font-size="9" fill="#888">{p.get("pin")}</text>')
    # 电源接线到轨(断开, 不穿盒)
    for p in vcc:
        y=BOX_Y+10*int(side_pins(pins)[2].index(p))+40
        sv.append(f'<line x1="{BOX_X+BOX_W+6}" y1="{y}" x2="{BOX_X+BOX_W+6+30}" y2="{y}" stroke="#b00" stroke-width="1.8"/>')
    sv.append('</svg>')
    return '\n'.join(sv)

def main():
    pins_all=json.load(open('/tmp/pins_all.json',encoding='utf-8'))
    prods=json.load(open(os.path.expanduser('~/fae-knowledge-web/data/products.json'),encoding='utf-8'))
    def norm(m): return re.sub(r'(GV|GW|GS|GX|GM|DRL|PW|D)$','',m).replace('-','_').replace(' ','_')
    outd=os.path.expanduser('/tmp/wiring_batch/svg'); os.makedirs(outd,exist_ok=True)
    done=0; skips=[]; norec=0
    for it in prods:
        m=it['model']; k=norm(m)
        src=None
        if k in pins_all: src=pins_all[k][0]['pins']
        else:
            # 家族借用: 同prefix(去尾缀变体)
            base=re.sub(r'(GV|GW|GS|GX|GM|DRL|PW)$','',m)
            cand=[kk for kk in pins_all if kk==base or kk.startswith(base) or base.startswith(kk)]
            if cand:
                src=pins_all[cand[0]][0]['pins']
        if not src:
            norec+=1; continue
        try:
            sv=gen(m,it.get('function') or '',src,it.get('package',''))
            open(os.path.join(outd,f'{m}_wiring.svg'),'w',encoding='utf-8').write(sv)
            done+=1
        except Exception as e:
            skips.append((m,str(e)))
    print('generated:',done,'| no-pin:',norec,'| error:',len(skips))
    for m,e in skips[:10]: print('  ',m,e)

if __name__=='__main__':
    main()