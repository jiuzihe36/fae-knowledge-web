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

  /* ---- 无障碍：目录树焦点保持 + 结果计数播报 ---- */
  /* 重绘前记录焦点节点的「结构指纹」（标签 + data-* 标识），重绘后按指纹找回同一节点。
     只比标签和数据属性、不比 class：hit/open 这类 class 会随重绘变化，不能参与比对。 */
  var TREE_FOCUS_ATTRS = ["data-cat", "data-proc", "data-path", "data-func",
                          "data-ser", "data-model", "data-series"];
  function treeFocusSig(node) {
    if (!node || node === document.body || !el.catTree || !el.catTree.contains(node)) return "";
    var head = String(node.tagName || "").toLowerCase();
    var parts = [];
    TREE_FOCUS_ATTRS.forEach(function (a) {
      var v = node.getAttribute(a);
      if (v != null) parts.push(a + "=" + v);
    });
    return parts.length ? head + "|" + parts.join("|") : "";
  }
  /* 焦点还原：节点还在且可见 → 还原；被折叠/筛掉 → 交还树容器（别让焦点掉回 body） */
  function treeRestoreFocus(sig) {
    var root = el.catTree;
    if (!root || !sig) return;
    var nodes = root.querySelectorAll("[data-cat],[data-model],[data-series]");
    for (var i = 0; i < nodes.length; i++) {
      if (treeFocusSig(nodes[i]) === sig) {
        if (nodes[i].offsetWidth || nodes[i].offsetHeight) { focusQuiet(nodes[i]); return; }
        break;
      }
    }
    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    focusQuiet(root);
  }
  function focusQuiet(node) {
    if (!node || !node.focus) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) {} }
  }
  /* 结果计数播报：页面没有 #a11yLive 时静默跳过 */
  function announce(msg) {
    var live = document.getElementById("a11yLive");
    if (live) live.textContent = msg;
  }

  function renderCatalog() {
    if (!CATALOG || !el.catTree) return;
    /* 整棵子树会被重建：先记下键盘用户在哪个节点上 */
    var focusSig = treeFocusSig(document.activeElement);
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
    treeRestoreFocus(focusSig);
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

    /* 复制参数：型号 + 元信息 + 电气参数全表（从当前抽屉 DOM 抓，不重复拉数据） */
    var copyAllBtn = document.getElementById("copyAllBtn");
    if (copyAllBtn) copyAllBtn.addEventListener("click", function () {
      var modelEl = document.getElementById("detailModel");
      var metaEl = document.getElementById("detailMeta");
      var head = "型号：" + ((modelEl && modelEl.textContent) || "").trim();
      var meta = (metaEl && metaEl.innerText || "")
        .split("\n").map(function (x) { return x.trim(); })
        .filter(function (x) { return x; }).join("\n");
      var rows = [].slice.call(document.querySelectorAll("#specTable tbody tr")).map(function (tr) {
        var c = tr.querySelectorAll("td");
        if (c.length !== 2) return "";
        var k = (c[0].innerText || "").trim(), v = (c[1].innerText || "").trim();
        return k && v ? k + "：" + v : "";
      }).filter(function (x) { return x; });
      var txt = head + (meta ? "\n" + meta : "") +
        (rows.length ? "\n\n【电气参数】\n" + rows.join("\n") : "");
      var done = function () {
        copyAllBtn.textContent = "已复制";
        setTimeout(function () { copyAllBtn.textContent = "复制参数"; }, 1400);
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
        var page = a.getAttribute("data-page");
        if (!page) return;          // 无 data-page 的是站外/整页跳转，走浏览器默认导航
        e.preventDefault();
        goPage(page);
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
      if (card) { toggleAppCard(card); return; }
    });

    /* 场景卡键盘可达：Enter / Space 与点击同效（卡片内星标、型号按钮各有自己的行为，不抢） */
    if (el.pageBody) el.pageBody.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("button, a")) return;
      var card = t.closest(".app-card");
      if (!card) return;
      e.preventDefault();
      toggleAppCard(card);
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
      announce("共 " + (CATALOG ? CATALOG.total : 0) + " 款");
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
    announce("共 " + hits + " 款");
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
      /* 只有技术文档页在场时才接管（.doc-th 由栏目页注入，护栏防串页接管） */
      if (th && PAGES.docs && document.getElementById("docList")) {
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
      announce("共 " + list.length + " 款");
    });

    /* 应用场景页筛选（场景名 / 型号 / 功能任一命中） */
    if (el.pageBody) el.pageBody.addEventListener("input", function (e) {
      if (e.target.id !== "appQ" || !PAGES.apps) return;
      var q = e.target.value;
      var grid = document.getElementById("appGrid");
      var cnt = document.getElementById("appCount");
      var shown = appCardsHtml(PAGES.apps.items, q);
      if (grid) grid.innerHTML = shown;
      var n = q ? (grid ? grid.querySelectorAll(".app-card").length : 0) : PAGES.apps.items.length;
      if (cnt) {
        cnt.textContent = q ? n + " / " + PAGES.apps.items.length + " 个场景" : PAGES.apps.items.length + " 个场景";
      }
      announce("共 " + n + " 个场景");
    });
    /* 选型表：下拉/搜索/导出（2026-11-06） */
    document.addEventListener("input", function (e) {
      if (e.target.id !== "selQ" || !PAGES.selector) return;
      SEL_STATE.q = e.target.value.trim();
      selRefresh();
    });
    document.addEventListener("change", function (e) {
      var id = e.target.id;
      if (id !== "selV" && id !== "selP" && id !== "selL") return;
      if (!PAGES.selector) return;
      if (id === "selV") SEL_STATE.v = e.target.value;
      if (id === "selP") SEL_STATE.p = e.target.value;
      if (id === "selL") SEL_STATE.l = e.target.value;
      selRefresh();
    });
    document.addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest("th.sortable") : null;
      if (th) {
        e.preventDefault();
        var k = th.getAttribute("data-sort");
        if (SEL_SORT.key === k) SEL_SORT.dir = -SEL_SORT.dir;
        else { SEL_SORT.key = k; SEL_SORT.dir = 1; }
        selRefresh();
        return;
      }
      if (e.target.id === "selCsv") { e.preventDefault(); selExportCsv(); return; }
      if (e.target.id === "cmpOpen") { e.preventDefault(); cmpOpen(e.target); return; }
      if (e.target.id === "cmpClear") { e.preventDefault(); cmpClear(); return; }
      if (e.target.id === "cmpClose" || e.target.hasAttribute("data-cmp-close")) { e.preventDefault(); cmpClose(); return; }
    });
    document.addEventListener("change", function (e) {
      if (!e.target.classList || !e.target.classList.contains("cmp-ck")) return;
      var m = e.target.getAttribute("data-cmp");
      if (e.target.checked) {
        if (CMP_SEL.length >= 4) { e.target.checked = false; window.alert("最多对比 4 款"); return; }
        if (CMP_SEL.indexOf(m) < 0) CMP_SEL.push(m);
      } else {
        CMP_SEL = CMP_SEL.filter(function (x) { return x !== m; });
      }
      cmpRenderBar();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { cmpClose(); return; }
      if (e.key !== "Tab") return;
      /* 弹层可见时把 Tab/Shift+Tab 圈在 .cmp-panel 内 */
      var m = document.getElementById("cmpModal");
      if (!m || m.classList.contains("hidden")) return;
      var panel = m.querySelector(".cmp-panel");
      if (!panel) return;
      var stops = cmpTabStops(panel);
      var act = document.activeElement;
      if (!stops.length) { e.preventDefault(); focusQuiet(panel); return; }
      var first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey) {
        if (act === first || act === panel || !panel.contains(act)) {
          e.preventDefault(); focusQuiet(last);
        }
      } else if (act === last || !panel.contains(act)) {
        e.preventDefault(); focusQuiet(first);
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
  var PAGES = { apps: null, docs: null, quality: null, selector: null, updates: null };

  function loadPage(name) {
    if (name === 'selector') { PAGES.selector = true; renderPage('selector'); return; }  /* 选型表直接用 DATA.products，不加载 JSON */
    var f = name === 'apps' ? 'apps.json' : name === 'docs' ? 'docs.json'
          : name === 'updates' ? 'recent.json' : 'quality.json';
    if (PAGES[name]) { renderPage(name); return; }
    loadJson("./data/" + f).then(function (d) { PAGES[name] = d; renderPage(name); });
  }

  function pageShell(title, sub, body) {
    return '<div class="cat-hero"><h2>' + esc(title) + "</h2>" +
      (sub ? "<p>" + esc(sub) + "</p>" : "") + "</div>" + (body || "");
  }

  /* ---- 应用指南卡片（guides.json 由 scripts/build_guides.py 生成） ---- */
  function guideListHtml(g) {
    if (!g || !g.items || !g.items.length) return '<span class="muted">暂无指南</span>';
    return g.items.map(function (x) {
      return '<a class="guide-card" href="' + esc(x.url) + '">' +
        '<b>' + esc(x.title) + '</b>' +
        '<span>' + esc(x.desc ? x.desc.slice(0, 66) + (x.desc.length > 66 ? "…" : "") : "") + '</span>' +
        '<em>' + x.scenes.length + ' 个场景 · ' + x.words + ' 字</em></a>';
    }).join("");
  }

  function loadGuideList() {
    var box = document.getElementById("guideBox");
    if (!box) return;
    if (PAGES.guides) { box.innerHTML = guideListHtml(PAGES.guides); return; }
    loadJson("./data/guides.json").then(function (g) {
      PAGES.guides = g;
      var b2 = document.getElementById("guideBox");
      if (b2) b2.innerHTML = guideListHtml(g);
    });
  }

  /* ---- 选型表：电压/封装/产品线筛选 + CSV 导出（2026-11-06） ---- */
  var SEL_V_BUCKETS = ["≤1.2 V", "1.2–1.8 V", "1.8–2.7 V", "2.7–3.6 V", "≥3.6 V"];
  var SEL_P_FAMS = ["SOT", "SOP", "TSSOP", "SSOP", "DFN", "QFN", "WLCSP", "BGA", "其他"];
  var SEL_LINES = ["逻辑", "电平转换", "模拟开关"];
  var SEL_STATE = { v: "", p: "", l: "", q: "" };

  function selVbucket(v) {
    var m = String(v || "").match(/([\d.]+)\s*V/i);
    if (!m) return "未标注";
    var n = parseFloat(m[1]);
    if (isNaN(n)) return "未标注";
    if (n <= 1.2) return "≤1.2 V";
    if (n < 1.8) return "1.2–1.8 V";
    if (n < 2.7) return "1.8–2.7 V";
    if (n < 3.6) return "2.7–3.6 V";
    return "≥3.6 V";
  }

  function selPfam(pk) {
    var n = String(pk || "").toUpperCase();
    if (/^SOT/.test(n)) return "SOT";
    if (/^TSSOP/.test(n)) return "TSSOP";
    if (/^SSOP/.test(n)) return "SSOP";
    if (/^SOP/.test(n)) return "SOP";
    if (/^DFN/.test(n)) return "DFN";
    if (/^QFN/.test(n)) return "QFN";
    if (/^WLCSP|^WCSP/.test(n)) return "WLCSP";
    if (/^BGA/.test(n)) return "BGA";
    return "其他";
  }

  function selLine(sr) {
    var x = String(sr || "").toUpperCase();
    if (x === "EXS") return "电平转换";
    if (x === "EMS" || x === "EL" || x === "EMBMS") return "模拟开关";
    return "逻辑";
  }

  function selRows() {
    return (DATA.products || []).filter(function (p) {
      if (SEL_STATE.v && selVbucket(p.voltage) !== SEL_STATE.v) return false;
      if (SEL_STATE.p && selPfam(p.package) !== SEL_STATE.p) return false;
      if (SEL_STATE.l && selLine(p.series) !== SEL_STATE.l) return false;
      if (SEL_STATE.q) {
        var hay = [p.model, p.function, p.function_detail, p.series, p.package].join(" ").toLowerCase();
        if (hay.indexOf(SEL_STATE.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  /* 可靠性小表：等级 / 型号数 / 占比 */
  function relTable(title, rows, tot) {
    return '<div class="rel-card"><div class="rel-title">' + esc(title) + '</div>' +
      '<table class="param q-tbl"><thead><tr><th>等级</th><th class="num">型号数</th><th class="num">占比</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="k">' + esc(r.k) + '</td><td class="v num">' + r.n +
          '</td><td class="v num">' + (r.n / tot * 100).toFixed(1) + '%</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  var SEL_SORT = { key: "", dir: 1 };

  function selSortKey(p, key) {
    if (key === "model") return p.model || "";
    if (key === "fn") return (p.function_detail || p.function || "");
    if (key === "series") return p.series || "";
    if (key === "pkg") return p.package || "";
    if (key === "vcc") {
      var vs = String(p.voltage || "");
      if (!vs || vs.indexOf("未标注") >= 0) return 999;   /* 未标注永远排最后 */
      var m = vs.match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : 999;
    }
    if (key === "temp") return p.temp_range || "";
    if (key === "line") return selLine(p.series);
    return "";
  }

  function applySelSort(rows) {
    if (!SEL_SORT.key) return rows;
    var k = SEL_SORT.key, d = SEL_SORT.dir;
    return rows.slice().sort(function (a, b) {
      var x = selSortKey(a, k), y = selSortKey(b, k);
      if (typeof x === "number" && typeof y === "number") return (x - y) * d;
      return String(x).localeCompare(String(y), "zh-CN") * d;
    });
  }

  function selTableHtml(rows) {
    if (!rows.length) return '<div class="empty">没有匹配的型号，请放宽筛选条件</div>';
    rows = applySelSort(rows);
    var _so = SEL_SORT.key ? (SEL_SORT.dir > 0 ? " ▲" : " ▼") : "";
    var head = '<caption class="sr-only">型号选型表，可按列排序，勾选可对比</caption>' +
      '<thead><tr><th class="cmp-col">对比</th>' +
      '<th class="sortable" data-sort="model">型号' + (_so && SEL_SORT.key === "model" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="fn">功能' + (_so && SEL_SORT.key === "fn" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="series">系列' + (_so && SEL_SORT.key === "series" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="pkg">封装' + (_so && SEL_SORT.key === "pkg" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="vcc">工作电压' + (_so && SEL_SORT.key === "vcc" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="temp">工作温度' + (_so && SEL_SORT.key === "temp" ? _so : "") + '</th>' +
      '<th class="sortable" data-sort="line">产品线' + (_so && SEL_SORT.key === "line" ? _so : "") + '</th></tr></thead>';
    var body = rows.slice(0, 400).map(function (p) {
      return '<tr><td class="cmp-col"><input type="checkbox" class="cmp-ck" aria-label="对比 ' + esc(p.model) + '" data-cmp="' + esc(p.model) + '"' +
        (CMP_SEL.indexOf(p.model) >= 0 ? ' checked' : '') + '></td>' +
        '<td class="k">' + esc(p.model) + '</td>' +
        '<td>' + esc(p.function_detail || p.function || "") + '</td>' +
        '<td>' + esc(p.series || "") + '</td>' +
        '<td>' + esc(p.package || "") + '</td>' +
        '<td class="num">' + esc(p.voltage || "") + '</td>' +
        '<td class="num">' + esc(p.temp_range || "") + '</td>' +
        '<td>' + esc(selLine(p.series)) + '</td></tr>';
    }).join("");
    return '<table class="sel-tbl"><colgroup><col style="width:6%"><col style="width:15%"><col style="width:23%"><col style="width:8%"><col style="width:12%"><col style="width:12%"><col style="width:13%"><col style="width:11%"></colgroup>' +
      head + '<tbody>' + body + '</tbody></table>' +
      (rows.length > 300 ? '<p class="page-note">显示前 300 行（共 ' + rows.length + ' 行），请用筛选或搜索缩小范围。</p>' : '');
  }

  function selRefresh() {
    var rows = selRows();
    var box = document.getElementById("selTable");
    if (box) box.innerHTML = selTableHtml(rows);
    cmpRenderBar();
    var c = document.getElementById("selCount");
    if (c) c.textContent = rows.length + " 款";
  }

  /* ---- 选型对比：勾选 2–4 款并排比较 ---- */
  var CMP_SEL = [];

  function cmpRenderBar() {
    var bar = document.getElementById("cmpBar");
    if (!bar) return;
    if (!CMP_SEL.length) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    var c = document.getElementById("cmpCount");
    if (c) c.textContent = "已选 " + CMP_SEL.length + " 款";
  }

  var CMP_DATA = null;

  function cmpAppendSpecs(picked) {
    var t = document.querySelector(".cmp-tbl tbody");
    if (!t || !CMP_DATA) return;
    if (t.querySelector("tr[data-spec]")) return;   /* 已追加过，避免重复 */
    var rows = [
      ["工作电压（推荐）", "vcc"],
      ["传输延时 tpd", "tpd"],
      ["驱动电流", "drive"],
      ["导通电阻 Ron", "ron"],
      ["带宽", "bw"],
      ["静态电流 ICC", "icc"],
      ["工作温度（表值）", "tamb"]
    ];
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-spec", "1");
      var html = '<td class="k">' + esc(r[0]) + '</td>';
      picked.forEach(function (p) {
        var v = (CMP_DATA[p.model] || {})[r[1]] || "—";
        html += "<td>" + esc(v) + "</td>";
      });
      tr.innerHTML = html;
      t.appendChild(tr);
    });
  }

  /* 对比弹层焦点管理：打开记触发元素，关闭归还；Tab 在面板内循环 */
  var CMP_LAST_TRIGGER = null;

  /* 面板内可聚焦元素（Tab 循环边界；tabindex="-1" 的面板自身不算停靠点） */
  function cmpTabStops(root) {
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
              'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return [].slice.call(root.querySelectorAll(sel)).filter(function (n) {
      return !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
    });
  }

  function cmpOpen(trigger) {
    if (CMP_SEL.length < 2) { window.alert("请至少勾选 2 款型号"); return; }
    if (CMP_SEL.length > 4) { window.alert("最多同时对比 4 款"); return; }
    var picked = (DATA.products || []).filter(function (p) { return CMP_SEL.indexOf(p.model) >= 0; });
    if (picked.length < 2) return;
    var rows = [
      ["型号", function (p) { return p.model; }],
      ["功能", function (p) { return p.function_detail || p.function || ""; }],
      ["系列", function (p) { return p.series || ""; }],
      ["封装", function (p) { return p.package || ""; }],
      ["工作电压", function (p) { return p.voltage || ""; }],
      ["工作温度", function (p) { return p.temp_range || ""; }],
      ["产品线", function (p) { return selLine(p.series); }],
      ["应用场景", function (p) { return (p.applications_domains || []).join("、"); }],
      ["规格书", function (p) { return p.source_label || ""; }]
    ];
    var html = '<table class="cmp-tbl"><thead><tr><th>属性</th>' +
      picked.map(function (p) { return "<th>" + esc(p.model) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td class=\"k\">" + esc(r[0]) + "</td>" +
          picked.map(function (p) { return "<td>" + esc(String(r[1](p) == null ? "" : r[1](p))) + "</td>"; }).join("") +
          "</tr>";
      }).join("") + "</tbody></table>";
    var box = document.getElementById("cmpBody");
    if (box) box.innerHTML = html;
    /* 关键参数行：懒加载 79KB 的 specs_cmp.json（不拉 6.8MB 全量） */
    if (CMP_DATA) {
      cmpAppendSpecs(picked);
    } else {
      loadJson("./data/specs_cmp.json").then(function (sd) {
        CMP_DATA = sd || {};
        if (document.getElementById("cmpBody")) cmpAppendSpecs(picked);
      });
    }
    var m = document.getElementById("cmpModal");
    if (!m) return;
    var act = trigger || document.activeElement;
    if (!act || act === document.body) act = document.getElementById("cmpOpen");
    CMP_LAST_TRIGGER = act;
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
    var panel = m.querySelector(".cmp-panel");
    if (panel) {
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      if (!panel.hasAttribute("role")) panel.setAttribute("role", "dialog");
      if (!panel.hasAttribute("aria-modal")) panel.setAttribute("aria-modal", "true");
      if (!panel.hasAttribute("aria-label")) panel.setAttribute("aria-label", "型号对比");
      focusQuiet(panel);
    }
  }

  function cmpClose() {
    var m = document.getElementById("cmpModal");
    /* 本来就关着：直接返回（否则页面里每次 Esc 都会把焦点拽走） */
    if (!m || m.classList.contains("hidden")) return;
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
    var t = CMP_LAST_TRIGGER;
    CMP_LAST_TRIGGER = null;
    if (t && t !== document.body && t.focus && document.contains(t)) { focusQuiet(t); return; }
    /* 触发点被重绘抹掉：退回到对比条入口（可见才给，别把焦点塞进隐藏元素） */
    var open = document.getElementById("cmpOpen");
    if (open && (open.offsetWidth || open.offsetHeight)) focusQuiet(open);
  }

  function cmpClear() {
    CMP_SEL = [];
    var cks = document.querySelectorAll(".cmp-ck");
    for (var i = 0; i < cks.length; i++) cks[i].checked = false;
    cmpRenderBar();
  }

  function selExportCsv() {
    var rows = selRows();
    var head = ["型号", "功能", "功能详细", "系列", "封装", "工作电压", "工作温度", "产品线", "规格书"];
    var lines = [head.join(",")];
    rows.forEach(function (p) {
      var cells = [p.model, p.function, p.function_detail, p.series, p.package, p.voltage, p.temp_range, selLine(p.series), p.source_label];
      lines.push(cells.map(function (x) {
        x = String(x == null ? "" : x);
        return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
      }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "芯祥选型表_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
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

  /* 场景卡展开 / 收起：鼠标点击、Enter、Space 共用同一套逻辑，并同步 aria-expanded */
  function toggleAppCard(card) {
    if (!card) return;
    var body = card.querySelector(".app-models");
    if (!body) return;
    var nowHidden = body.classList.toggle("hidden");
    card.classList.toggle("open", !nowHidden);
    card.setAttribute("aria-expanded", nowHidden ? "false" : "true");
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
      return '<div class="app-card' + (fav ? " fav" : "") + '" role="button" tabindex="0" ' +
        'aria-expanded="false" data-app="' + esc(it.name) + '">' +
        '<div class="app-head"><span class="app-name">' + esc(it.name) + "</span>" +
        '<button class="app-star" type="button" data-fav="' + esc(it.name) + '" ' +
        'title="' + (fav ? "取消常用" : "标记常用") + '" aria-label="标记常用">' +
        (fav ? "★" : "☆") + "</button>" +
        '<span class="app-caret">▸</span></div>' +
        (it.desc ? '<div class="app-desc">' + esc(it.desc) + '</div>' : '') +
        '<div class="app-count">' + it.count + " 款型号 · 点击展开</div>" +
        '<div class="app-models hidden">' + appModelsHtml(it.models) + "</div></div>";
    }).join("");
  }

  /* ---- 封装与可靠性页小工具 ---- */
  function qCard(n, label) {
    return '<div class="q-card"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>';
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
        '<input id="appQ" class="page-search" type="search" aria-label="按场景名或型号筛选应用场景" ' +
        'placeholder="按场景名 / 型号 / 功能筛选（如 USB、I2C、缓冲）" autocomplete="off">' +
        '<span id="appCount" class="count-pill">' + d.total + " 个场景</span></div></div>";
      html += '<div id="appGrid" class="app-grid">' + appCardsHtml(d.items, PENDING_APP_Q) + "</div>";
      /* 应用指南（14 篇，来自 wiki applications，由 build_guides.py 渲染成 guides/ 静态页） */
      html += '<h3 class="page-h3">应用指南</h3><div id="guideBox" class="guide-list">' +
        '<span class="muted">加载中…</span></div>';
    }

    if (name === "docs") {
      var st = d.stats;
      var dsN = st.ds_files || st.with_ds;
      var dsNote = st.ds_latest ? " · 版本/日期照录规格书修订记录（最新发布 " + st.ds_latest + "）" : "";
      html += pageShell("技术文档",
        "规格书 " + dsN + " 份 · 覆盖全部 " + st.total + " 款型号 · 引脚图 " + st.with_pin + " 份" + dsNote);
      html += '<div class="doc-sticky"><div class="doc-tools">' +
        '<input id="docQ" class="page-search" type="search" aria-label="按型号、功能、系列或封装筛选规格书" ' +
        'placeholder="按型号 / 功能 / 系列 / 封装筛选" autocomplete="off">' +
        '<button id="docAllBtn" class="btn-ghost" type="button">显示全部</button>' +
        '<span id="docCount" class="count-pill">' + d.items.length + " 款 · 显示前 200</span></div>" +
        docHeadHtml() + '</div>';
      html += '<div id="docList" class="doc-list">' +
        d.items.slice(0, 200).map(function(x){return docRow(x, "");}).join("") + "</div>";
    }

    if (name === "updates") {
      var rn = d || { buckets: [], total: 0, latest: "" };
      html += pageShell("更新记录",
        "共 " + rn.total + " 份规格书 · 最新发布 " + (rn.latest || "—") + " · 按规格书修订日期分组");
      html += '<p class="page-note">下列日期为规格书修订记录里的 <b>Rev. 日期</b>，不是上传日期。' +
        '同一份规格书覆盖多个封装型号时会合并显示。需要具体版本号与变更内容，请打开对应规格书查看修订历史页。</p>';
      var _up = rn.buckets || [];
      _up.forEach(function (b) {
        if (!b.items || !b.items.length) return;
        html += '<h3 class="page-h3">' + esc(b.label) + '（' + b.items.length + ' 份）</h3>';
        html += '<table class="param q-tbl"><thead><tr><th>修订日期</th><th>版本</th><th>系列</th><th>功能</th><th class="num">型号数</th><th>型号</th></tr></thead><tbody>' +
          b.items.map(function (x) {
            var ms = (x.models || []);
            var show = ms.slice(0, 6).join("、") + (ms.length > 6 ? " 等 " + ms.length + " 款" : "");
            return '<tr><td class="k">' + esc(x.dd) + '</td><td>' + esc(x.dv) + '</td><td>' + esc(x.se) + '</td>' +
              '<td>' + esc(x.fn) + '</td><td class="v num">' + ms.length + '</td><td>' + esc(show) + '</td></tr>';
          }).join("") + '</tbody></table>';
      });
    }

    if (name === "selector") {
      html += pageShell("选型表", "共 " + (DATA.products || []).length + " 款型号 · 按电压 / 封装 / 产品线筛选，可导出 CSV");
      html += '<div class="doc-sticky"><div class="doc-tools">' +
        '<select id="selV" class="sel-dd"><option value="">最低工作电压</option>' +
        SEL_V_BUCKETS.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join("") +
        '</select>' +
        '<select id="selP" class="sel-dd"><option value="">全部封装</option>' +
        SEL_P_FAMS.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join("") +
        '</select>' +
        '<select id="selL" class="sel-dd"><option value="">全部产品线</option>' +
        SEL_LINES.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join("") +
        '</select>' +
        '<input id="selQ" class="page-search" type="search" aria-label="按型号或功能搜索选型表" placeholder="型号 / 功能关键词" autocomplete="off">' +
        '<button id="selCsv" class="btn-ghost" type="button">⬇ 导出 CSV</button>' +
        '<span id="selCount" class="count-pill">' + selRows().length + ' 款</span></div></div>' +
        '<div id="selTable">' + selTableHtml(selRows()) + '</div>' +
        '<div id="cmpBar" class="cmp-bar hidden"><span id="cmpCount"></span>' +
        '<button id="cmpOpen" class="btn-ghost" type="button">对比所选</button>' +
        '<button id="cmpClear" class="btn-ghost" type="button">清空</button></div>' +
        '<div id="cmpModal" class="cmp-modal hidden" aria-hidden="true">' +
        '<div class="cmp-mask" data-cmp-close></div>' +
        '<div class="cmp-panel"><div class="cmp-head"><h3>型号对比</h3>' +
        '<button id="cmpClose" class="cmp-x" type="button" aria-label="关闭">×</button></div>' +
        '<div id="cmpBody" class="cmp-body"></div></div></div>';
    }

    if (name === "quality") {
      var tot = d.total || 1;
      html += pageShell("封装与可靠性",
        "温度等级 · 封装尺寸 · 产品状态，共 " + d.total + " 款型号" +
        (d.generated ? " · 数据更新 " + esc(d.generated) : ""));

      /* ① 概览卡片 */
      var _draftN = ((d.status || []).filter(function (x) { return /Draft/i.test(x.k); })[0] || {}).n || 0;
      html += '<div class="q-overview">' +
        qCard(d.total, "在库型号") +
        qCard(d.package.length, "封装形式") +
        qCard(d.temp.length, "温度等级") +
        qCard(_draftN, "Draft 未量产") +
        '</div>';

      /* ② 工作温度等级（含占比条） */
      html += '<h3 class="page-h3">工作温度等级</h3>' +
        '<table class="param q-tbl"><thead><tr><th>温度范围</th><th class="num">型号数</th><th class="num">占比</th><th class="bar-col">分布</th></tr></thead><tbody>' +
        d.temp.map(function (t) {
          var pct = t.n / tot * 100;
          return '<tr><td class="k">' + esc(t.k) + '</td><td class="v num">' + t.n +
            '</td><td class="v num">' + pct.toFixed(1) + '%</td>' +
            '<td class="bar-col"><span class="q-bar" style="width:' + Math.max(pct, 1).toFixed(1) + '%"></span></td></tr>';
        }).join("") + "</tbody></table>" +
        '<p class="page-note">温度范围取自各规格书 <b>Recommended Operating Conditions</b> 的 Tamb（-40 °C 起），全库只有两档：' +
        d.temp.map(function (t) { return '<b>' + esc(t.k.replace(/\s*°C/g, '℃').replace(/ to /, '～')) + '</b>（' + t.n + ' 款）'; }).join(' 与 ') +
        '。同系列不同封装可能共用同一档，选型以该型号规格书为准。</p>';

      /* ③ 产品线分布 */
      var _lines = d.product_line || d.logic_type || [];
      html += '<h3 class="page-h3">产品线分布</h3>' +
        '<table class="param q-tbl"><thead><tr><th>产品线</th><th class="num">型号数</th><th class="num">占比</th></tr></thead><tbody>' +
        _lines.map(function (t) {
          return '<tr><td class="k">' + esc(t.k) + '</td><td class="v num">' + t.n +
            '</td><td class="v num">' + (t.n / tot * 100).toFixed(1) + '%</td></tr>';
        }).join("") + "</tbody></table>";

      /* ③b 产品状态（正式版 / Draft） */
      if (d.status && d.status.length) {
        html += '<h3 class="page-h3">产品状态</h3>' +
          '<table class="param q-tbl"><thead><tr><th>状态</th><th class="num">型号数</th><th class="num">占比</th></tr></thead><tbody>' +
          d.status.map(function (t) {
            return '<tr><td class="k">' + esc(t.k) + '</td><td class="v num">' + t.n +
              '</td><td class="v num">' + (t.n / tot * 100).toFixed(1) + '%</td></tr>';
          }).join("") + "</tbody></table>" +
          '<p class="page-note"><b>Draft</b> 表示该型号规格书仍为草稿版、尚未量产：可送样评估与参数对标，<b>不承诺量产交期</b>，报价前须向产品线确认。</p>';
      }

      /* ③c 可靠性：ESD / Latch-up（数据来自 data/esd.json，gen_pages 聚合） */
      if (d.reliability) {
        var rl = d.reliability;
        html += '<h3 class="page-h3">可靠性：ESD 与 Latch-up</h3>';
        html += '<p class="page-note">数据取自各规格书 <b>Features / ESD protection</b> 段（' + rl.covered + ' / ' + rl.total + ' 款有明确数值）；' +
          '「规格书未列」表示该份规格书<b>已逐份全文核实</b>确实未给出该项（不是抓取遗漏），<b>不代表无防护</b>——' +
          'EnergyMath 这套模拟开关模板本身没有 Reliability/ESD 章节。ESD 分档按 JEDEC：HBM Class 2 = 2–4 kV、Class 3A = 4–8 kV、Class 3B ≥ 8 kV；CDM Class C3 ≥ 500 V。</p>';
        html += '<div class="rel-wrap">' +
          relTable("HBM（人体放电）", rl.hbm, tot) +
          relTable("CDM（器件充电）", rl.cdm, tot) +
          relTable("Latch-up（闩锁）", rl.latch, tot) +
          '</div>';
      }

      /* ④ 型号尾缀对照（紧凑：主封装 + 其余折叠） */
      if (d.suffix && d.suffix.length) {
        html += '<h3 class="page-h3">型号尾缀对照（' + d.suffix.length + ' 种）</h3>' +
          '<p class="page-note">尾缀标识封装形式，具体引脚数由型号中间的数字决定。' +
          '例：<span class="mono">EM74LVC1G00<b>GV</b></span> = SOT-23-5</p>' +
          '<table class="param q-tbl sfx-tbl"><thead><tr><th>尾缀</th><th>封装系列</th><th>说明</th><th class="num">型号数</th></tr></thead><tbody>' +
          d.suffix.map(function (s) {
            return '<tr><td class="k"><span class="sfx-badge">' + esc(s.sfx) + '</span></td>' +
              '<td class="v mono sm">' + esc(s.family) + "</td>" +
              '<td class="v sm">' + esc(s.desc) + "</td>" +
              '<td class="v num">' + s.n + "</td></tr>";
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
        }).join("")) + "</tbody></table>" +
        '<p class="page-note">本体尺寸与高度取自各规格书 <b>Ordering Information</b> 描述行或 <b>Package Outline</b> 尺寸表；<b>pitch</b> 优先取规格书尺寸表的 e 值（BSC/TYP），SOT23 0.95、SOT353/363 0.65、SOT553/563 0.5、SOP/SSOP 1.27、TSSOP 0.65、VSSOP/MSOP 0.5 mm 为标准外形族的封装标准值。注意 <b>DFN0.8x0.8-4L</b> 的订购描述写 5 pins 而封装图只有 4 个焊盘，表内按规格书描述录引脚数，量产前须向产品线确认。</p>';

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
    if (name === "apps") loadGuideList();
    window.scrollTo(0, 0);
  }

  function filterDocs(q) {
    if (!PAGES.docs) return [];
    var terms = norm(q).split(/\s+/).filter(Boolean);      /* 多关键词 = 且 */
    var list = !terms.length ? PAGES.docs.items.slice() : PAGES.docs.items.filter(function (it) {
      var hay = norm(it.m + " " + it.fn + " " + it.se + " " + it.pk + " " + (it.v || "") + " " + (it.t || "") +
                     " " + (it.dv || "") + " " + (it.dd || ""));
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    return sortDocs(list);
  }

  /* 版本号比较键：V1.10 > V1.9（按数值分段，不按字符串） */
  function verKey(v) {
    return String(v == null ? "" : v).replace(/^V/i, "").split(".")
      .map(function (x) { return parseInt(x, 10) || 0; });
  }
  function cmpVer(a, b) {
    var x = verKey(a), y = verKey(b), n = Math.max(x.length, y.length);
    for (var i = 0; i < n; i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
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
      /* 规格书版本：按数值分段比较（V1.10 > V1.9） */
      if (k === "dv") return cmpVer(x, y) * dir;
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
    ['工作电压', 'v'], ['温度范围', 't'], ['工艺', 'lt'],
    ['规格书版本', 'dv'], ['更新日期', 'dd'], ['技术文档', 'ds'],
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
    var terms = String(kw).split(/\s+/).filter(Boolean).map(function (x) { return esc(x); });
    if (!terms.length) return t;
    terms.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp("(" + terms.map(function (x) {
      return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") + ")", "gi");
    return t.replace(re, '<mark class="doc-hl">$1</mark>');
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
      /* 规格书最新版本号 / 该版本发布日期（照录规格书修订记录） */
      '<span class="doc-dv" title="规格书最新版本">' + esc(it.dv || "—") + "</span>" +
      '<span class="doc-dd" title="该版本发布日期">' + esc(it.dd || "—") + "</span>" +
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
      var _on = a.getAttribute("data-page") === name;
      a.classList.toggle("on", _on);
      if (_on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    /* 深链接：切页写进 hash，便于把「选型表/应用/更新记录」的地址直接发人 */
    if (window.__xx && window.__xx.setHash) {
      window.__xx.setHash(name === "catalog" ? "" : "page=" + name);
    }
    var onA = document.querySelector(".band-in a.on");
    if (onA && onA.scrollIntoView) onA.scrollIntoView({ inline: "nearest", block: "nearest" });
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

  /* ---- 深链接（2026-11-06）：#model=型号 / #page=页面 / #scene=场景 ---- */
  var HASH_GUARD = false;

  function applyHash() {
    /* hash 里允许带 & 附加参数（如 #page=apps&t=123），只取第一段 */
    var h = (location.hash || "").replace(/^#/, "").split("&")[0];
    if (!h) return;
    var i = h.indexOf("=");
    if (i < 0) return;
    var k = h.slice(0, i), v = decodeURIComponent(h.slice(i + 1));
    if (k === "page") { goPage(v); return; }
    if (k === "model" && window.__xx && window.__xx.openByModel) { window.__xx.openByModel(v); return; }
    if (k === "scene" && window.__xx && window.__xx.goAppScene) { window.__xx.goAppScene(v); return; }
  }

  function setHash(h) {
    HASH_GUARD = true;
    try {
      if (history.replaceState) history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
      else location.hash = h;
    } catch (e) { /* 某些环境禁止改 URL，忽略 */ }
    setTimeout(function () { HASH_GUARD = false; }, 0);
  }

  window.__xx = window.__xx || {};
  window.__xx.setHash = setHash;
  window.__xx.applyHash = applyHash;
  window.addEventListener("hashchange", function () { if (!HASH_GUARD) applyHash(); });

  /* 跨文件桥接：详情抽屉里点「应用场景」可跳到应用页并筛出该场景 */
  /* 首屏应用 hash：数据是异步加载的，重试直到 products 就绪 */
  var _hashTries = 0;
  (function tryHash() {
    var ready = window.__xx && window.__xx.products && window.__xx.products.length;
    if (ready || _hashTries > 25) { applyHash(); return; }
    _hashTries++;
    setTimeout(tryHash, 200);
  })();

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
    initDetailCollapse();
  }

  /* 回到顶部：目录树/栏目页滚动超过一屏时出现 */
  /* 详情抽屉：区块折叠。窄屏默认只展开第一个可见区块，其余收起，减少长滚动。
     注意：不要用 subtree 观察 class —— 自己改 class 会再次触发观察，页面会卡死；
     改为「打开时定时重算几次」的安全写法，且 apply 幂等（无变化就不改，避免回环）。 */
  function initDetailCollapse() {
    var panel = document.getElementById("detail");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
      var h = e.target.closest(".collapsible > h3");
      if (!h || e.target.closest("a,button")) return;
      h.parentElement.classList.toggle("collapsed");
    });
    function apply() {
      var secs = panel.querySelectorAll(".collapsible");
      var vis = [];
      secs.forEach(function (s) { if (!s.classList.contains("hidden")) vis.push(s); });
      /* 只有窄屏且可见区块多于一个时才收起后面的 */
      var narrow = window.innerWidth <= 720 && vis.length > 1;
      secs.forEach(function (s) {
        var idx = vis.indexOf(s);
        var want = narrow && idx > 0;
        if (s.classList.contains("collapsed") !== want) s.classList.toggle("collapsed", want);
      });
    }
    var timers = [];
    /* 图片区块是抽屉打开后异步填充、逐个从 hidden 变可见的，
       所以要错开多算几次（不做子树观察，避免自我变更回环把页面卡死） */
    var STEPS = [60, 300, 700, 1400, 2400];
    function schedule() {
      timers.forEach(clearTimeout);
      timers = STEPS.map(function (t) { return setTimeout(apply, t); });
    }
    var obs = new MutationObserver(function () {
      if (!panel.classList.contains("hidden")) schedule();
      else { timers.forEach(clearTimeout); }
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class"] });
    schedule();                                   /* 深链/已打开：立刻也算一次 */
    window.addEventListener("resize", schedule);  /* 旋屏 / 拉窗口 */
  }

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
