# 自查渲染: SVG -> PNG (PIL, STHeiti 中文字体) 供 vision 验收
# 注意: 路径含空格时 vision_analyze 会报 media not found -> 输出后需复制到无空格目录
import re, os
from PIL import Image, ImageDraw, ImageFont

OUT = '/Users/hu/fae-knowledge-web/circuits'          # SVG 源目录(站点上线目录)
PNG_OUT = '/Users/hu/fae-knowledge-web/scripts/wiring'  # 自查 PNG 输出(不上线)
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'
SC = 2

def render(fn):
    svg = open(f'{OUT}/{fn}').read()
    img = Image.new('RGB', (720*SC, 440*SC), 'white')
    d = ImageDraw.Draw(img)
    cache = {}
    def font(fs):
        if fs not in cache: cache[fs] = ImageFont.truetype(FONT, int(fs*SC))
        return cache[fs]
    def box(m): return [float(v)*SC for v in m.groups()]
    for m in re.finditer(r'<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#111" stroke-width="([\d.]+)"', svg):
        x1,y1,x2,y2,sw = box(m)
        d.line([(x1,y1),(x2,y2)], fill='#111', width=max(1,int(float(m.group(5))*SC)))
    for m in re.finditer(r'<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="5" fill="#f7f9fb"', svg):
        x,y,w,h = box(m); d.rounded_rectangle([x,y,x+w,y+h], radius=5*SC, fill='#f7f9fb', outline='#111', width=2*SC)
    for m in re.finditer(r'<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" fill="#fff"', svg):
        x,y,w,h = box(m); d.rectangle([x,y,x+w,y+h], fill='#fff', outline='#111', width=2*SC)
    for m in re.finditer(r'<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="none" stroke="#111"', svg):
        cx,cy,r = box(m); d.ellipse([cx-r,cy-r,cx+r,cy+r], outline='#111', width=2*SC)
    for m in re.finditer(r'<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="#111"', svg):
        cx,cy,r = box(m); d.ellipse([cx-r,cy-r,cx+r,cy+r], fill='#111')
    # 跳线拱桥: 必须按 sweep 标志画(0=上半圆/向上拱, 1=下半圆/向下翻), 与浏览器 SVG 渲染一致
    # (旧版硬编码上半圆, 导致自查预览与浏览器不一致 -> 跳线方向改反也看不出来)
    for m in re.finditer(r'<path d="M([-\d.]+),([-\d.]+) A([\d.]+),([\d.]+) 0 0,([01]) ([-\d.]+),([-\d.]+)"', svg):
        x1, y1, r = float(m.group(1)), float(m.group(2)), float(m.group(3))
        sweep = m.group(5)
        x2, y2 = float(m.group(6)), float(m.group(7))
        cx, cy, rr = (x1 + x2) / 2, y1, r
        # 实测约定: PIL arc(180,360)=上半圆, arc(0,180)=下半圆
        # SVG: sweep=1 -> 向上拱(弧在上) ; sweep=0 -> 向下翻
        a0, a1 = (180, 360) if sweep == '1' else (0, 180)
        d.arc([(cx-rr)*SC, (cy-rr)*SC, (cx+rr)*SC, (cy+rr)*SC], a0, a1, fill='#111', width=2*SC)
    for m in re.finditer(r'<text x="([-\d.]+)" y="([-\d.]+)"(?: text-anchor="(\w+)")? font-size="([\d.]+)"( font-weight="bold")?[^>]*fill="([^"]+)"[^>]*>([^<]+)</text>', svg):
        x = float(m.group(1))*SC; y = float(m.group(2))*SC
        anch = m.group(3); fs = float(m.group(4)); fill = m.group(6); t = m.group(7)
        f = font(fs)
        w = d.textlength(t, font=f)
        if anch == 'end': x -= w
        elif anch == 'middle': x -= w/2
        d.text((x, y - fs*SC*0.85), t, fill=fill, font=f)
    png = fn.replace('.svg', '.png').replace('_wiring', '_chk')
    img.save(f'{PNG_OUT}/{png}')
    return png

if __name__ == '__main__':
    for fn in sorted(f for f in os.listdir(OUT) if f.endswith('_wiring.svg')):
        print('render', render(fn))
