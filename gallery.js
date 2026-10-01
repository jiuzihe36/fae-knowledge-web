/* 应用电路图画廊 —— 与「技术文档」同款列表布局。双入口共用：
   - index.html（SPA 标签）：unified.js 切到 gallery 页时调用 window.__gallery.mount(host)
   - gallery.html（独立页）：文档中没有 #pageBody 时自动挂载到 #galhost
   数据只拉一次（模块级缓存），二次打开秒开；搜索词/筛选状态跨切换保留。 */
(function () {
  var products = null, funcs = null, pending = null;
  var state = { k: "", f: "" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
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

  function row(p) {
    var a = document.createElement("a");
    a.className = "doc-row";
    a.href = "./index.html?model=" + encodeURIComponent(p.model);
    a.innerHTML =
      '<span class="doc-pn">' + esc(p.model) + '</span>' +
      '<span class="doc-fn">' + esc(p.function || "—") + '</span>' +
      '<span class="doc-pk">' + esc(p.package || "—") + '</span>' +
      '<span class="doc-raw">原图 →</span>';
    /* 整行 → 产品详情；点「原图」→ 新标签直接看 SVG */
    a.addEventListener("click", function (e) {
      if (e.target.closest(".doc-raw")) {
        e.preventDefault();
        window.open("./app_schematics/" + encodeURIComponent(p.model) + "_app.svg", "_blank");
      }
    });
    return a;
  }

  function mount(host) {
    if (!host) return;
    host.classList.add("gal");
    host.innerHTML =
      '<div class="doc-sticky">' +
      '  <div class="doc-tools">' +
      '    <input id="gal-q" class="page-search" type="search" placeholder="搜索型号 / 功能 / 封装，如 EM74HC138、译码、电平转换">' +
      '    <select id="gal-ff"><option value="">全部功能</option></select>' +
      '    <span class="count-pill" id="gal-cnt">—</span>' +
      '  </div>' +
      '  <div class="doc-head"><span class="doc-th">型号</span><span class="doc-th">功能</span>' +
      '    <span class="doc-th">封装</span><span class="doc-th">图纸</span></div>' +
      '</div>' +
      '<div class="doc-list" id="gal-root"></div>' +
      '<div class="empty" id="gal-none" style="display:none">没有匹配的型号</div>';

    var root = host.querySelector("#gal-root"),
        q = host.querySelector("#gal-q"),
        ff = host.querySelector("#gal-ff"),
        cnt = host.querySelector("#gal-cnt"),
        none = host.querySelector("#gal-none");

    function render() {
      if (!products) return;
      var k = q.value.trim().toUpperCase(), f = ff.value;
      var list = products.filter(function (p) {
        if (f && (p.function || "") !== f) return false;
        if (!k) return true;
        return (p.model || "").toUpperCase().indexOf(k) >= 0 ||
               (p.function || "").toUpperCase().indexOf(k) >= 0 ||
               (p.package || "").toUpperCase().indexOf(k) >= 0;
      }).slice().sort(function (a, b) {
        return (a.model || "").localeCompare(b.model || "");
      });
      var frag = document.createDocumentFragment();
      list.forEach(function (p) { frag.appendChild(row(p)); });
      root.innerHTML = "";
      root.appendChild(frag);
      none.style.display = list.length ? "none" : "block";
      cnt.textContent = list.length + " / " + products.length + " 款";
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

    q.value = state.k;
    q.addEventListener("input", function () { state.k = q.value; render(); });
    ff.addEventListener("change", function () { state.f = ff.value; render(); });

    if (products) {
      fillFuncs();
      render();
    } else {
      ensureData().then(function () {
        fillFuncs();
        render();
      }).catch(function (e) {
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
