(function () {
  "use strict";

  /* =========================================================
   * 纯逻辑区（不依赖 DOM；node 可直接 require 测试）
   * ========================================================= */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/[&<>"']/g, function (ch) {
        const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return map[ch];
      });
  }

  function text(value) {
    return value == null || String(value).trim() === "" ? "-" : String(value);
  }

  /* 状态推导（不改 products.json）：Q100 优先，其次 Draft，其余 Product */

  function deriveStatus(item) {
    if (!item) return "Product";
    if (/-Q100/i.test(String(item.model || ""))) return "Q100";
    if (/Draft|Drft/i.test(String(item.source_label || ""))) return "Draft";
    return "Product";
  }

  function statusBadgeHtml(status, always) {
    if (!always && status === "Product") return "";
    const cls = status === "Draft" ? "draft" : status === "Q100" ? "q100" : "product";
    return '<span class="badge ' + cls + '">' + esc(status) + "</span>";
  }

  const MIN_PN = 5;

  const SPEC_KIND_ORDER = ["绝对最大", "推荐工作条件", "推荐", "静态", "动态", "交流特性", "特性", "其他"];

  function groupSpecs(specs) {
    const map = Object.create(null);
    const keys = [];
    (Array.isArray(specs) ? specs : []).forEach(function (s) {
      const k = s && s.kind ? String(s.kind).trim() : "其他";
      if (!(k in map)) { map[k] = []; keys.push(k); }
      map[k].push(s);
    });
    keys.sort(function (a, b) {
      const ia = SPEC_KIND_ORDER.indexOf(a);
      const ib = SPEC_KIND_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return keys.map(function (k) { return { kind: k, items: map[k] }; });
  }

  /* 数据层已不再预渲染 HTML（只留 param/value/kind），这里现算：
     先 esc() 转义，再把 VCC / VIH / Tamb 等转成下标，效果同旧 param_html/value_html。 */

  var SPEC_SUB_TOKENS = [
    "VCC", "VDD", "VSS", "VIH", "VIL", "VOH", "VOL", "VT+", "VT-", "VT−",
    "VI", "VO", "ICC", "IDD", "IOH", "IOL", "IIK", "IOK", "IOZ", "IOFF",
    "II", "IO", "Tamb"
  ];

  /* 长词在前，避免 VI 抢先吃掉 VIH；前后限定非英文字母，避免误伤单词（VCCI 等） */
  var SPEC_SUB_RE = new RegExp(
    "(^|[^A-Za-z])(" + SPEC_SUB_TOKENS.map(function (t) { return t.replace(/\+/g, "\\+"); }).join("|") + ")(?![A-Za-z])",
    "g"
  );

  function specSubMarkup(token) {
    if (token === "Tamb") return "T<sub>amb</sub>";
    if (token === "VT+") return "V<sub>T+</sub>";
    if (token === "VT-" || token === "VT−") return "V<sub>T−</sub>";
    if (token.charAt(0) === "V") return "V<sub>" + token.slice(1) + "</sub>";
    return "I<sub>" + token.slice(1) + "</sub>";
  }

  /* 已转义文本 → 下标化 */
  function specSubscript(escaped) {
    return String(escaped == null ? "" : escaped).replace(SPEC_SUB_RE, function (m, lead, token) {
      return lead + specSubMarkup(token);
    });
  }

  /* 参数名：spec 对象或原始字符串均可 */
  function renderParam(spec) {
    var raw = spec && typeof spec === "object" ? spec.param : spec;
    return specSubscript(esc(raw));
  }

  /* 参数值：转义 + 下标 + <strong>（与旧 value_html 的包裹一致） */
  function renderValue(spec) {
    var raw = spec && typeof spec === "object" ? spec.value : spec;
    return "<strong>" + specSubscript(esc(raw)) + "</strong>";
  }

  function specHtml(spec) {
    if (!spec) return "";
    const v = spec.value_html || renderValue(spec);
    let c = "";
    if (spec.conditions_html) {
      c = '<br><span class="spec-cond">[' + spec.conditions_html + "]</span>";
    } else if (spec.conditions) {
      c = '<br><span class="spec-cond">[' + esc(spec.conditions) + "]</span>";
    }
    return v + c;
  }

  const CMP_FIELDS = [
    ["function", "功能"],
    ["function_detail", "功能详细"],
    ["series", "系列"],
    ["package", "封装"],
    ["voltage", "工作电压"],
    ["temp_range", "工作温度"],
    ["logic_type", "逻辑类型"],
    ["description", "描述"]
  ];

  function buildHaystack(item) {
    const parts = [
      item.model,
      item.family,
      item.series,
      item.function,
      item.function_detail,
      item.description,
      item.package,
      item.logic_type,
      item.voltage,
      item.temp_range,
      item.source_label
    ];
    if (Array.isArray(item.specs)) {
      item.specs.forEach(function (spec) {
        parts.push(spec.param, spec.value, spec.source_label);
      });
    }
    return parts.join(" ").toLowerCase();
  }

  /* 测试用导出对象已移除（无任何脚本 require 本文件） */

if (typeof document === "undefined") return;

  /* =========================================================
   * DOM 层
   * ========================================================= */

  const THEME_KEY = "xs-theme";
  const RENDER_LIMIT = 500;

  const products = [];
  var INDEX = null;   /* data/index.json 原始对象（chunks_meta / items 等） */
  /* 竞品/P2P 数据已整体摘除 */
  let filtered = [];
  let debounceTimer = null;   /* 保留：历史变量，现由 unified.js 的 timer 承担 */

  const el = {
    meta: document.getElementById("meta"),
    statModels: document.getElementById("statModels"),
    statSpecs: document.getElementById("statSpecs"),
    themeBtn: document.getElementById("themeBtn"),
    q: document.getElementById("q"),
    clearBtn: document.getElementById("clearBtn"),
    resultCount: document.getElementById("resultCount"),
    detail: document.getElementById("detail"),
    detailBackdrop: document.querySelector(".drawer-backdrop"),
    closeDetail: document.getElementById("closeDetail"),
    detailModel: document.getElementById("detailModel"),
    detailBadges: document.getElementById("detailBadges"),
    detailDesc: document.getElementById("detailDesc"),
    detailMeta: document.getElementById("detailMeta"),
    pinWrap: document.getElementById("pinWrap"),
    pinImg: document.getElementById("pinImg"),
    specTable: document.getElementById("specTable") && document.getElementById("specTable").querySelector("tbody"),
    specEmpty: document.getElementById("specEmpty"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightboxImg"),
    lightboxCap: document.getElementById("lightboxCap"),
    lightboxClose: document.getElementById("lightboxClose")
  };

  /* ---------- 主题（localStorage 仅存主题） ---------- */

  function getStoredTheme() {
    try {
      return window.localStorage.getItem(THEME_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  }

  // 按系统时间判定：7:00–18:59 浅色，其余深色
  function timeBasedDark() {
    var h = new Date().getHours();
    return h < 7 || h >= 19;
  }

  function isDarkNow(mode) {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return timeBasedDark();
  }

  function applyTheme(mode) {
    /* 关键：时间/手动决定「实际该用哪套色」，并写死到 data-theme。
       不能让浏览器按系统深色偏好走 —— 用户要求白天纯白、晚上纯黑，
       与系统设置无关（否则系统开着深色时，白天也是黑的）。 */
    var dark = isDarkNow(mode);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    el.themeBtn.textContent = dark ? "☀️" : "🌙";
    var label = mode === "auto" ? "（自动·跟随时间）" : (dark ? "（深色）" : "（浅色）");
    el.themeBtn.title = "点击切换主题 " + label;
  }

  function toggleTheme() {
    const mode = getStoredTheme();
    /* 三态循环：自动 → 浅色 → 深色 → 自动。
       必须有回到「自动」的路 —— 旧版只能在浅/深之间切，
       一旦手动切过就永久锁定，这是「白天晚上切换有问题」的根因之一。 */
    const next = mode === "auto" ? "light" : (mode === "light" ? "dark" : "auto");
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch (e) { /* 忽略 */ }
    applyTheme(next);
  }

  /* ---------- 型号收藏（localStorage: xx_fav_models，纯本地、不上传） ---------- */

  var FAV_KEY = "xx_fav_models";
  var FAV_CACHE = null;          /* 内存缓存；storage 事件时置空重读 */

  function favRead() {
    if (FAV_CACHE) return FAV_CACHE.slice();
    var list = [];
    try {
      var raw = window.localStorage.getItem(FAV_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        list = parsed.map(function (x) { return String(x == null ? "" : x).trim(); })
          .filter(function (x) { return !!x; });
      }
    } catch (e) { list = []; }
    /* 去重（大小写不敏感），保留首次写入的写法 */
    var seen = Object.create(null), out = [];
    list.forEach(function (m) {
      var k = m.toUpperCase();
      if (!seen[k]) { seen[k] = 1; out.push(m); }
    });
    FAV_CACHE = out;
    return out.slice();
  }

  function favWrite(list) {
    FAV_CACHE = list.slice();
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(FAV_CACHE));
    } catch (e) { /* 隐私模式 / 配额满：内存态仍然可用 */ }
  }

  function isFav(model) {
    var m = String(model == null ? "" : model).trim().toUpperCase();
    if (!m) return false;
    return favRead().some(function (x) { return x.toUpperCase() === m; });
  }

  function favModels() {
    return favRead();
  }

  function toggleFav(model) {
    var m = String(model == null ? "" : model).trim();
    if (!m) return false;
    var list = favRead();
    var upper = m.toUpperCase();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].toUpperCase() === upper) { idx = i; break; }
    }
    var on;
    if (idx >= 0) { list.splice(idx, 1); on = false; }
    else { list.push(m); on = true; }
    favWrite(list);
    syncFavButton();
    decorateFavRows();
    try {
      document.dispatchEvent(new CustomEvent("xx:favchange", { detail: { model: m, fav: on } }));
    } catch (e) { /* 老浏览器不支持 CustomEvent 构造：忽略 */ }
    return on;
  }

  /* 抽屉头部的星标按钮：运行时插入到 #detailModel 与「复制」之间，
     不改 index.html 结构；老缓存页面没有 .head-line 时静默跳过。 */
  var favBtn = null;

  function ensureFavButton() {
    if (favBtn && favBtn.isConnected !== false && favBtn.parentNode) return favBtn;
    if (document.getElementById("favModelBtn")) {
      favBtn = document.getElementById("favModelBtn");
      return favBtn;
    }
    var head = el.detail && el.detail.querySelector(".head-line");
    if (!head) return null;
    var btn = document.createElement("button");
    btn.id = "favModelBtn";
    btn.type = "button";
    btn.className = "copy-btn fav-btn";
    btn.setAttribute("aria-label", "收藏该型号");
    btn.setAttribute("aria-pressed", "false");
    btn.title = "收藏该型号（只存本机，不上传）";
    btn.textContent = "☆";
    /* 星号字形在 12px 下偏小，内联补齐尺寸，避免依赖 style.css 改动 */
    btn.style.fontSize = "14px";
    btn.style.lineHeight = "1";
    btn.style.minWidth = "34px";
    btn.style.padding = "3px 8px";
    var anchor = document.getElementById("copyModelBtn");
    if (anchor && anchor.parentNode === head) head.insertBefore(btn, anchor);
    else head.appendChild(btn);
    btn.addEventListener("click", function () {
      var model = el.detailModel ? el.detailModel.textContent.trim() : "";
      if (model) toggleFav(model);
    });
    favBtn = btn;
    return btn;
  }

  function syncFavButton(model) {
    var btn = ensureFavButton();
    if (!btn) return;
    var want = model == null
      ? (el.detailModel ? el.detailModel.textContent.trim() : "")
      : String(model).trim();
    var on = want ? isFav(want) : false;
    btn.textContent = on ? "★" : "☆";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "取消收藏该型号" : "收藏该型号（只存本机，不上传）";
    btn.classList.toggle("fav-on", on);
    btn.style.color = on ? "#E8A33D" : "";
    btn.style.borderColor = on ? "#E8A33D" : "";
  }

  /* 列表行星标：unified.js 负责渲染 .rcard / .mod-row，这里只往型号名前面
     插入自己的 <span>，不改它的渲染逻辑；重渲染后由 MutationObserver 补回。 */
  var FAV_MARK_CLASS = "xx-fav-mark";

  function favRowRoots() {
    var roots = [];
    ["results", "catTree", "tableBody"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) roots.push(n);
    });
    return roots;
  }

  function decorateFavRows() {
    var roots = favRowRoots();
    if (!roots.length) return;
    var favs = Object.create(null);
    favRead().forEach(function (m) { favs[m.toUpperCase()] = 1; });
    roots.forEach(function (root) {
      Array.prototype.forEach.call(root.querySelectorAll("[data-model]"), function (row) {
        var model = String(row.getAttribute("data-model") || "").trim();
        var on = !!favs[model.toUpperCase()];
        row.classList.toggle("is-fav", on);
        var nameEl = row.querySelector(".rcard-model, .mod-name") || row.querySelector("td");
        if (on && nameEl && !nameEl.querySelector("." + FAV_MARK_CLASS)) {
          var mark = document.createElement("span");
          mark.className = FAV_MARK_CLASS;
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = "★";
          mark.style.color = "#E8A33D";
          mark.style.marginRight = "3px";
          mark.style.fontSize = "0.92em";
          mark.style.lineHeight = "1";
          nameEl.insertBefore(mark, nameEl.firstChild);
        } else if (!on) {
          Array.prototype.forEach.call(row.querySelectorAll("." + FAV_MARK_CLASS), function (n) {
            if (n.parentNode) n.parentNode.removeChild(n);
          });
        }
      });
    });
  }

  function watchFavRows() {
    if (typeof MutationObserver === "undefined") return;
    var pending = null;
    var schedule = function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; decorateFavRows(); }, 80);
    };
    favRowRoots().forEach(function (root) {
      new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    });
    decorateFavRows();
  }

  /* ---------- specs 懒加载：按 id 分块（data/specs/chunk-NN[.hash].json） ----------
     块文件 {"<id>": [specs...]} 约 42 款；index.json 的 item.chunk 给块号，
     chunks_meta[{i,file,n}] 给真实文件名（带 hash）。
     一次加载服务同块所有型号；已加载块记在 Set 里，不重复请求。
     三级回退：块文件 → 全量 data/specs.json（老路径）→ 参数区「参数暂缺」。
     块文件可能尚未生成：404/网络错误静默回退，不报错。 */

  var SPECS = null;                        /* id -> 参数数组（块/全量共用缓存） */
  var SPECS_FULL = false;                  /* 全量 specs.json 是否已成功加载 */
  var SPECS_FULL_ERROR = false;            /* 全量兜底也失败 → 渲染「参数暂缺」 */
  var SPECS_FULL_PROMISE = null;
  var CHUNKS = new Set();                  /* 已加载块号："0" … "15" */
  var CHUNK_PROMISE = Object.create(null); /* 块号 -> 进行中的请求 */
  var SPEC_MISSING = Object.create(null);  /* MODEL -> true：块 + 全量都失败 */

  function modelKey(model) {
    return String(model == null ? "" : model).trim().toUpperCase();
  }

  /* 块号：数字或数字字符串；缺省/越界返回 ""（→ 全量回退） */
  function chunkKey(value) {
    if (value === null || value === undefined || value === "") return "";
    var n = Number(value);
    if (!isFinite(n) || n < 0 || n > 99 || Math.floor(n) !== n) return "";
    return String(n);
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  /* 块文件名以 index.json 的 chunks_meta 为准：[{i, file, n}]，file 带 hash。
     （兼容别名 chunks 也是数组的情况；chunks 为纯数字时忽略。）
     chunks_meta 不存在时退回旧命名 chunk-XX.json；存在但没有该块 → 视为不可用。 */
  function chunkFile(value) {
    var key = chunkKey(value);
    if (!key) return "";
    var meta = INDEX ? (INDEX.chunks_meta || INDEX.chunks) : null;
    if (Array.isArray(meta) && meta.length) {
      for (var i = 0; i < meta.length; i++) {
        var m = meta[i];
        if (m && Number(m.i) === Number(key) && m.file) {
          /* 只取文件名，剥掉任何路径部分 */
          return "./data/specs/" + encodeURIComponent(String(m.file).split("/").pop());
        }
      }
      return "";
    }
    return "./data/specs/chunk-" + pad2(Number(key)) + ".json";
  }

  function fetchJson(url, immutable) {
    /* immutable=true 用于内容哈希命名的块（chunk-00.a1b2c3d4.json）：
       文件名已随内容变，不能再加时间戳，否则每次都算新 URL，_headers 的长缓存失效。 */
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    var full = immutable ? url : url + sep + "t=" + Math.floor(Date.now() / 60000);
    return fetch(full).then(function (r) {
      if (!r.ok) {
        var err = new Error("HTTP " + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function applyChunkSpecs(map) {
    if (!map || typeof map !== "object") return;
    SPECS = SPECS || {};
    var n = 0;
    Object.keys(map).forEach(function (id) {
      if (Array.isArray(map[id])) { SPECS[id] = map[id]; n++; }
    });
    if (!n) return;
    /* 整块回填：同块约 42 款一次到位，后续打开不再请求 */
    products.forEach(function (p) {
      var s = SPECS[String(p.id)];
      if (s) p.specs = s;
    });
  }

  /* index.json 若只带列表字段（缺 description / source_label），首次开详情
     按需补一次 products_lite.json：只补缺、不覆盖 index。
     index 字段齐全时不会触发，也不产生额外请求。 */
  var LITE_PROMISE = null;
  var HYDRATED = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  function hydrateDisplayFields(item) {
    if (!item) return;
    if (HYDRATED) {
      if (HYDRATED.has(item)) return;
      HYDRATED.add(item);
    } else {
      if (item.__fieldsHydrated) return;
      item.__fieldsHydrated = true;
    }
    if (item.description !== undefined && item.source_label !== undefined) return;
    if (!LITE_PROMISE) {
      LITE_PROMISE = fetchJson("./data/products_lite.json").then(function (lite) {
        if (!Array.isArray(lite)) return false;
        var byId = Object.create(null);
        lite.forEach(function (p) { if (p && p.id != null) byId[String(p.id)] = p; });
        products.forEach(function (p) {
          var src = byId[String(p.id)];
          if (!src) return;
          Object.keys(src).forEach(function (k) {
            if (k === "specs" || k === "haystack") return;
            var v = src[k];
            if (v === undefined || v === null || v === "") return;
            if (Array.isArray(v) && !v.length) return;
            var cur = p[k];
            if (cur === undefined || cur === null || cur === "" || (Array.isArray(cur) && !cur.length)) p[k] = v;
          });
          p.haystack = buildHaystack(p);
        });
        return true;
      }).catch(function () { return false; });
    }
    LITE_PROMISE.then(function (ok) {
      if (!ok) return;
      /* 抽屉正停在这个型号：用补齐后的字段重绘（openDetail 幂等，不重置焦点） */
      if (el.detail && !el.detail.classList.contains("hidden") &&
          el.detailModel && el.detailModel.textContent === item.model) {
        openDetail(item.id);
      }
    });
  }

  function mergeFullSpecs(map) {
    if (!map || typeof map !== "object") return;
    SPECS = SPECS || {};
    var n = 0;
    Object.keys(map).forEach(function (id) {
      if (map[id]) { SPECS[id] = map[id]; n++; }
    });
    if (!n) return;
    /* 回填到每个产品，后续代码无感知 */
    products.forEach(function (p) {
      var s = SPECS[String(p.id)];
      if (s) p.specs = s;
    });
    /* 参数总数只有全量时才是全站口径；分块阶段保持首屏占位 "-" */
    if (SPECS_FULL && el.statSpecs) {
      var total = 0;
      products.forEach(function (p) { if (Array.isArray(p.specs)) total += p.specs.length; });
      el.statSpecs.textContent = total;
    }
  }

  function loadFullSpecs() {
    if (SPECS_FULL) return Promise.resolve(SPECS || {});
    if (SPECS_FULL_PROMISE) return SPECS_FULL_PROMISE;
    SPECS_FULL_PROMISE = fetchJson("./data/specs.json")
      .then(function (m) { mergeFullSpecs(m); SPECS_FULL = true; return SPECS || {}; })
      .catch(function (e) {
        /* 兜底也失败：不再重试，渲染层显示「参数暂缺」 */
        console.warn("[specs] 全量兜底加载失败", e);
        SPECS_FULL_ERROR = true;
        SPECS = SPECS || {};
        return SPECS;
      });
    return SPECS_FULL_PROMISE;
  }

  function loadChunk(key, url) {
    if (CHUNKS.has(key)) return Promise.resolve(true);
    if (CHUNK_PROMISE[key]) return CHUNK_PROMISE[key];
    var p = fetchJson(url, true).then(function (map) {
      applyChunkSpecs(map);
      CHUNKS.add(key);
      return true;
    }).catch(function () {
      /* 块文件缺失/损坏：静默走二级回退（全量 specs.json） */
      return loadFullSpecs().then(function () { return SPECS_FULL; });
    });
    CHUNK_PROMISE[key] = p;
    return p;
  }

  /* 从 products 里取该型号当前的参数数组（块回填后就是最新值） */
  function specsFor(item) {
    var key = modelKey(item.model);
    for (var i = 0; i < products.length; i++) {
      if (modelKey(products[i].model) === key) {
        return Array.isArray(products[i].specs) ? products[i].specs : [];
      }
    }
    return Array.isArray(item.specs) ? item.specs : [];
  }

  function resolveItem(target) {
    if (target && typeof target === "object") return target;
    if (target == null) return null;
    var key = modelKey(target);
    if (!key) return null;
    for (var i = 0; i < products.length; i++) {
      if (modelKey(products[i].model) === key) return products[i];
    }
    return { model: String(target).trim() };
  }

  /* target 可以是产品对象或型号字符串；不传 = 要全量（老调用点语义不变） */
  function ensureSpecs(target) {
    var item = resolveItem(target);
    if (!item) return loadFullSpecs();
    var url = chunkFile(item.chunk);
    if (!url) {
      /* 块号未知 / chunks_meta 缺项（index.json 不可用）→ 回退全量 specs.json */
      return loadFullSpecs().then(function () {
        var specs = specsFor(item);
        if (!specs.length && SPECS_FULL_ERROR) SPEC_MISSING[modelKey(item.model)] = true;
        return specs;
      });
    }
    return loadChunk(chunkKey(item.chunk), url).then(function () {
      var specs = specsFor(item);
      if (!specs.length && SPECS_FULL_ERROR) SPEC_MISSING[modelKey(item.model)] = true;
      return specs;
    });
  }

  function openDetail(id) {
    const item = products.find(function (p) { return p.id === id; });
    if (!item) return;
    /* 焦点管理：真正「打开」时记住触发元素，关闭后把焦点还回去。
       抽屉已打开时的重复调用（specs 懒加载回调 / 上一个·下一个）不覆盖 lastTrigger。 */
    const wasOpen = !el.detail.classList.contains("hidden");
    if (!wasOpen) lastTrigger = document.activeElement;
    /* specs 未就绪时**不再直接 return**：旧逻辑会让抽屉等 3–4 秒才出现（手机更久），
       客户点了没任何反馈。现在先渲染基础信息 + 参数区占位，加载完成再填充。 */

    el.detailModel.textContent = item.model;
    /* 星标状态跟随当前型号（同一个按钮，不重建 DOM） */
    syncFavButton(item.model);
    /* index.json 若只带列表字段，按需补齐描述/规格书/引脚图等（只触发一次） */
    hydrateDisplayFields(item);
    el.detailBadges.innerHTML = statusBadgeHtml(deriveStatus(item), true);
    el.detailDesc.textContent = text(item.description);
    const dsUrl = item.source_label ? new URL("./datasheets/" + item.source_label, document.baseURI).href : "";
    el.detailMeta.innerHTML = [
      metaItem("功能", item.function),
      metaItem("功能详细", item.function_detail),
      metaItem("系列", item.series),
      metaItem("封装", item.package),
      metaItem("逻辑类型", item.logic_type),
      metaItem("工作电压", item.voltage),
      metaItem("工作温度", item.temp_range),
      metaItem("封装尺寸", item.package_size),
      appSceneItem(item),
      dsUrl ? '<div class="meta-item"><div class="label">规格书</div><div class="value"><a href="' + esc(dsUrl) + '" target="_blank" rel="noopener">👁 查看</a> · <a href="' + esc(dsUrl) + '" download>⬇ 下载</a></div></div>' : "",
      /* 规格书版本 / 该版本发布日期：照录规格书修订记录（脚本 scripts/extract_ds_meta.py 提取） */
      metaItem("规格书版本", item.ds_ver),
      metaItem("版本更新日期", item.ds_date)
    ].join("");

    /* 竞品对标 / TI 对标 已按需求摘除（网页端不展示任何竞品信息） */
    /* 应用电路图（app_schematics/*.svg）已按需求整体删除：导航栏目 / 独立页 / 抽屉区块 / 图片文件全部移除 */

    if (item.pin_image) {
      el.pinWrap.classList.remove("hidden");
      /* WebP 引脚图（体积省 58%） */
      el.pinImg.onerror = null;
      el.pinImg.src = new URL(item.pin_image, document.baseURI).href;
      el.pinImg.alt = item.model + " pin diagram";
    } else {
      el.pinWrap.classList.add("hidden");
      el.pinImg.src = "";
      el.pinImg.alt = "Pin diagram";
    }

    renderSpecBlock(item);

    el.detail.classList.remove("hidden");
    el.detail.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    /* 打开后把焦点移进抽屉（panel 加 tabindex=-1），Tab 才有出发点 */
    if (!wasOpen) focusTrapEnter();
    /* 深链接：地址栏写成 #model=型号，客户/销售可直接复制分享 */
    if (window.__xx && window.__xx.setHash) window.__xx.setHash("model=" + encodeURIComponent(item.model));
  }

  /* 电气参数区：按块懒加载（chunk-NN.json → specs.json → 参数暂缺） */
  function renderSpecBlock(item) {
    var specs = Array.isArray(item.specs) ? item.specs : [];
    var ck = chunkKey(item.chunk);
    var known = SPECS_FULL || (!!ck && CHUNKS.has(ck));
    if (known || specs.length) {
      showSpecTable(specs, !!SPEC_MISSING[modelKey(item.model)]);
      return;
    }
    el.specTable.innerHTML = '<tr class="spec-loading"><td colspan="2">' +
      '电气参数加载中…（按块按需加载，之后秒开）</td></tr>';
    el.specEmpty.classList.add("hidden");
    var want = item.model;
    ensureSpecs(item).then(function (list) {
      if (el.detail.classList.contains("hidden")) return;
      if (el.detailModel && el.detailModel.textContent !== want) return;
      var arr = Array.isArray(list) ? list : (Array.isArray(item.specs) ? item.specs : []);
      showSpecTable(arr, !!SPEC_MISSING[modelKey(item.model)]);
    });
  }

  function showSpecTable(specs, missing) {
    fillSpecTable(specs);
    /* 三级回退都失败才提示「参数暂缺」；型号本身确实无参数时仍显示「无参数」 */
    if (missing && !specs.length && el.specEmpty) el.specEmpty.textContent = "参数暂缺";
  }

  function fillSpecTable(specs) {
    el.specTable.innerHTML = "";
    if (el.specEmpty) el.specEmpty.textContent = "无参数";
    el.specEmpty.classList.toggle("hidden", specs.length > 0);
    var groups = groupSpecs(specs.slice(0, 300));
    groups.forEach(function (group) {
      var head = document.createElement("tr");
      head.className = "spec-group";
      head.innerHTML = '<td colspan="2">' + esc(group.kind) + " · " + group.items.length + "</td>";
      el.specTable.appendChild(head);
      group.items.forEach(function (spec) {
        var row = document.createElement("tr");
        row.innerHTML = "<td>" + (spec.param_html || renderParam(spec)) + "</td><td>" + specHtml(spec) + "</td>";
        el.specTable.appendChild(row);
      });
    });
  }

  /* 族规范化：优先用数据里的族名表做「最长前缀」匹配，避免正则猜封装后缀。
     型号只要以某个族名为前缀即归入该族（取最长的那个）。 */
  function metaItem(label, value) {
    return '<div class="meta-item"><div class="label">' + esc(label) + '</div><div class="value">' + esc(text(value)) + "</div></div>";
  }

  /* 应用场景：可点击 —— 跳到「应用」页并筛出该场景（unified.js 提供 goAppScene） */
  function appSceneItem(item) {
    var scenes = (item.applications_domains || []).slice();
    if (!scenes.length && item.applications) scenes = [item.applications];
    if (!scenes.length) {
      return '<div class="meta-item"><div class="label">应用场景</div><div class="value">—</div></div>';
    }
    var links = scenes.map(function (s) {
      return '<a href="#" class="app-scene-link" data-app-scene="' + esc(s) + '">' + esc(s) + "</a>";
    }).join("、");
    return '<div class="meta-item"><div class="label">应用场景</div><div class="value">' + links + "</div></div>";
  }

  function closeDetail() {
    const wasVisible = !el.detail.classList.contains("hidden");
    el.detail.classList.add("hidden");
    el.detail.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (window.__xx && window.__xx.setHash) window.__xx.setHash("");
    /* 焦点还给打开抽屉的那个元素（行/按钮/输入框） */
    if (wasVisible) focusTrapExit();
  }

  /* ---------- 焦点管理 + 键盘可达（详情抽屉） ---------- */

  var lastTrigger = null;

  function focusTrapPanel() {
    return el.detail ? el.detail.querySelector(".drawer-panel") : null;
  }

  /* 抽屉内所有当前可聚焦（且确实可见）的元素，按 DOM 顺序 */
  function focusTrapItems(panel) {
    if (!panel) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(panel.querySelectorAll(sel), function (node) {
      if (node.hasAttribute("hidden")) return false;
      if (node.getAttribute("aria-hidden") === "true") return false;
      return node.getClientRects().length > 0;   /* display:none / 隐藏区块里的元素直接排除 */
    });
  }

  function focusTrapEnter() {
    const panel = focusTrapPanel();
    if (!panel) return;
    if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
  }

  function focusTrapExit() {
    const panel = focusTrapPanel();
    const target = lastTrigger;
    lastTrigger = null;
    const ok = target && target !== document.body && target.isConnected !== false &&
      typeof target.focus === "function" && target.getClientRects && target.getClientRects().length > 0;
    if (ok) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
      return;
    }
    /* 触发元素已不可见（列表重渲染 / 换页）：焦点回 body，并清掉抽屉上的临时 tabindex */
    if (panel) panel.removeAttribute("tabindex");
    try { document.body.focus(); } catch (e) { /* 忽略 */ }
  }

  /* Tab / Shift+Tab 在抽屉内循环，不跑到底下的列表页 */
  function onDetailKeydown(event) {
    if (!el.detail || el.detail.classList.contains("hidden")) return;
    if (event.key !== "Tab") return;
    /* 灯箱盖在抽屉上时不开抽屉的焦点圈，否则会把焦点从图片上抢走 */
    if (el.lightbox && !el.lightbox.classList.contains("hidden")) return;
    const panel = focusTrapPanel();
    if (!panel) return;
    const items = focusTrapItems(panel);
    if (!items.length) { event.preventDefault(); panel.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === panel || active === last)) {
      event.preventDefault();
      first.focus();
    }
  }

  /* 折叠区块：h3 变成键盘可达的按钮，aria-expanded 跟随 .collapsed */
  function syncCollapseAria() {
    if (!el.detail) return;
    Array.prototype.forEach.call(el.detail.querySelectorAll(".collapsible > h3"), function (h) {
      if (!h.parentElement) return;
      h.setAttribute("aria-expanded", h.parentElement.classList.contains("collapsed") ? "false" : "true");
    });
  }

  function enhanceCollapsibles() {
    if (!el.detail) return;
    Array.prototype.forEach.call(el.detail.querySelectorAll(".collapsible > h3"), function (h) {
      if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "0");
      h.setAttribute("role", "button");
    });
    syncCollapseAria();
    if (typeof MutationObserver === "undefined") return;
    /* 只读 class、只写 aria-expanded：不会触发自身回调死循环。
       unified.js 的窄屏自动折叠和鼠标点击切换都会让 aria-expanded 同步更新。 */
    new MutationObserver(syncCollapseAria).observe(el.detail, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true
    });
  }

  function onCollapseKeydown(event) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    const t = event.target;
    const h = t && t.closest ? t.closest(".collapsible > h3") : null;
    if (!h || h.getAttribute("tabindex") !== "0") return;
    if (!el.detail || !el.detail.contains(h)) return;
    event.preventDefault();   /* Space 默认会滚动页面 */
    h.click();                /* 复用 unified.js 现有的折叠点击逻辑，行为与鼠标一致 */
  }

  /* ---------- 引脚图灯箱 ---------- */

  function openLightbox(img) {
    const target = img || el.pinImg;
    if (!target.src) return;
    el.lightboxImg.src = target.src;
    el.lightboxImg.alt = target.alt;
    el.lightboxCap.textContent = target.alt;
    el.lightbox.classList.remove("hidden");
    el.lightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    el.lightbox.classList.add("hidden");
    el.lightbox.setAttribute("aria-hidden", "true");
    el.lightboxImg.src = "";
  }

  /* ---------- 事件 ---------- */

  function bindEvents() {
    /* 注意：#q 输入与 #clearBtn 的搜索行为由 unified.js 绑定（doSearch 定义在那里）。
       此处**不要**再绑一次 —— 跨 IIFE 引用 doSearch 会抛 ReferenceError，
       且与 unified.js 的监听重复（一次输入触发两次搜索）。 */

    el.themeBtn.addEventListener("click", toggleTheme);
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onScheme = function () {
        if (getStoredTheme() === "auto") applyTheme("auto");
      };
      if (mq.addEventListener) mq.addEventListener("change", onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    el.closeDetail.addEventListener("click", closeDetail);
    el.detailBackdrop.addEventListener("click", closeDetail);

    /* 详情里的「应用场景」点击 → 关抽屉 + 跳应用页筛出该场景 */
    if (el.detailMeta) el.detailMeta.addEventListener("click", function (event) {
      var a = event.target.closest("[data-app-scene]");
      if (!a) return;
      event.preventDefault();
      var scene = a.getAttribute("data-app-scene");
      closeDetail();
      if (window.__xx && typeof window.__xx.goAppScene === "function") {
        window.__xx.goAppScene(scene);
      }
    });

    // 空值保护: 浏览器缓存旧版 index.html 时新元素为 null, 直接 addEventListener 会抛错中断整个 init
    if (el.pinImg) {
      /* 引脚图键盘可达：Tab 能停，Enter/Space 等同点击放大 */
      el.pinImg.setAttribute("tabindex", "0");
      el.pinImg.setAttribute("role", "button");
      el.pinImg.setAttribute("aria-label", "放大引脚图");
      el.pinImg.addEventListener("click", function () { openLightbox(el.pinImg); });
      el.pinImg.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        event.preventDefault();   /* Space 默认滚动页面 */
        openLightbox(el.pinImg);
        /* 键盘打开时把焦点交给灯箱关闭按钮，避免焦点留在背后的抽屉里 */
        if (el.lightboxClose) el.lightboxClose.focus();
      });
    }
    el.lightboxClose.addEventListener("click", closeLightbox);
    el.lightbox.addEventListener("click", function (event) {
      if (event.target === el.lightbox || event.target.classList.contains("lightbox-mask") || event.target === el.lightboxImg) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!el.lightbox.classList.contains("hidden")) {
        closeLightbox();
      } else if (!el.detail.classList.contains("hidden")) {
        closeDetail();
      }
    });

    /* 键盘可达：抽屉焦点圈 + 折叠区块 Enter/Space 切换 */
    enhanceCollapsibles();
    document.addEventListener("keydown", onDetailKeydown);
    document.addEventListener("keydown", onCollapseKeydown);

    /* 型号收藏：抽屉星标按钮、列表行补星标、跨标签页同步 */
    ensureFavButton();
    watchFavRows();
    window.addEventListener("storage", function (event) {
      if (event.key !== FAV_KEY && event.key !== null) return;
      FAV_CACHE = null;
      syncFavButton();
      decorateFavRows();
    });
  }

  /* ---------- 数据加载 ---------- */

  /* 列表数据源：优先 data/index.json（轻量索引，含展示字段、不含 specs），
     缺失/为空/结构不符时回退 data/products_lite.json（老路径）。 */
  function normalizeProductList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return null;
    var keys = ["products", "items", "models", "list", "data"];
    for (var i = 0; i < keys.length; i++) {
      var v = payload[keys[i]];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        var vals = Object.keys(v).map(function (k) { return v[k]; });
        if (vals.length && vals.every(function (x) { return x && typeof x === "object"; })) return vals;
      }
    }
    return null;
  }

  function loadProductList() {
    return fetchJson("./data/index.json").then(function (payload) {
      var list = normalizeProductList(payload);
      if (!list || !list.length) throw new Error("index.json 为空");
      /* 详情与跳转都依赖 id + model；索引字段不全时宁可回退，也不要半个列表 */
      var usable = list.every(function (p) { return p && p.model && p.id != null; });
      if (!usable) throw new Error("index.json 字段不全");
      INDEX = payload;   /* 保留 chunks_meta，供按块加载用 */
      return list;
    }).catch(function () {
      INDEX = null;
      return fetchJson("./data/products_lite.json");
    });
  }

  function load() {
    /* 首屏只拉列表（index.json 约 180KB；specs 已拆成 16 个块，按需加载） */
    loadProductList()
      .then(function (data) {
        data.forEach(function (item) {
          item.haystack = buildHaystack(item);
          products.push(item);
        });
        products.sort(function (a, b) { return a.model.localeCompare(b.model); });

        el.statModels.textContent = products.length;
        el.statSpecs.textContent = "-";
        if (el.meta) el.meta.textContent = "离线数据库 · 静态网页版";

        /* specs 按块懒加载：首屏不预取参数，点开型号时才拉 data/specs/chunk-NN；
           块缺失自动回退全量 specs.json，再失败显示「参数暂缺」。 */

        /* 桥接给 unified.js：数据 + 按型号打开详情 */
        window.__xx = window.__xx || {};
        window.__xx.products = products;
        window.__xx.openByModel = function (model) {
          const m = String(model || "").toUpperCase();
          const item = products.find(function (p) { return p.model.toUpperCase() === m; })
            || products.find(function (p) { return p.model.toUpperCase().indexOf(m) === 0; });
          if (item) openDetail(item.id);
        };
        /* 支持 index.html?model=EM74HC138D 深链：便于分享单个型号直达详情。 */
        try {
          const want = new URLSearchParams(location.search).get("model");
          if (want) window.__xx.openByModel(want);
        } catch (err) { /* URL 解析失败不阻断页面 */ }
      })
      .catch(function (err) {
        if (el.meta) el.meta.textContent = "数据加载失败";
        if (el.empty) {
          el.empty.textContent = "无法加载产品数据：" + err.message;
          el.empty.classList.remove("hidden");
        }
      });
  }

  // 启动时按时间（或已存的手动选择）应用主题
  applyTheme(getStoredTheme());

  /* 桥接给 unified.js：收藏状态/切换（列表星标可直接调用），specs 预热入口 */
  window.__xx = window.__xx || {};
  window.__xx.isFav = isFav;
  window.__xx.toggleFav = toggleFav;
  window.__xx.favModels = favModels;
  window.__xx.ensureSpecs = ensureSpecs;
  window.__xx.syncFavButton = syncFavButton;

  // 每整分钟检查：若用户未手动锁定，随时间自动切换纯白/纯黑
  setInterval(function () {
    if (getStoredTheme() === "auto") applyTheme("auto");
  }, 60 * 1000);

  bindEvents();
  /* 首屏：只拉 products_lite.json（446KB）—— 目录树/搜索/详情骨架全靠它。 */
  load();

})();
