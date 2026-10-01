/* 应用电路图画廊 —— 双入口共用：
   - index.html（SPA 标签）：unified.js 在切换到 gallery 页时调用 window.__gallery.mount(host)
   - gallery.html（独立页）：文档中没有 #pageBody 时自动挂载到 #galhost
   数据只拉一次（模块级缓存），二次打开秒开；搜索词/筛选状态跨切换保留。 */
(function () {
  var products = null, funcs = null, pending = null;
  var state = { k: "", f: "" };

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

  function card(p) {
    var a = document.createElement("a");
    a.className = "card";
    a.href = "./index.html?model=" + encodeURIComponent(p.model);
    a.innerHTML =
      '<div class="thumb"><img loading="lazy" alt="' + p.model +
      ' 应用原理图" src="./app_schematics/' + encodeURIComponent(p.model) + '_app.svg"></div>' +
      '<div class="meta"><div class="m">' + p.model + '</div>' +
      '<div class="d"><b>' + (p.function || "—") + '</b> · ' + (p.package || "—") + '</div>' +
      '<div class="d"><a class="raw" href="./app_schematics/' + encodeURIComponent(p.model) +
      '_app.svg" target="_blank" onclick="event.stopPropagation()">看原图 →</a></div></div>';
    a.addEventListener("click", function (e) {
      if (e.target.closest("a.raw")) e.preventDefault();
    });
    return a;
  }

  function mount(host) {
    if (!host) return;
    host.classList.add("gal");
    host.innerHTML =
      '<div class="bar">' +
      '  <input id="q" type="search" placeholder="搜索型号 / 功能，如 EM74HC138、译码、电平转换">' +
      '  <select id="ff"><option value="">全部功能</option></select>' +
      '  <span class="cnt" id="cnt"></span>' +
      '</div>' +
      '<div id="root"></div>' +
      '<div class="empty" id="none" style="display:none">没有匹配的型号</div>';

    var root = host.querySelector("#root"),
        q = host.querySelector("#q"),
        ff = host.querySelector("#ff"),
        cnt = host.querySelector("#cnt"),
        none = host.querySelector("#none");

    function render() {
      if (!products) return;
      var k = q.value.trim().toUpperCase(), f = ff.value;
      var list = products.filter(function (p) {
        if (f && (p.function || "") !== f) return false;
        if (!k) return true;
        return (p.model || "").toUpperCase().indexOf(k) >= 0 ||
               (p.function || "").toUpperCase().indexOf(k) >= 0 ||
               (p.package || "").toUpperCase().indexOf(k) >= 0;
      });
      /* 按功能分组：审图时一次看同一类画法 */
      var groups = {}, order = [];
      list.forEach(function (p) {
        var g = p.function || "其它";
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(p);
      });
      root.innerHTML = "";
      order.sort(function (a, b) { return groups[b].length - groups[a].length; });
      order.forEach(function (g) {
        var h = document.createElement("div");
        h.className = "grp";
        h.innerHTML = "<h2>" + g + "</h2><span>" + groups[g].length + " 款</span>";
        root.appendChild(h);
        var grid = document.createElement("div");
        grid.className = "grid";
        groups[g].forEach(function (p) { grid.appendChild(card(p)); });
        root.appendChild(grid);
      });
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