#!/usr/bin/env python3
"""给 products.json 注入官方 applications（原文 + 域分类双字段）v2
修正: ① 用完整基础型号对照表匹配（非 [:7] 截断，避免 EMS23157→EMS2315 错）
      ② EXS 技术性应用原文保留（电压电平转换/I2C/open-drain），域分类仅真命中才给
"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parent.parent
PRODUCTS_FILE = DIR / "data" / "products.json"
APP_AUTH = "/tmp/fae_web/raw_apps_authoritative.json"

DOMAINS = [
    ("手机/平板/便携", ["cell phone","cellphone","mobile phone","phone","tablet","tws","headset","wearable","notebook","laptop","pda","digital camera","handheld"]),
    ("USB/Type-C路由", ["usb","type-c","type c","type_c","usb2.0","usb 2.0","480mbps","10gbps","type-c receptacle"]),
    ("音频/视频路由", ["audio","video","signal rout","routing","uart","signal and supply","spdt","spst","spdq","spqt","dpdt","analog switch","audio switch","headset","speaker","microphone","mux","demux"]),
    ("PC/服务器/存储", ["server","storage","notebook","desktop","computer","backplane","pcie","pci express","shared i/o","san","pc and server"]),
    ("显示/监控/TV", ["lcd","monitor","tv","set-top","set top","display","hdmi","fpd","fpd link","camera","broadcast","panel"]),
    ("车载/医疗/工业", ["automotive","car","medical","industrial","motor","supply routing","ovp","over-voltage","battery","charging","usb type-c ecosystem"]),
]

def main():
    auth = json.load(open(APP_AUTH, encoding="utf-8"))
    products = json.loads(PRODUCTS_FILE.read_text(encoding="utf-8"))

    # 基础型号清单（37 个权威键 = 完整基础型号）
    base_keys = sorted(auth.keys())
    # 型号归属：型号 == 基础 或 型号以 基础+封装后缀 开头
    def base_of(model):
        for b in base_keys:
            if model == b:
                return b
            if model.startswith(b) and model[len(b):] in ("DC","DCN","D","PW","RGY","RSA","UD","GV","GW","GS","GM","GX"):
                return b
        return None

    n_txt = 0; n_dom = 0
    exs_txt = 0
    for x in products:
        b = base_of(x["model"])
        if not b or b not in auth:
            continue
        raw = auth[b]["applications_raw"]
        domains = [d for d, kws in DOMAINS if any(k in raw.lower() for k in kws)]
        x["applications"] = raw          # 官方原文（完整保留，含 EXS 技术性应用）
        if domains:
            x["applications_domains"] = domains
            n_dom += 1
        n_txt += 1
        if x["series"] == "EXS":
            exs_txt += 1

    PRODUCTS_FILE.write_text(json.dumps(products, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  ✅ 注入完成")
    print(f"     applications(原文): {n_txt}/{len(products)} 条 | EXS={exs_txt}")
    print(f"     applications_domains(域): {n_dom} 条")
    # EXS 抽样确认原文保留
    for x in products:
        if x["series"]=="EXS" and x.get("applications"):
            print(f"       EXS 样例 {x['model']}: {x['applications'][:60]!r} | domains={x.get('applications_domains','∅')}")
            break

if __name__ == "__main__":
    main()
