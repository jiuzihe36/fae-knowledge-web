
(function () {
  var products = [], root = document.getElementById("root"),
      q = document.getElementById("q"), ff = document.getElementById("ff"),
      cnt = document.getElementById("cnt"), none = document.getElementById("none");

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
    /* 点卡片主体跳详情；点「看原图」在新标签打开 SVG */
    a.addEventListener("click", function (e) {
      if (e.target.closest("a.raw")) e.preventDefault();
    });
    return a;
  }

  function render() {
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

  fetch("./data/products_lite.json")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      products = d;
      var fs = {};
      products.forEach(function (p) { if (p.function) fs[p.function] = (fs[p.function] || 0) + 1; });
      Object.keys(fs).sort(function (a, b) { return fs[b] - fs[a]; }).forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = k + "（" + fs[k] + "）";
        ff.appendChild(o);
      });
      render();
    })
    .catch(function (e) { none.style.display = "block"; none.textContent = "数据加载失败：" + e; });

  q.addEventListener("input", render);
  ff.addEventListener("change", render);
})();
