/* 统一入口层：一个搜索框识别所有输入类型，结果按类型分级呈现。
   依赖 app.js 已加载的全局数据（PRODUCTS / window.__xx 等），并复用其详情抽屉。 */
(function () {
  "use strict";

  var el = {};
  var DATA = { products: [] };   /* 竞品/P2P 已摘除，只保留芯祥自有产品 */
  var ready = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[\s\-_]/g, "");
  }
  /* 去厂商前缀：SGM74HC541 → 74HC541 */
  var VENDOR_PRE = ["AIP", "SGM", "DIO", "EMS", "EXS", "EM", "EL", "CD", "HEF", "MC", "SN", "TS", "TXS"];
  function stripVendor(s) {
    var u = norm(s);
    for (var i = 0; i < VENDOR_PRE.length; i++) {
      var p = VENDOR_PRE[i];
      if (u.indexOf(p) === 0 && u.length > p.length) return u.slice(p.length);
    }
    return u;
  }
  function famKey(m) {
    var s = norm(m);
    var sfx = ["MSOP", "DRL", "BQ", "GW", "GV", "GX", "PW", "GM", "GS", "DR", "MS", "D", "Q"];
    for (var i = 0; i < sfx.length; i++) {
      var f = sfx[i];
      if (s.length > f.length + 2 && s.slice(-f.length) === f) return s.slice(0, -f.length);
    }
    return s;
  }

  /* ---------- 数据装载 ---------- */
  function grab() {
    var g = window.__xx || {};
    DATA.products = g.products || [];
  }

  function hasData() {
    return !!DATA.products.length;
  }

  function loadJson(path) {
    /* 数据文件加时间戳参数：防止浏览器/CDN 缓存旧数据（曾致分类更新后页面不变） */
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    return fetch(path + sep + "t=" + Math.floor(Date.now() / 60000))
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  var BY_ID = Object.create(null);   /* id -> product，避免每次开详情全表扫描 */

  function afterReady() {
    ready = true;
    DATA.products.forEach(function (p) { BY_ID[p.id] = p; });
    var n = DATA.products.length;
    var specs = 0;
    DATA.products.forEach(function (p) { specs += (p.specs && p.specs.length) || 0; });
    if (el.statModels && n) el.statModels.textContent = n;
    if (el.statSpecs && specs) el.statSpecs.textContent = specs > 999 ? Math.round(specs / 1000) + "k" : specs;
    if (el.meta) el.meta.textContent = "型号 " + n + " 款 · 参数 " + specs + " 条";
    loadCatalog().then(function () {
      /* 默认展开最大类，避免打开只看到 3 行 */
      if (CATALOG && CATALOG.cats && CATALOG.cats.length) {
        var big = CATALOG.cats.slice().sort(function (a, b) { return b.count - a.count; })[0];
        if (big) openCats[big.key] = true;
      }
      renderCatalog();
      if (el.q && el.q.value.trim()) doSearch(el.q.value);
      else setMode(false);
      /* 手机用短 placeholder（长提示在窄屏被截断） */
      if (el.q && window.innerWidth <= 560) {
        el.q.setAttribute("placeholder", "搜索芯祥型号");
      }

      /* 桌面端自动聚焦搜索框；触屏不聚焦（避免弹键盘挡内容） */
      if (el.q && !("ontouchstart" in window) && window.innerWidth > 820) {
        try { el.q.focus({ preventScroll: true }); } catch (e) { el.q.focus(); }
      }
    });
  }

  function loadCatalog() {
    if (CATALOG) return Promise.resolve(CATALOG);
    /* 加时间戳参数防缓存（与 loadJson 一致） */
    return fetch("./data/catalog.json?t=" + Math.floor(Date.now() / 60000))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { CATALOG = d; return d; })
      .catch(function () { return null; });
  }

  function boot() {
    grab();
    if (hasData()) { afterReady(); return; }
    /* app.js 还在装载 —— 轮询桥接，兜底自行 fetch */
    var tries = 0;
    var iv = setInterval(function () {
      grab();
      if (hasData() || ++tries > 60) {
        clearInterval(iv);
        if (!hasData()) {
          /* 兜底：只拉芯祥自有产品数据（竞品/P2P 已整体摘除，不再请求） */
          loadJson("./data/products_lite.json").then(function (d) {
            if (d) DATA.products = d;
            afterReady();
          });
        } else afterReady();
      }
    }, 150);
  }

  /* ---------- 输入识别 ---------- */
  /* 厂商名（只在整串就是厂商名/中文厂商名时才当厂商） */
  var VENDOR_MAP = { "TI": "TI", "德州仪器": "TI", "德州": "TI", "NXP": "NXP", "恩智浦": "NXP",
                     "NEXPERIA": "NXP", "圣邦": "SGM", "SGMICRO": "SGM", "SGM": "SGM",
                     "中微爱芯": "AiP", "爱芯": "AiP", "AIP": "AiP",
                     "帝奥微": "DIOO", "DIOO": "DIOO" };

  function classify(q) {
    var s = String(q || "").trim();
    if (!s) return { kind: "empty" };
    var u = norm(s);

    /* ① 型号特征最优先 —— SGM3157 / AiP74LVC1G08 是料号，不是厂商 */
    if (/^(EM|EXS|EL)[0-9A-Z]/i.test(u) && u.length >= 6) return { kind: "em", q: s };
    if (/^(SN|TXS|TS|TCA|CD4|LM|TL|OPA|TPS|REF)[0-9]/.test(u) && u.length >= 6) return { kind: "comp", q: s, vendor: "TI" };
    if (/^SGM[0-9]/.test(u)) return { kind: "comp", q: s, vendor: "SGM" };
    if (/^AIP[0-9]/.test(u)) return { kind: "comp", q: s, vendor: "AiP" };
    if (/^DIO[0-9]/.test(u)) return { kind: "comp", q: s, vendor: "DIOO" };
    if (/^74[A-Z][0-9A-Z]/.test(u)) return { kind: "generic", q: s };

    /* ② 厂商名（整串匹配或纯中文厂商） */
    for (var k in VENDOR_MAP) { if (u === norm(k)) return { kind: "vendor", vendor: VENDOR_MAP[k], q: s }; }
    if (/^[\u4e00-\u9fff]+$/.test(s)) {
      for (var k2 in VENDOR_MAP) { if (s.indexOf(k2) >= 0) return { kind: "vendor", vendor: VENDOR_MAP[k2], q: s }; }
    }

    /* ③ 纯字母数字串当料号 */
    if (/^[A-Z0-9\-\.\/]+$/.test(u) && u.length >= 4) return { kind: "generic", q: s };

    /* ④ 其余当功能词 */
    return { kind: "func", q: s };
  }

  /* ---------- 检索 ---------- */
  function findProducts(q) {
    var u = norm(q), base = stripVendor(q);
    var out = [];
    DATA.products.forEach(function (p) {
      var m = norm(p.model);
      if (m === u || norm(p.model).indexOf(u) >= 0) { out.push(p); return; }
      if (base !== u && m.indexOf(base) >= 0) { out.push(p); return; }
      if (famKey(p.model) === "EM" + base || famKey(p.model) === base) out.push(p);
    });
    /* 完全匹配优先 */
    out.sort(function (a, b) {
      var am = norm(a.model) === u ? 0 : 1, bm = norm(b.model) === u ? 0 : 1;
      return am - bm || norm(a.model).length - norm(b.model).length;
    });
    return out;
  }

  /* 按字段分档：功能的精确命中排最前，"描述里顺带提到"的排最后 */
  function findByFunc(q) {
    var s = q.toLowerCase();
    var hits = [];
    DATA.products.forEach(function (p) {
      var rank = -1;
      var fn = String(p.function || "").toLowerCase();
      var fd = String(p.function_detail || "").toLowerCase();
      var se = String(p.series || "").toLowerCase();
      var pk = String(p.package || "").toLowerCase();
      /* 应用场景也是搜索字段 —— 用户搜「I2C」应能找到开漏反相器（场景=「I2C 总线与中断驱动」） */
      var ap = [p.applications || "", (p.applications_domains || []).join(" ")].join(" ").toLowerCase();
      if (fn === s) rank = 0;                       /* 功能名完全一致 */
      else if (fn.indexOf(s) >= 0) rank = 1;         /* 功能名含关键词 */
      else if (fd.indexOf(s) >= 0) rank = 2;         /* 功能描述含 */
      else if (ap.indexOf(s) >= 0) rank = 3;         /* 应用场景含（选型主入口，排在系列/封装前） */
      else if (se.indexOf(s) >= 0) rank = 4;         /* 系列名含 */
      else if (pk.indexOf(s) >= 0) rank = 5;         /* 封装含 */
      else {
        var rest = [p.logic_type, p.application, p.description].filter(Boolean).join(" ").toLowerCase();
        if (rest.indexOf(s) >= 0) rank = 6;          /* 其他字段顺带提到 */
      }
      if (rank >= 0) hits.push({ p: p, r: rank });
    });
    hits.sort(function (a, b) { return a.r - b.r || a.p.model.localeCompare(b.p.model); });
    return hits.map(function (h) { return h.p; });
  }
      var VERDICT_CLS = { "参数一致": "ok", "有差异": "warn", "需核对": "neutral", "偏紧": "warn" };

  /* ---------- 渲染 ---------- */
  /* ---------- 详情页上下切换（按当前可见列表顺序） ---------- */
  var NAV = { list: [], idx: -1 };

  /* ---------- 常用场景（localStorage，不传服务器） ---------- */
  var FAV_KEY = "xx_fav_apps";
  function favList() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]") || []; }
    catch (e) { return []; }
  }
  function isFav(name) { return favList().indexOf(name) >= 0; }
  function toggleFav(name) {
    var l = favList(), i = l.indexOf(name);
    if (i >= 0) l.splice(i, 1); else l.push(name);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(l)); } catch (e) {}
    return l.indexOf(name) >= 0;
  }

    /* 从 DOM 里取"当前可见的型号列表"——所见即所得，不用维护镜像状态 */
  function visibleModels(fromEl) {
    var container = fromEl ? fromEl.parentElement : null;
    while (container && container !== document.body) {
      var nodes = container.querySelectorAll("[data-model]");
      if (nodes.length > 1) return Array.prototype.map.call(nodes, function (n) {
        return n.getAttribute("data-model");
      });
      container = container.parentElement;
    }
    return [];
  }

  function syncNav(currentModel, fromEl) {
    NAV.list = visibleModels(fromEl);
    var i = NAV.list.indexOf(currentModel);
    NAV.idx = i;
    var prev = document.getElementById("prevModel");
    var next = document.getElementById("nextModel");
    var pos = document.getElementById("navPos");
    if (!prev || !next || !pos) return;
    if (!NAV.list.length || i < 0) {
      prev.disabled = next.disabled = true;
      pos.textContent = "";
    } else {
      prev.disabled = i <= 0;
      next.disabled = i >= NAV.list.length - 1;
      pos.textContent = (i + 1) + " / " + NAV.list.length;
    }
  }

  function navStep(delta) {
    if (!NAV.list.length || NAV.idx < 0) return;
    var j = NAV.idx + delta;
    if (j < 0 || j >= NAV.list.length) return;
    openDetail(NAV.list[j]);
  }

  function openDetail(model, fromEl) {
    if (!model) return;
    if (window.__xx && typeof window.__xx.openByModel === "function") {
      window.__xx.openByModel(model);
      syncNav(model, fromEl);
      return;
    }
    /* 兜底：桥接还没就绪时，用隐藏表格行触发 app.js 原有点击逻辑 */
    var rows = document.querySelectorAll("#tableBody tr");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-model") === model ||
          (rows[i].textContent || "").indexOf(model) >= 0) { rows[i].click(); return; }
    }
    console.warn("[目录] 找不到型号详情入口:", model);
  }

  function productCard(p) {
    var badges = [];
    if (p.status) badges.push('<span class="mini-badge">' + esc(p.status) + "</span>");
    if (p.logic_type) badges.push('<span class="mini-badge">' + esc(p.logic_type) + "</span>");
    return '<button type="button" class="rcard" data-model="' + esc(p.model) + '">' +
      '<div class="rcard-top"><span class="rcard-model mono">' + esc(p.model) + "</span>" +
      '<span class="rcard-func">' + esc(p.function || "") + "</span></div>" +
      '<div class="rcard-meta">' +
      (p.series ? "<span>系列 " + esc(p.series) + "</span>" : "") +
      (p.package ? "<span>" + esc(p.package) + "</span>" : "") +
      (p.vcc ? "<span>" + esc(p.vcc) + "</span>" : "") +
      (p.function_detail ? "<span>" + esc(p.function_detail) + "</span>" : "") +
      "</div>" +
      (badges.length ? '<div class="rcard-badges">' + badges.join("") + "</div>" : "") +
      "</button>";
  }







  function render(results, summary) {
    el.results.innerHTML = results;
    el.resultBar.classList.remove("hidden");
    el.resultSummary.textContent = summary || "";
  }

  /* ---------- 目录树（主页） ---------- */
  var CATALOG = null;
  var openCats = Object.create(null);   /* 大类 -> bool */
  var openProcs = Object.create(null);  /* 大类|工艺子类 -> bool */
  var openSeries = Object.create(null); /* 大类|系列 -> bool */
  var openFuncs = Object.create(null);  /* 大类key|功能 -> bool */
  var openSers = Object.create(null);   /* 大类key|功能|系列 -> bool */

  /* 路数 → 型号（最内两层） */
  /* 型号行 */
  function renderModels(list, seriesName) {
    return list.map(function (m) {
      return '<button type="button" class="mod-row" data-model="' + esc(m.m) +
        '" data-series="' + esc(seriesName || "") + '">' +
        '<span class="mod-name mono">' + esc(m.m) + "</span>" +
        '<span class="mod-pkg">' + esc(m.pkg || "") + "</span>" +
        '<span class="mod-vcc">' + esc(m.vcc || "") + "</span>" +
        '<span class="mod-detail">' + esc(m.detail || "") + "</span>" +
        "</button>";
    }).join("");
  }

  /* 路数层（可折叠） */
  function renderRoutes(catKey, path, routes) {
    return (routes || []).map(function (rt) {
      var rk = catKey + "|" + path + "|" + rt.name;
      var rOpen = !!openSers[rk];
      var head = '<button type="button" class="ser-row" data-cat="' + esc(catKey) +
        '" data-path="' + esc(path) + '" data-ser="' + esc(rt.name) + '" aria-expanded="' + rOpen + '">' +
        '<span class="ser-caret' + (rOpen ? " open" : "") + '">▸</span>' +
        '<span class="ser-name">' + esc(rt.name) + "</span>" +
        '<span class="ser-count">' + rt.count + "</span>" +
        "</button>";
      if (!rOpen) return '<div class="ser-block">' + head + "</div>";
      return '<div class="ser-block">' + head +
        '<div class="ser-body">' + renderModels(rt.models, path.split(">")[0]) + "</div></div>";
    }).join("");
  }

  /* 功能层（可折叠）：功能 → 路数 → 型号 */
  function renderFuncs(catKey, seriesName, funcs) {
    return (funcs || []).map(function (f) {
      var path = seriesName + ">" + f.name;
      var fk = catKey + "|" + path;
      var fOpen = !!openFuncs[fk];
      var head = '<button type="button" class="func-row" data-cat="' + esc(catKey) +
        '" data-path="' + esc(path) + '" data-func="' + esc(f.name) + '" aria-expanded="' + fOpen + '">' +
        '<span class="func-caret' + (fOpen ? " open" : "") + '">▸</span>' +
        '<span class="func-name">' + esc(f.name) + "</span>" +
        '<span class="func-count">' + f.count + "</span>" +
        "</button>";
      if (!fOpen) return '<div class="func-block">' + head + "</div>";
      return '<div class="func-block">' + head +
        '<div class="func-body">' + renderRoutes(catKey, path, f.routes) + "</div></div>";
    }).join("");
  }

  /* 系列层（可折叠）：系列 → 功能 → 路数 → 型号 */
  function renderSeriesList(catKey, series) {
    return (series || []).map(function (s) {
      var path = s.name;
      var sk = catKey + "|" + path;
      var sOpen = !!openSeries[sk];
      var head = '<button type="button" class="pro-row" data-cat="' + esc(catKey) +
        '" data-path="' + esc(path) + '" data-series="' + esc(s.name) + '" aria-expanded="' + sOpen + '">' +
        '<span class="pro-caret' + (sOpen ? " open" : "") + '">▸</span>' +
        '<span class="pro-name">' + esc(s.name) + "</span>" +
        '<span class="pro-count">' + s.count + " 款</span>" +
        '<span class="pro-sub">' + s.funcs.length + " 个功能</span>" +
        "</button>";
      if (!sOpen) return '<div class="pro-block">' + head + "</div>";
      return '<div class="pro-block">' + head +
        '<div class="pro-body">' + renderFuncs(catKey, path, s.funcs) + "</div></div>";
    }).join("");
  }

  /* 工艺子类层（可折叠）：工艺子类 → 系列 → 功能 → 路数 → 型号 */
  function renderProcs(catKey, procs) {
    return (procs || []).map(function (p) {
      if (!p.name) return renderSeriesList(catKey, p.series);
      var pk = catKey + "|" + p.name;
      var pOpen = !!openProcs[pk];
      var head = '<button type="button" class="grp-row" data-cat="' + esc(catKey) +
        '" data-proc="' + esc(p.name) + '" aria-expanded="' + pOpen + '">' +
        '<span class="grp-caret' + (pOpen ? " open" : "") + '">▸</span>' +
        '<span class="grp-name">' + esc(p.name) + "</span>" +
        '<span class="grp-count">' + p.count + " 款</span>" +
        '<span class="grp-sub">' + p.series.length + " 个系列</span>" +
        "</button>";
      if (!pOpen) return '<div class="grp-node">' + head + "</div>";
      return '<div class="grp-node open">' + head +
        '<div class="grp-body">' + renderSeriesList(catKey, p.series) + "</div></div>";
    }).join("");
  }

  function renderCatalog() {
    if (!CATALOG || !el.catTree) return;
    /* 手机端收紧筛选框提示（长提示在窄屏被截断） */
    if (window.innerWidth <= 560) {
      var tf = document.getElementById("treeFilter");
      if (tf) tf.setAttribute("placeholder", "筛选型号 / 功能 / 封装");
    }
    var cats = CATALOG.cats || [];
    if (el.catCount) el.catCount.textContent = CATALOG.total + " 款产品 · " + cats.length + " 大类";
    var html = cats.map(function (c) {
      var isOpen = !!openCats[c.key];
      var nser = 0;
      (c.procs || []).forEach(function (p) { nser += (p.series || []).length; });
      var sub = (c.proc_level ? (c.procs.length + " 个工艺组 · ") : "") + nser + " 个系列";
      var head = '<button type="button" class="cat-row" data-cat="' + esc(c.key) + '" aria-expanded="' + isOpen + '">' +
        '<span class="cat-caret' + (isOpen ? " open" : "") + '">▸</span>' +
        '<span class="cat-name">' + esc(c.name) + "</span>" +
        '<span class="cat-count">' + c.count + " 款</span>" +
        '<span class="cat-sub">' + esc(sub) + "</span>" +
        "</button>";
      if (!isOpen) return '<div class="cat-node">' + head + "</div>";
      return '<div class="cat-node open">' + head +
        '<div class="cat-body">' + renderProcs(c.key, c.procs) + "</div></div>";
    }).join("");
    el.catTree.innerHTML = html;
    renderCrumb();
  }

  /* 回到「默认折叠」初始态：清空所有展开状态，只展开最大的大类 */
  function resetTreeDefault() {
    openCats = Object.create(null); openProcs = Object.create(null);
    openSeries = Object.create(null); openFuncs = Object.create(null);
    openSers = Object.create(null);
    if (CATALOG && CATALOG.cats && CATALOG.cats.length) {
      var big = CATALOG.cats.slice().sort(function (a, b) { return b.count - a.count; })[0];
      if (big) openCats[big.key] = true;
    }
    renderCatalog();
  }

  /* 面包屑：跟着当前展开层级走 */
  function renderCrumb() {
    if (!el.crumb || !CATALOG) return;
    var parts = ['<b>全部产品</b>'];
    var cat = (CATALOG.cats || []).filter(function (c) { return openCats[c.key]; })[0];
    if (!cat) { el.crumb.innerHTML = parts.join(""); return; }
    parts.push('<a href="#" data-crumb-back="cat">' + esc(cat.name) + "</a>");
    /* 找到最深展开的工艺组 */
    var proc = null;
    (cat.procs || []).forEach(function (p) {
      if (p.name && openProcs[cat.key + "|" + p.name]) proc = p;
    });
    if (proc) parts.push('<a href="#" data-crumb-back="proc">' + esc(proc.name) + "</a>");
    /* 找系列 */
    var ser = null;
    var pool = proc ? proc.series : [].concat.apply([], (cat.procs || []).map(function (p) { return p.series; }));
    (pool || []).forEach(function (s) { if (openSeries[cat.key + "|" + s.name]) ser = s; });
    if (ser) parts.push('<a href="#" data-crumb-back="series">' + esc(ser.name) + "</a>");
    /* 找功能 */
    if (ser) {
      (ser.funcs || []).forEach(function (f) {
        if (openFuncs[cat.key + "|" + ser.name + ">" + f.name]) parts.push('<span>' + esc(f.name) + "</span>");
      });
    }
    el.crumb.innerHTML = parts.join('<span class="sep">/</span>');
  }

  /* 目录树点击：五级折叠 + 型号详情 */
  function bindTree() {
    if (!el.catTree) return;
    el.catTree.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      var cat = t.getAttribute("data-cat");
      var path = t.getAttribute("data-path");

      if (t.classList.contains("cat-row")) {
        openCats[cat] = !openCats[cat];
        renderCatalog(); return;
      }
      if (t.classList.contains("grp-row")) {
        var pk = cat + "|" + t.getAttribute("data-proc");
        openProcs[pk] = !openProcs[pk];
        renderCatalog(); return;
      }
      if (t.classList.contains("pro-row")) {
        var sk = cat + "|" + path;
        openSeries[sk] = !openSeries[sk];
        renderCatalog(); return;
      }
      if (t.classList.contains("func-row")) {
        var fk = cat + "|" + path;
        openFuncs[fk] = !openFuncs[fk];
        renderCatalog(); return;
      }
      if (t.classList.contains("ser-row")) {
        var rk = cat + "|" + path + "|" + t.getAttribute("data-ser");
        openSers[rk] = !openSers[rk];
        renderCatalog(); return;
      }
      if (t.classList.contains("mod-row")) {
        openDetail(t.getAttribute("data-model"), t);
        return;
      }
    });

    /* 详情页上一/下一型号（按钮 + ←/→ 键） */
    var pv = document.getElementById("prevModel");
    var nx = document.getElementById("nextModel");
    if (pv) pv.addEventListener("click", function () { navStep(-1); });
    if (nx) nx.addEventListener("click", function () { navStep(1); });
    /* 表头键盘排序（Enter/Space） */
    if (el.pageBody) el.pageBody.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var th = e.target.closest && e.target.closest(".doc-th");
      if (!th || !PAGES.docs) return;
      e.preventDefault();
      th.click();
    });

    document.addEventListener("keydown", function (e) {
      var dw = document.getElementById("detail");
      if (!dw || dw.classList.contains("hidden")) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); navStep(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navStep(1); }
      else if (e.key === "Escape") {
        e.preventDefault();
        var cl = document.getElementById("closeDetail");
        if (cl) { cl.click(); return; }
        /* 兜底：直接收起抽屉 */
        dw.classList.add("hidden");
        dw.setAttribute("aria-hidden", "true");
      }
    });

    /* 复制型号（FAE 日常：把料号发给客户/同事） */
    var copyBtn = document.getElementById("copyModelBtn");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      var el2 = document.getElementById("detailModel");
      var txt = el2 ? el2.textContent.trim() : "";
      if (!txt) return;
      var done = function () {
        copyBtn.textContent = "已复制";
        copyBtn.classList.add("ok");
        setTimeout(function () { copyBtn.textContent = "复制"; copyBtn.classList.remove("ok"); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(function () { fallbackCopy(txt, done); });
      } else fallbackCopy(txt, done);
    });

    function fallbackCopy(txt, done) {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { console.warn("复制失败", e); }
      document.body.removeChild(ta);
    }

    /* 主色横条：切换栏目页 */
    document.querySelectorAll(".band-in a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        goPage(a.getAttribute("data-page"));
      });
    });

    /* 应用卡片展开 / 型号跳详情 */
    if (el.pageBody) el.pageBody.addEventListener("click", function (e) {
      var star = e.target.closest("[data-fav]");
      if (star) {
        var nm = star.getAttribute("data-fav");
        var on = toggleFav(nm);
        star.textContent = on ? "★" : "☆";
        star.parentElement.parentElement.classList.toggle("fav", on);
        star.title = on ? "取消常用" : "标记常用";
        /* 重排：常用置顶 */
        if (PAGES.apps) setTimeout(function () { renderPage("apps"); }, 220);
        return;
      }
      var mod = e.target.closest("[data-model]");
      if (mod) { openDetail(mod.getAttribute("data-model"), mod); return; }
      var card = e.target.closest(".app-card");
      if (card) {
        var body = card.querySelector(".app-models");
        if (body) { body.classList.toggle("hidden"); card.classList.toggle("open"); }
        return;
      }
    });

    /* 目录树内联筛选：命中时自动展开路径，并高亮
       （挂 document：treeFilter 在 #catalogMode 内、不在 #pageBody 子树里，
         挂 pageBody 收不到它的 input 事件 → 筛选框整体失效） */
    document.addEventListener("input", function (e) {
    if (e.target.id !== "treeFilter") return;
    var q = norm(e.target.value);
    var info = document.getElementById("treeFilterInfo");
    if (!el.catTree) return;

    /* 清空搜索：回到「默认折叠」初始态 */
    if (!q) {
      if (info) info.textContent = "";
      resetTreeDefault();
      return;
    }
    /* 精准展开：只展开「含命中结果」的层级路径，其余保持默认折叠。
       （型号行的祖先 key 由数据层算出，不靠全量展开后隐藏） */
    var exact = isExactSeriesName(q);
    var hits = applyFilter(q, exact);
    renderCatalog();
    /* 命中项高亮（浅黄底），便于一眼定位 */
    var root = el.catTree;
    if (root) {
      root.querySelectorAll(".mod-row").forEach(function (n) {
        var on = exact ? (norm(n.getAttribute("data-series")) === q)
                       : norm(n.getAttribute("data-model") || "").indexOf(q) >= 0;
        n.classList.toggle("hit", on);
      });
    }
    if (info) info.textContent = hits ? "命中 " + hits + " 款" : "无匹配";
  });

  /* 关键词是否精确等于目录里某个系列名（搜系列名时不误伤同前缀系列） */
  function isExactSeriesName(q) {
    var found = false;
    if (CATALOG) CATALOG.cats.forEach(function (c) {
      (c.procs || []).forEach(function (p) {
        (p.series || []).forEach(function (s) { if (norm(s.name) === q) found = true; });
      });
    });
    return found;
  }

  /* 按关键词精准展开：遍历目录数据，命中路径才展开（其余保持默认折叠），
     返回命中款数。规则：
       ① 关键词精确等于某系列名（如 74hc）→ 只按系列归属命中，不误伤 74HCT/74HCS；
       ② 否则型号可见条件 = 型号名/封装/系列名/功能名/路数名 任一含关键词。 */
  function applyFilter(q, exactSeries) {
    openCats = Object.create(null); openProcs = Object.create(null);
    openSeries = Object.create(null); openFuncs = Object.create(null);
    openSers = Object.create(null);
    if (!CATALOG) return 0;
    var hits = 0;
    CATALOG.cats.forEach(function (c) {
      (c.procs || []).forEach(function (p) {
        (p.series || []).forEach(function (s) {
          var sHit = norm(s.name).indexOf(q) >= 0;
          (s.funcs || []).forEach(function (f) {
            var fHit = norm(f.name).indexOf(q) >= 0;
            var path = s.name + ">" + f.name;
            var fVisible = false;
            (f.routes || []).forEach(function (rt) {
              var rHit = norm(rt.name).indexOf(q) >= 0;
              var rVisible = false;
              (rt.models || []).forEach(function (m) {
                var matched;
                if (exactSeries) {
                  /* 精确系列名：只看系列归属，绝不因子串关系误伤 74HCT/74HCS */
                  matched = (norm(s.name) === q);
                } else {
                  matched = norm(m.m).indexOf(q) >= 0 ||
                            norm(m.pkg || "").indexOf(q) >= 0 ||
                            sHit || fHit || rHit;
                }
                if (matched) { rVisible = true; hits++; }
              });
              if (rVisible) { openSers[c.key + "|" + path + "|" + rt.name] = true; fVisible = true; }
            });
            if (fVisible) { openFuncs[c.key + "|" + path] = true; }
          });
          /* 该系列下若有命中则逐级展开其祖先 */
          var sHas = false;
          (s.funcs || []).forEach(function (f) {
            var path = s.name + ">" + f.name;
            if (openFuncs[c.key + "|" + path]) sHas = true;
          });
          if (sHas || (!exactSeries && sHit)) {
            openSeries[c.key + "|" + s.name] = true;
            if (p.name) openProcs[c.key + "|" + p.name] = true;
            openCats[c.key] = true;
          }
        });
      });
    });
    return hits;
  }

    /* 技术文档页：点表头排序（升序 ↔ 降序） */
    if (el.pageBody) el.pageBody.addEventListener("click", function (e) {
      var th = e.target.closest(".doc-th");
      if (th && PAGES.docs) {
        var key = th.getAttribute("data-sort");
        if (DOC_SORT.key === key) DOC_SORT.dir = -DOC_SORT.dir;
        else { DOC_SORT.key = key; DOC_SORT.dir = 1; }
        var head = document.querySelector(".doc-head");
        if (head) head.outerHTML = docHeadHtml();
        var bx = document.getElementById("docList");
        if (bx) {
          var qq = (document.getElementById("docQ") || {}).value || "";
          var lst = filterDocs(qq);
          bx.innerHTML = lst.map(function(x){return docRow(x, qq);}).join("") || '<div class="empty">没有匹配的型号</div>';
        }
        return;
      }
      /* 键盘可达：表头 Enter/Space 也能排序 */
      if (e.target.id !== "docAllBtn" || !PAGES.docs) return;
      var box = document.getElementById("docList");
      var cnt = document.getElementById("docCount");
      var q = (document.getElementById("docQ") || {}).value || "";
      var list = filterDocs(q);
      if (box) box.innerHTML = list.map(function(x){return docRow(x, q);}).join("") || '<div class="empty">没有匹配的型号</div>';
      if (cnt) cnt.textContent = list.length + " 款 · 已全部显示";
      e.target.disabled = true;
      e.target.textContent = "已全部显示";
    });

    /* 技术文档页筛选 */
    if (el.pageBody) el.pageBody.addEventListener("input", function (e) {
      if (e.target.id !== "docQ" || !PAGES.docs) return;
      var q = e.target.value;
      var list = filterDocs(q);
      var box = document.getElementById("docList");
      var cnt = document.getElementById("docCount");
      var all = document.getElementById("docAllBtn");
      if (all) { all.disabled = false; all.textContent = "显示全部"; }
      if (box) box.innerHTML = list.slice(0, 200).map(function(x){return docRow(x, q);}).join("") ||
        '<div class="empty">没有匹配的型号</div>';
      if (cnt) cnt.textContent = list.length > 200
        ? list.length + " 款 · 显示前 200" : list.length + " 款";
    });

    /* 应用场景页筛选（场景名 / 型号 / 功能任一命中） */
    if (el.pageBody) el.pageBody.addEventListener("input", function (e) {
      if (e.target.id !== "appQ" || !PAGES.apps) return;
      var q = e.target.value;
      var grid = document.getElementById("appGrid");
      var cnt = document.getElementById("appCount");
      var shown = appCardsHtml(PAGES.apps.items, q);
      if (grid) grid.innerHTML = shown;
      if (cnt) {
        var n = q ? (grid ? grid.querySelectorAll(".app-card").length : 0) : PAGES.apps.items.length;
        cnt.textContent = q ? n + " / " + PAGES.apps.items.length + " 个场景" : PAGES.apps.items.length + " 个场景";
      }
    });

    /* 面包屑点击 = 收起该层以下 */
    if (el.crumb) el.crumb.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-crumb-back]"); if (!a) return;
      e.preventDefault();
      var lvl = a.getAttribute("data-crumb-back");
      if (lvl === "home") { goPage("catalog"); return; }
      var cat = Object.keys(openCats).filter(function (k) { return openCats[k]; })[0];
      if (lvl === "cat") {
        openCats = Object.create(null);
      } else if (lvl === "proc") {
        Object.keys(openProcs).forEach(function (k) { openProcs[k] = false; });
      } else if (lvl === "series") {
        Object.keys(openSeries).forEach(function (k) { openSeries[k] = false; });
      }
      renderCatalog();
    });
  }

  /* ============================================================
     三个栏目页：应用 / 技术文档 / 封装与可靠性
     ============================================================ */
  var PAGES = { apps: null, docs: null, quality: null };

  function loadPage(name) {
    var f = name === 'apps' ? 'apps.json' : name === 'docs' ? 'docs.json' : 'quality.json';
    if (PAGES[name]) { renderPage(name); return; }
    loadJson("./data/" + f).then(function (d) { PAGES[name] = d; renderPage(name); });
  }

  function pageShell(title, sub, body) {
    return '<div class="cat-hero"><h2>' + esc(title) + "</h2>" +
      (sub ? "<p>" + esc(sub) + "</p>" : "") + "</div>" + (body || "");
  }

  /* ---- 应用场景卡片 ---- */
  /* 场景卡片 HTML。filter 非空时：场景名/型号/功能任一命中即保留。
     展开列表**不再截断**（旧版 slice(0,60) 导致「通用逻辑门组合」125 款只看得到 60 款）。
     型号超过 24 款时按功能二次分组（如 125 款门电路 → 与门/与非门/或门/或非门），
     否则一个大场景展开后是一长条无法定位的清单。 */
  var APP_GROUP_MIN = 24;   /* 超过此数才二次分组 */

  function appModelsHtml(models) {
    if (models.length <= APP_GROUP_MIN) {
      return models.map(appModHtml).join("");
    }
    /* 按功能分组（保持原有顺序：先出现的功能先列） */
    var order = [], byFn = {};
    models.forEach(function (m) {
      var k = m.fn || "其他";
      if (!byFn[k]) { byFn[k] = []; order.push(k); }
      byFn[k].push(m);
    });
    if (order.length <= 1) return models.map(appModHtml).join("");
    return order.map(function (k) {
      return '<div class="app-sub"><div class="app-sub-head">' + esc(k) +
        '<span class="app-sub-n">' + byFn[k].length + " 款</span></div>" +
        '<div class="app-sub-body">' + byFn[k].map(appModHtml).join("") + "</div></div>";
    }).join("");
  }

  function appModHtml(m) {
    return '<button type="button" class="app-mod" data-model="' + esc(m.m) + '">' +
      '<span class="am-pn mono">' + esc(m.m) + "</span>" +
      '<span class="am-fn">' + esc(m.fn) + "</span>" +
      '<span class="am-se">' + esc(m.se) + "</span>" +
      "</button>";
  }

  function appCardsHtml(items, filter) {
    var q = String(filter || "").trim().toLowerCase();
    var favs = favList();
    var list = items.slice().sort(function (a, b) {
      var fa = favs.indexOf(a.name) >= 0 ? 0 : 1;
      var fb = favs.indexOf(b.name) >= 0 ? 0 : 1;
      return fa - fb || (b.count - a.count);
    });
    if (q) {
      list = list.filter(function (it) {
        if (it.name.toLowerCase().indexOf(q) >= 0) return true;
        /* 型号名 / 功能名命中（如搜「USB」应命中含 USB 开关的场景） */
        for (var i = 0; i < it.models.length; i++) {
          var m = it.models[i];
          if (String(m.m).toLowerCase().indexOf(q) >= 0) return true;
          if (String(m.fn).toLowerCase().indexOf(q) >= 0) return true;
        }
        return false;
      });
    }
    if (!list.length) return '<div class="empty">没有匹配的应用场景</div>';
    return list.map(function (it) {
      var fav = favs.indexOf(it.name) >= 0;
      return '<div class="app-card' + (fav ? " fav" : "") + '" data-app="' + esc(it.name) + '">' +
        '<div class="app-head"><span class="app-name">' + esc(it.name) + "</span>" +
        '<button class="app-star" type="button" data-fav="' + esc(it.name) + '" ' +
        'title="' + (fav ? "取消常用" : "标记常用") + '" aria-label="标记常用">' +
        (fav ? "★" : "☆") + "</button>" +
        '<span class="app-caret">▸</span></div>' +
        '<div class="app-count">' + it.count + " 款型号 · 点击展开</div>" +
        '<div class="app-models hidden">' + appModelsHtml(it.models) + "</div></div>";
    }).join("");
  }

  /* ---- 封装与可靠性页小工具 ---- */
  function qCard(n, label) {
    return '<div class="q-card"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>';
  }
  /* 尾缀的实际封装分布：主封装 + 数量，>3 种时折叠（title 显示全部） */
  function pkgDist(variants) {
    if (!variants || !variants.length) return "—";
    var top = variants.slice(0, 3).map(function (v) {
      return esc(v.k) + '<span class="mu"> ' + v.n + '</span>';
    }).join('<span class="sep2">·</span>');
    if (variants.length > 3) {
      var rest = variants.slice(3).map(function (v) { return v.k + " " + v.n; }).join("、");
      top += '<span class="sep2">·</span><span class="mu" title="' + esc(rest) + '">等 ' + variants.length + ' 种</span>';
    }
    return top;
  }
  /* 尺寸文本归一化：× 统一、单位间距统一 */
  function fmtSize(s) {
    if (!s) return "—";
    return String(s)
      .replace(/\s*[xX·]\s*/g, " × ")
      .replace(/\s*×\s*/g, " × ")
      .replace(/(\d)\s*mm/g, "$1 mm")
      .replace(/\s*;/g, "；")
      .replace(/Max\s+/g, "Max ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderPage(name) {
    var d = PAGES[name];
    if (!d || !el.pageBody) return;
    setMode(false);
    showCatalog(false);
    el.pageBody.classList.remove("hidden");
    var html = "";

    if (name === "apps") {
      html += pageShell("按应用场景选型",
        "共 " + d.total + " 个应用场景，覆盖 " + d.total_models + " 款型号。点击场景展开对应型号。");
      /* 场景筛选框：输入关键词（如 USB / I2C / 缓冲）即时过滤场景 */
      html += '<div class="doc-sticky"><div class="doc-tools">' +
        '<input id="appQ" class="page-search" type="search" ' +
        'placeholder="按场景名 / 型号 / 功能筛选（如 USB、I2C、缓冲）" autocomplete="off">' +
        '<span id="appCount" class="count-pill">' + d.total + " 个场景</span></div></div>";
      html += '<div id="appGrid" class="app-grid">' + appCardsHtml(d.items, PENDING_APP_Q) + "</div>";
    }

    if (name === "docs") {
      var st = d.stats;
      html += pageShell("技术文档",
        "规格书 " + st.with_ds + " 份 · 引脚图 " + st.with_pin + " 份 · 覆盖全部 " + st.total + " 款型号");
      html += '<div class="doc-sticky"><div class="doc-tools">' +
        '<input id="docQ" class="page-search" type="search" ' +
        'placeholder="按型号 / 功能 / 系列 / 封装筛选" autocomplete="off">' +
        '<button id="docAllBtn" class="btn-ghost" type="button">显示全部</button>' +
        '<span id="docCount" class="count-pill">' + d.items.length + " 款 · 显示前 200</span></div>" +
        docHeadHtml() + '</div>';
      html += '<div id="docList" class="doc-list">' +
        d.items.slice(0, 200).map(function(x){return docRow(x, "");}).join("") + "</div>";
    }

    if (name === "quality") {
      var tot = d.total || 1;
      html += pageShell("封装与可靠性",
        "温度等级 · 封装尺寸 · 工艺类型，共 " + d.total + " 款型号");

      /* ① 概览卡片 */
      html += '<div class="q-overview">' +
        qCard(d.total, "在库型号") +
        qCard(d.temp.length, "温度等级") +
        qCard(d.package.length, "封装形式") +
        qCard(d.suffix ? d.suffix.length : 0, "尾缀种类") +
        '</div>';

      /* ② 工作温度等级（含占比条） */
      html += '<h3 class="page-h3">工作温度等级</h3>' +
        '<table class="param q-tbl"><thead><tr><th>温度范围</th><th class="num">型号数</th><th class="num">占比</th><th class="bar-col">分布</th></tr></thead><tbody>' +
        d.temp.map(function (t) {
          var pct = t.n / tot * 100;
          return '<tr><td class="k">' + esc(t.k) + '</td><td class="v num">' + t.n +
            '</td><td class="v num">' + pct.toFixed(1) + '%</td>' +
            '<td class="bar-col"><span class="q-bar" style="width:' + Math.max(pct, 1).toFixed(1) + '%"></span></td></tr>';
        }).join("") + "</tbody></table>";

      /* ③ 工艺类型 */
      html += '<h3 class="page-h3">工艺类型</h3>' +
        '<table class="param q-tbl"><thead><tr><th>类型</th><th class="num">型号数</th><th class="num">占比</th></tr></thead><tbody>' +
        d.logic_type.map(function (t) {
          return '<tr><td class="k">' + esc(t.k) + '</td><td class="v num">' + t.n +
            '</td><td class="v num">' + (t.n / tot * 100).toFixed(1) + '%</td></tr>';
        }).join("") + "</tbody></table>";

      /* ④ 型号尾缀对照（紧凑：主封装 + 其余折叠） */
      if (d.suffix && d.suffix.length) {
        html += '<h3 class="page-h3">型号尾缀对照（' + d.suffix.length + ' 种）</h3>' +
          '<p class="page-note">尾缀标识封装形式，具体引脚数由型号中间的数字决定。' +
          '例：<span class="mono">EM74LVC1G00<b>GV</b></span> = SOT-23-5</p>' +
          '<table class="param q-tbl sfx-tbl"><thead><tr><th>尾缀</th><th>封装系列</th><th>说明</th><th class="num">型号数</th><th>实际封装分布</th></tr></thead><tbody>' +
          d.suffix.map(function (s) {
            return '<tr><td class="k"><span class="sfx-badge">' + esc(s.sfx) + '</span></td>' +
              '<td class="v mono sm">' + esc(s.family) + "</td>" +
              '<td class="v sm">' + esc(s.desc) + "</td>" +
              '<td class="v num">' + s.n + "</td>" +
              '<td class="v sm pkg-dist">' + pkgDist(s.variants) + "</td></tr>";
          }).join("") + "</tbody></table>";
      }

      /* ⑤ 封装规格（权威字典：引脚数 / 本体尺寸 / 高度 / pitch） */
      var pkgRows = d.package_detail || [];
      html += '<h3 class="page-h3">封装规格（' + (pkgRows.length || d.package.length) + ' 种）</h3>' +
        '<table class="param q-tbl pkg-tbl"><thead><tr>' +
        '<th>封装</th><th class="num">型号数</th><th class="num">引脚</th>' +
        '<th>本体尺寸 (mm)</th><th class="num">高度 max</th><th class="num">pitch</th>' +
        '</tr></thead><tbody>' +
        (pkgRows.length ? pkgRows.map(function (p) {
          return '<tr><td class="k mono">' + esc(p.pkg) + '</td>' +
            '<td class="v num">' + p.n + '</td>' +
            '<td class="v num">' + esc(p.pins) + '</td>' +
            '<td class="v sm">' + esc(p.body) + '</td>' +
            '<td class="v num">' + esc(p.hmax) + '</td>' +
            '<td class="v num">' + esc(p.pitch) + '</td></tr>';
        }).join("") : d.package.map(function (p) {
          return '<tr><td class="k mono">' + esc(p.k) + '</td><td class="v num">' + p.n +
            '</td><td class="v num">—</td><td class="v sm size-cell">' + esc(fmtSize(p.size)) +
            '</td><td class="v num">—</td><td class="v num">—</td></tr>';
        }).join("")) + "</tbody></table>";

      /* ⑥ 系列分布（温度档） */
      if (d.by_series && d.by_series.length) {
        html += '<h3 class="page-h3">各系列温度分布</h3>' +
          '<table class="param q-tbl"><thead><tr><th>系列</th><th class="num">型号数</th><th>温度等级分布</th></tr></thead><tbody>' +
          d.by_series.map(function (s) {
            var dist = (s.temp || []).map(function (t) {
              return esc(t.k.replace(/\s*°C/g, "℃").replace("-40 ", "-40~")) + " <b>" + t.n + "</b>";
            }).join('<span class="sep2">·</span>');
            return '<tr><td class="k mono">' + esc(s.k) + '</td><td class="v num">' + s.n +
              '</td><td class="v sm">' + (dist || "—") + "</td></tr>";
          }).join("") + "</tbody></table>";
      }
    }

    el.pageBody.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function filterDocs(q) {
    if (!PAGES.docs) return [];
    var s = norm(q);
    var list = !s ? PAGES.docs.items.slice() : PAGES.docs.items.filter(function (it) {
      return norm(it.m + " " + it.fn + " " + it.se + " " + it.pk).indexOf(s) >= 0;
    });
    return sortDocs(list);
  }

  /* 排序：字符串列按中文/字母，布尔列（技术文档）按有无 */
  function sortDocs(list) {
    if (!DOC_SORT.key) return list;
    var k = DOC_SORT.key, dir = DOC_SORT.dir;
    return list.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === "ds" || k === "pin") {          /* 布尔：有文档的排前 */
        x = x ? 1 : 0; y = y ? 1 : 0;
        return (y - x) * dir;
      }
      x = String(x == null ? "" : x); y = String(y == null ? "" : y);
      if (x === "—") x = ""; if (y === "—") y = "";
      /* 电压/温度：提取首个数值比较，否则按字符串 */
      if (k === "v" || k === "t") {
        var nx = parseFloat(x.replace(/[^0-9.\-]/g, " ").trim());
        var ny = parseFloat(y.replace(/[^0-9.\-]/g, " ").trim());
        if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return (nx - ny) * dir;
      }
      return x.localeCompare(y, "zh-Hans-CN") * dir;
    });
  }

  /* 表头：列可点击排序（data-sort 对应 docs.json 字段） */
  var DOC_COLS = [
    ['型号', 'm'], ['功能', 'fn'], ['系列', 'se'], ['封装', 'pk'],
    ['工作电压', 'v'], ['温度范围', 't'], ['工艺', 'lt'], ['技术文档', 'ds'],
  ];
  var DOC_SORT = { key: '', dir: 1 };
  function docHeadHtml() {
    return '<div class="doc-head">' + DOC_COLS.map(function (c) {
      var on = DOC_SORT.key === c[1];
      var arrow = on ? (DOC_SORT.dir > 0 ? '\u25b2' : '\u25bc') : '';
      return '<span class="doc-th' + (on ? ' on' : '') + '" data-sort="' + c[1] +
        '" role="button" tabindex="0" title="点击按' + esc(c[0]) + '排序">' +
        esc(c[0]) + (arrow ? '<i class="doc-ar">' + arrow + '</i>' : '') + '</span>';
    }).join('') + '</div>';
  }

  /* 关键词高亮（转义后按字面替换，避免 XSS） */
  function hl(text, kw) {
    var t = esc(text == null ? "" : text);
    if (!kw) return t;
    var k = esc(kw);
    if (!k) return t;
    var out = "", low = t.toLowerCase(), lowk = k.toLowerCase(), i = 0;
    while (true) {
      var p = low.indexOf(lowk, i);
      if (p < 0) { out += t.slice(i); break; }
      out += t.slice(i, p) + '<mark class="doc-hl">' + t.slice(p, p + k.length) + "</mark>";
      i = p + k.length;
    }
    return out;
  }

  function docRow(it, kw) {
    return '<button type="button" class="doc-row" data-model="' + esc(it.m) + '">' +
      '<span class="doc-pn mono">' + hl(it.m, kw) + "</span>" +
      '<span class="doc-fn">' + hl(it.fn, kw) + "</span>" +
      '<span class="doc-se">' + hl(it.se, kw) + "</span>" +
      '<span class="doc-pk">' + hl(it.pk, kw) + "</span>" +
      '<span class="doc-v" title="' + esc(it.v || "—") + '">' + esc(it.v || "—") + "</span>" +
      '<span class="doc-t" title="' + esc(it.t || "—") + '">' + esc(it.t || "—") + "</span>" +
      '<span class="doc-lt">' + esc(it.lt || "—") + "</span>" +
      '<span class="doc-badges">' +
      (it.ds ? '<span class="dbadge on">规格书</span>' : "") +
      (it.pin ? '<span class="dbadge on">引脚图</span>' : "") +
      "</span></button>";
  }

  function showCatalog(on) {
    if (el.catalogMode) el.catalogMode.classList.toggle("hidden", !on);
    if (el.pageBody) el.pageBody.classList.toggle("hidden", on);
    if (el.searchMode && on) el.searchMode.classList.add("hidden");
  }

  function goPage(name) {
    if (el.pageBody && name !== "catalog") {
      if (el.catalogMode) el.catalogMode.classList.add("hidden");
      el.pageBody.classList.remove("hidden");
      loadPage(name);
    } else {
      showCatalog(true);
      if (el.pageBody) el.pageBody.innerHTML = "";
    }
    /* 横条高亮 */
    document.querySelectorAll(".band-in a").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-page") === name);
    });
    /* 栏目页：面包屑给「返回产品目录」+ 当前栏目名 */
    if (el.crumb && name !== "catalog") {
      var TITLES = { apps: "应用", docs: "技术文档", quality: "封装与可靠性" };
      el.crumb.innerHTML = '<a href="#" data-crumb-back="home">产品目录</a>' +
        '<span class="sep">/</span><b>' + esc(TITLES[name] || "") + "</b>";
    } else {
      renderCrumb();
    }
  }

  function setMode(searching) {
    if (el.catalogMode) el.catalogMode.classList.toggle("hidden", searching);
    if (el.searchMode) el.searchMode.classList.toggle("hidden", !searching);
  }

  /* 跨文件桥接：详情抽屉里点「应用场景」可跳到应用页并筛出该场景 */
  window.__xx = window.__xx || {};
  var PENDING_APP_Q = "";
  window.__xx.goAppScene = function (sceneName) {
    if (!sceneName) return;
    PENDING_APP_Q = sceneName;
    goPage("apps");
    applyAppFilter(sceneName);
  };
  /* 应用页筛选应用器（渲染完成后调用也安全） */
  function applyAppFilter(q) {
    if (!PAGES.apps) return;                 /* 数据未就绪 —— 等 renderPage 里再补 */
    var grid = document.getElementById("appGrid");
    var cnt = document.getElementById("appCount");
    var input = document.getElementById("appQ");
    if (input && input.value !== q) input.value = q;
    if (grid) grid.innerHTML = appCardsHtml(PAGES.apps.items, q);
    if (cnt) {
      var n = grid ? grid.querySelectorAll(".app-card").length : 0;
      cnt.textContent = q ? n + " / " + PAGES.apps.items.length + " 个场景"
                          : PAGES.apps.items.length + " 个场景";
    }
  }



  function renderList(list, summary) {
    if (!list.length) {
      render('<div class="empty">没有匹配的型号。试试只输入型号主体，例如 74AHC1G00、LVC1G08。</div>', summary);
      return;
    }
    var shown = list.slice(0, 60);
    render(shown.map(productCard).join("") +
      (list.length > shown.length ? '<div class="more-note">共 ' + list.length + " 条，显示前 60 条 —— 继续输入可缩小范围</div>" : ""),
      summary);
  }

  function doSearch(q) {
    var c = classify(q);

    if (c.kind === "empty") { setMode(false); return; }
    setMode(true);
    if (!ready) { render('<div class="empty">数据加载中…</div>', ""); return; }
    var prods = [], funcs = [];
    if (c.kind === "em" || c.kind === "comp" || c.kind === "generic") prods = findProducts(q);
    if (!prods.length) funcs = findByFunc(q);

    if (prods.length) {
      if (el.filterBar) el.filterBar.classList.remove("hidden");
      render(prods.map(productCard).join(""), prods.length + " 个芯祥型号");
      return;
    }
    if (funcs.length) {
      if (el.filterBar) el.filterBar.classList.add("hidden");
      renderList(funcs, funcs.length + ' 款产品含「' + q + '」');
      return;
    }
    if (el.filterBar) el.filterBar.classList.add("hidden");
    render('<div class="empty">没有找到「' + esc(q) + '」。</div>' +
      '<div class="entry-hint">可试试：型号主体（74AHC1G00）、功能名（与非门）、路数（四路）</div>', "0 条结果");
  }

  /* ---------- 事件 ---------- */
  function bind() {
    var timer = null;
    if (el.q) {
      el.q.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { doSearch(el.q.value); }, 180);
      });
      el.q.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { clearTimeout(timer); doSearch(el.q.value); }
      });
    }
    document.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (chip) { el.q.value = chip.getAttribute("data-q") || ""; doSearch(el.q.value); el.q.focus(); return; }
      var cat = e.target.closest(".catcard");
      if (cat) { el.q.value = cat.getAttribute("data-func") || ""; doSearch(el.q.value); return; }
      var open = e.target.closest("[data-model]");
      if (open) { openDetail(open.getAttribute("data-model"), open); return; }
    });
    if (el.clearBtn) el.clearBtn.addEventListener("click", function () {
      el.q.value = ""; setMode(false); el.q.focus();
    });
    if (el.expandAll) el.expandAll.addEventListener("click", function () {
      if (!CATALOG) return;
      /* 展开到大类 + 工艺组 + 系列 + 功能 级（路数保持折叠，避免一次涌出 670 行） */
      CATALOG.cats.forEach(function (c) {
        openCats[c.key] = true;
        (c.procs || []).forEach(function (p) {
          if (p.name) openProcs[c.key + "|" + p.name] = true;
          (p.series || []).forEach(function (s) {
            openSeries[c.key + "|" + s.name] = true;
            (s.funcs || []).forEach(function (f) {
              openFuncs[c.key + "|" + s.name + ">" + f.name] = true;
            });
          });
        });
      });
      renderCatalog();
    });
    if (el.collapseAll) el.collapseAll.addEventListener("click", function () {
      openCats = Object.create(null); openProcs = Object.create(null);
      openSeries = Object.create(null); openFuncs = Object.create(null);
      openSers = Object.create(null);
      renderCatalog();
    });
    if (el.toggleAll) el.toggleAll.addEventListener("click", function () {
      el.q.value = ""; if (el.filterBar) el.filterBar.classList.remove("hidden"); renderList(DATA.products, DATA.products.length + " 个芯祥型号");
    });
  }

  function init() {
    ["q", "resultBar", "resultSummary", "resultCount", "clearBtn", "filterBar",
    "toggleAll", "results", "statModels", "statSpecs",
    "meta", "catalogMode", "searchMode", "catTree", "catCount",
     "expandAll", "collapseAll", "crumb", "pageBody"].forEach(function (id) { el[id] = $(id); });
    if (!el.results) return;
    bind();
    bindTree();
    boot();
    setupBackToTop();
  }

  /* 回到顶部：目录树/栏目页滚动超过一屏时出现 */
  function setupBackToTop() {
    var btn = document.getElementById("toTop");
    if (!btn) return;
    var ticking = false;
    function update() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      btn.classList.toggle("show", y > 600);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
