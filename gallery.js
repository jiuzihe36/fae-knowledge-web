/* 应用电路图画廊 —— 与「技术文档」同款列表布局 + 按功能分组折叠。
   双入口共用：
   - index.html（SPA 标签）：unified.js 切到 gallery 页时调用 window.__gallery.mount(host)
   - gallery.html（独立页）：文档中没有 #pageBody 时自动挂载到 #galhost
   数据只拉一次（模块级缓存），二次打开秒开；搜索/筛选/排序/展开状态跨切换保留。 */
(function () {
  var products = null, funcs = null, pending = null;
  var state = { k: "", f: "", sortKey: "model", sortDir: 1, groupsOpen: false };
  var COLS = [["型号", "model"], ["功能", "function"], ["封装", "package"], ["图纸", ""]];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  /* 多关键词高亮：空格分隔，全部关键词标黄（复用「技术文档」的 .doc-hl 样式） */
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

  function ensureData() {
    if (!pending) {
      pending = fetch("./data/products_lite.json")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          products = d;
          var fs = {};
          products.forEach(function (p) { if (p.function) fs[p.function] = (fs[p.function] || 0) + 1; });
          funcs = Object.keys(fs).sort(function (a, b) { return fs[b] - fs[a]; })
            .map(function (k) { return { k: k, n: fs[k] }; });
          return d;
        });
    }
    return pending;
  }

  function row(p, kw) {
    var a = document.createElement("a");
    a.className = "doc-row";
    a.href = "./index.html?model=" + encodeURIComponent(p.model);
    a.setAttribute("data-model", p.model);   /* SPA 内原地打开详情（与目录树/文档一致） */
    a.innerHTML =
      '<span class="doc-pn">' + hl(p.model, kw) + '</span>' +
      '<span class="doc-fn">' + hl(p.function || "—", kw) + '</span>' +
      '<span class="doc-pk">' + hl(p.package || "—", kw) + '</span>' +
      '<span class="doc-raw">原图 →</span>';
    /* 整行 → 产品详情；点「原图」→ 新标签直接看 SVG */
    a.addEventListener("click", function (e) {
      if (e.target.closest(".doc-raw")) {           /* 点「原图」→ 新标签看 SVG，不触发详情 */
        e.preventDefault();
        e.stopPropagation();
        window.open("./app_schematics/" + encodeURIComponent(p.model) + "_app.svg", "_blank");
        return;
      }
      /* SPA 里由 unified.js 按 data-model 原地打开详情，避免整页刷新；
         独立页（gallery.html）没有桥接，保留 <a> 默认跳转 */
      if (window.__xx && typeof window.__xx.openByModel === "function") e.preventDefault();
    });
    return a;
  }

  function mount(host) {
    if (!host) return;
    host.classList.add("gal");
    host.innerHTML =
      '<div class="doc-sticky">' +
      '  <div class="doc-tools">' +
      '    <input id="gal-q" class="page-search" type="search" placeholder="搜索型号 / 功能 / 封装（空格分隔多个关键词）">' +
      '    <select id="gal-ff"><option value="">全部功能</option></select>' +
      '    <button id="gal-expand" class="btn-ghost" type="button">全部展开</button>' +
      '    <button id="gal-collapse" class="btn-ghost" type="button">全部折叠</button>' +
      '    <span class="count-pill" id="gal-cnt">加载中…</span>' +
      '  </div>' +
      '  <div class="doc-head"><span class="doc-th" data-sort="model">型号</span>' +
      '    <span class="doc-th" data-sort="function">功能</span>' +
      '    <span class="doc-th" data-sort="package">封装</span>' +
      '    <span class="doc-th">图纸</span></div>' +
      '</div>' +
      '<div id="gal-root" class="gal-groups"></div>' +
      '<div class="skel-list" id="gal-skel"></div>' +
      '<div class="empty" id="gal-none" style="display:none">没有匹配的型号</div>';

    var root = host.querySelector("#gal-root"),
        skel = host.querySelector("#gal-skel"),
        q = host.querySelector("#gal-q"),
        ff = host.querySelector("#gal-ff"),
        cnt = host.querySelector("#gal-cnt"),
        none = host.querySelector("#gal-none");

    function updateHead() {
      [...host.querySelectorAll(".doc-head .doc-th")].forEach(function (th, i) {
        var key = COLS[i][1];
        th.classList.toggle("on", !!key && state.sortKey === key);
        th.style.cursor = key ? "pointer" : "default";
        th.textContent = COLS[i][0] + (key && state.sortKey === key
          ? (state.sortDir === 1 ? " ↑" : " ↓") : "");
      });
    }

    function render() {
      if (!products) return;
      var raw = q.value.trim();
      var terms = raw.toUpperCase().split(/\s+/).filter(Boolean);
      var f = ff.value;
      var list = products.filter(function (p) {
        if (f && (p.function || "") !== f) return false;
        if (!terms.length) return true;
        var hay = ((p.model || "") + " " + (p.function || "") + " " + (p.package || "")).toUpperCase();
        return terms.every(function (t) { return hay.indexOf(t) >= 0; });   /* 多关键词 = 且 */
      });
      var sk = state.sortKey, sd = state.sortDir;
      list.sort(function (a, b) {
        var r = String(a[sk] || "").localeCompare(String(b[sk] || ""), "zh-Hans-CN");
        if (r === 0) r = String(a.model || "").localeCompare(String(b.model || ""));
        return r * sd;
      });

      /* 按功能分组（组内保持当前排序，组间按款数降序） */
      var groups = {}, order = [];
      list.forEach(function (p) {
        var g = p.function || "其它";
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(p);
      });
      order.sort(function (a, b) { return groups[b].length - groups[a].length; });

      var searching = terms.length > 0 || !!f;
      var frag = document.createDocumentFragment();
      order.forEach(function (g) {
        var card = document.createElement("div");
        card.className = "app-card gal-card";
        var open = searching || state.groupsOpen;   /* 搜索/筛选时自动展开，便于定位 */
        card.innerHTML =
          '<div class="app-head"><span class="app-name">' + esc(g) + '</span>' +
          '<span class="app-count">' + groups[g].length + ' 款</span>' +
          '<span class="app-caret">▶</span></div>' +
          '<div class="app-models' + (open ? '' : ' hidden') + '"></div>';
        var body = card.querySelector(".app-models");
        groups[g].forEach(function (p) { body.appendChild(row(p, raw)); });
        card.classList.toggle("open", open);
        frag.appendChild(card);
      });
      root.innerHTML = "";
      root.appendChild(frag);
      none.style.display = list.length ? "none" : "block";
      cnt.textContent = list.length + " / " + products.length + " 款";
      updateHead();
    }

    function fillFuncs() {
      while (ff.options.length > 1) ff.remove(1);
      (funcs || []).forEach(function (fk) {
        var o = document.createElement("option");
        o.value = fk.k;
        o.textContent = fk.k + "（" + fk.n + "）";
        ff.appendChild(o);
      });
      ff.value = state.f;
    }

    /* 表头排序（与技术文档一致：点击升/降序，带 ↑↓ 指示） */
    host.querySelector(".doc-head").addEventListener("click", function (e) {
      var th = e.target.closest(".doc-th");
      var key = th && th.getAttribute("data-sort");
      if (!key) return;
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = 1; }
      render();
    });
    /* 分组折叠：点组头切换 */
    root.addEventListener("click", function (e) {
      var head = e.target.closest(".app-head");
      if (!head) return;
      var card = head.parentElement;
      card.classList.toggle("open");
      var body = card.querySelector(".app-models");
      if (body) body.classList.toggle("hidden");
    });
    /* 全部展开 / 全部折叠 */
    host.querySelector("#gal-expand").addEventListener("click", function () {
      state.groupsOpen = true;
      root.querySelectorAll(".gal-card").forEach(function (c) {
        c.classList.add("open");
        var b = c.querySelector(".app-models");
        if (b) b.classList.remove("hidden");
      });
    });
    host.querySelector("#gal-collapse").addEventListener("click", function () {
      state.groupsOpen = false;
      root.querySelectorAll(".gal-card").forEach(function (c) {
        c.classList.remove("open");
        var b = c.querySelector(".app-models");
        if (b) b.classList.add("hidden");
      });
    });

    q.value = state.k;
    q.addEventListener("input", function () { state.k = q.value; render(); });
    ff.addEventListener("change", function () { state.f = ff.value; render(); });

    updateHead();
    if (products) {
      skel.remove();
      fillFuncs();
      render();
    } else {
      ensureData().then(function () {
        skel.remove();
        fillFuncs();
        render();
      }).catch(function (e) {
        skel.remove();
        none.style.display = "block";
        none.textContent = "数据加载失败：" + e;
      });
    }
  }

  window.__gallery = { mount: mount };

  /* 独立页自动挂载；index（有 #pageBody）由 unified.js 调用 */
  if (!document.getElementById("pageBody")) {
    mount(document.getElementById("galhost"));
  }
})();
