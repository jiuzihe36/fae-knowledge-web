(function () {
  "use strict";

  const products = [];
  const el = {
    meta: document.getElementById("meta"),
    statModels: document.getElementById("statModels"),
    statSpecs: document.getElementById("statSpecs"),
    q: document.getElementById("q"),
    fFunction: document.getElementById("fFunction"),
    fSeries: document.getElementById("fSeries"),
    fPackage: document.getElementById("fPackage"),
    fLogic: document.getElementById("fLogic"),
    fApp: document.getElementById("fApp"),
    clearBtn: document.getElementById("clearBtn"),
    resultCount: document.getElementById("resultCount"),
    tableBody: document.getElementById("tableBody"),
    empty: document.getElementById("empty"),
    detail: document.getElementById("detail"),
    detailBackdrop: document.querySelector(".drawer-backdrop"),
    closeDetail: document.getElementById("closeDetail"),
    detailModel: document.getElementById("detailModel"),
    detailDesc: document.getElementById("detailDesc"),
    detailMeta: document.getElementById("detailMeta"),
    specTable: document.getElementById("specTable").querySelector("tbody"),
    specEmpty: document.getElementById("specEmpty"),
    relatedDoc: document.getElementById("relatedDoc"),
    relatedFunc: document.getElementById("relatedFunc"),
  };

  let filtered = [];
  let debounceTimer = null;

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

  var specsCache = {};

  function buildHaystack(item) {
    const raw = item.raw_json || {};
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
      item.source_label,
      JSON.stringify(raw)
    ];
    if (Array.isArray(item.specs)) {
      item.specs.forEach(function (spec) {
        parts.push(spec.param, spec.value, spec.source_label);
      });
    }
    if (specsCache[item.id]) {
      specsCache[item.id].forEach(function (spec) {
        parts.push(spec.param, spec.value);
      });
    }
    return parts.join(" ").toLowerCase();
  }

  function prefetchSpecs(items) {
    items.slice(0, 668).forEach(function (item) {
      if (specsCache[item.id]) return;
      fetch(new URL("./data/specs/" + item.id + ".json", document.baseURI).href)
        .then(function (r) { return r.json(); })
        .then(function (specs) {
          specsCache[item.id] = specs;
          item._haystack = null;
        })
        .catch(function () {});
    });
  }

  function fillSelect(select, values) {
    const seen = new Set();
    select.innerHTML = '<option value="">全部</option>';
    values.forEach(function (value) {
      const key = String(value == null ? "" : value).trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });
  }

  function runFilters() {
    const q = el.q.value.trim().toLowerCase();
    const fFunction = el.fFunction.value;
    const fSeries = el.fSeries.value;
    const fPackage = el.fPackage.value;
    const fLogic = el.fLogic.value;
    const fApp = el.fApp.value;

    filtered = products.filter(function (item) {
      if (fFunction && item.function !== fFunction) return false;
      if (fSeries && item.series !== fSeries) return false;
      if (fPackage && item.package !== fPackage) return false;
      if (fLogic && item.logic_type !== fLogic) return false;
      if (fApp && (item.applications_domains || []).indexOf(fApp) === -1) return false;
      if (q) {
        var h = item._haystack || (item._haystack = buildHaystack(item));
        if (h.indexOf(q) === -1) return false;
      }
      return true;
    });

    el.resultCount.textContent = filtered.length;
    renderRows();
  }

  function renderRows() {
    el.tableBody.innerHTML = "";
    el.empty.classList.toggle("hidden", filtered.length > 0);
    if (!filtered.length) return;

    const rows = filtered.slice(0, 500).map(function (item) {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;
      tr.innerHTML = [
        '<td class="model-cell">' + esc(item.model) + "</td>",
        "<td>" + esc(text(item.function_detail || item.function)) + "</td>",
        "<td>" + esc(text(item.series)) + "</td>",
        "<td>" + esc(text(item.package)) + "</td>",
        "<td>" + esc(text(item.logic_type)) + "</td>",
        "<td>" + esc(text(item.voltage)) + "</td>",
        "<td>" + esc(text(item.package_size)) + "</td>"
      ].join("");
      return tr;
    });

    rows.forEach(function (tr) {
      tr.addEventListener("click", function () {
        openDetail(Number(tr.dataset.id));
      });
    });
    el.tableBody.append.apply(el.tableBody, rows);

    if (filtered.length > 500) {
      const note = document.createElement("tr");
      note.innerHTML = '<td colspan="7" class="empty">显示前 500 条，继续搜索可缩小范围</td>';
      el.tableBody.appendChild(note);
    }
  }

  function openDetail(id) {
    const item = products.find(function (p) { return p.id === id; });
    if (!item) return;

    el.detailModel.textContent = item.model;
    el.detailDesc.textContent = text(item.description);
    const dsUrl = item.source_label ? new URL("./datasheets/" + item.source_label, document.baseURI).href : "";
    el.detailMeta.innerHTML = [
      metaItem("功能", item.function),
      metaItem("功能详细", item.function_detail),
      metaItem("系列", item.series),
      metaItem("封装", item.package),
      metaItem("逻辑类型", item.logic_type),
      metaItem("工作电压", item.voltage),
      metaItem("封装尺寸", item.package_size),
      dsUrl ? '<div class="meta-item"><div class="label">规格书</div><div class="value"><a href="' + esc(dsUrl) + '" target="_blank" rel="noopener">👁 查看</a> · <a href="' + esc(dsUrl.replace("/datasheets/", "/datasheets_view/")) + '" target="_blank" rel="noopener">👁 快速查看</a> · <a href="' + esc(dsUrl) + '" download>⬇ 下载原版</a></div></div>' : ""
    ].join("");
    const pinWrap = document.getElementById("pinWrap");
    const pinImg = document.getElementById("pinImg");
    if (item.pin_image) {
      pinWrap.classList.remove("hidden");
      pinImg.src = new URL(item.pin_image, document.baseURI).href;
      pinImg.alt = `${item.model} pin diagram`;
    } else {
      pinWrap.classList.add("hidden");
      pinImg.src = "";
      pinImg.alt = "Pin diagram";
    }

    el.specTable.innerHTML = "";
    el.specEmpty.classList.toggle("hidden", false);
    el.specEmpty.textContent = "加载中…";
    el.specEmpty.classList.remove("hidden");
    fetch(new URL("./data/specs/" + item.id + ".json", document.baseURI).href)
      .then(function (r) { return r.json(); })
      .then(function (specs) {
        el.specTable.innerHTML = "";
        el.specEmpty.classList.toggle("hidden", specs.length > 0);
        specs.slice(0, 300).forEach(function (spec) {
          const row = document.createElement("tr");
          var pHtml = spec.param_html || esc(spec.param);
          var vHtml = spec.value_html || ("<strong>" + esc(spec.value) + "</strong>");
          var cHtml = spec.conditions ? ("<br><span class=\"spec-cond\">[" + esc(spec.conditions) + "]</span>") : "";
          if (spec.conditions_html) {
            cHtml = "<br><span class=\"spec-cond\">[" + spec.conditions_html + "]</span>";
          }
          row.innerHTML = [
            "<td>" + pHtml + "</td>",
            "<td>" + vHtml + cHtml + "</td>"
          ].join("");
          el.specTable.appendChild(row);
        });
      })
      .catch(function () {
        el.specEmpty.textContent = "参数加载失败";
        el.specEmpty.classList.remove("hidden");
      });

    const docModels = products
      .filter(function (p) { return p.source_document_id === item.source_document_id && p.id !== item.id; })
      .sort(function (a, b) { return a.model.localeCompare(b.model); })
      .slice(0, 12);
    const funcModels = products
      .filter(function (p) { return p.function && p.function === item.function && p.id !== item.id && p.source_document_id !== item.source_document_id; })
      .sort(function (a, b) { return a.model.localeCompare(b.model); })
      .slice(0, 12);

    el.relatedDoc.innerHTML = relatedLinks(docModels, item.source_label);
    el.relatedFunc.innerHTML = relatedLinks(funcModels, item.function);

    el.detail.classList.remove("hidden");
    el.detail.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function metaItem(label, value) {
    return '<div class="meta-item"><div class="label">' + esc(label) + '</div><div class="value">' + esc(text(value)) + "</div></div>";
  }

  function relatedLinks(items, note) {
    if (!items.length) {
      return '<div class="empty">无</div>';
    }
    return items.map(function (item) {
      return '<a href="#" data-id="' + item.id + '">' + esc(item.model) + "<small>" + esc(text(item.function)) + " / " + esc(text(item.package)) + "</small></a>";
    }).join("");
  }

  function closeDetail() {
    el.detail.classList.add("hidden");
    el.detail.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function bindEvents() {
    el.q.addEventListener("input", function () {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runFilters, 120);
    });
    ["fFunction", "fSeries", "fPackage", "fLogic", "fApp"].forEach(function (id) {
      el[id].addEventListener("change", runFilters);
    });
    el.clearBtn.addEventListener("click", function () {
      el.q.value = "";
      ["fFunction", "fSeries", "fPackage", "fLogic", "fApp"].forEach(function (id) {
        el[id].value = "";
      });
      runFilters();
    });
    el.closeDetail.addEventListener("click", closeDetail);
    el.detailBackdrop.addEventListener("click", closeDetail);
    el.relatedDoc.addEventListener("click", relatedClick);
    el.relatedFunc.addEventListener("click", relatedClick);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDetail();
    });
  }

  function relatedClick(event) {
    const link = event.target.closest("[data-id]");
    if (!link) return;
    event.preventDefault();
    openDetail(Number(link.dataset.id));
  }

  function load() {
    fetch("./data/products.json")
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        data.forEach(function (item) {
          item.haystack = buildHaystack(item);
          products.push(item);
        });
        products.sort(function (a, b) { return a.model.localeCompare(b.model); });

        fillSelect(el.fFunction, products.map(function (p) { return p.function; }));
        fillSelect(el.fSeries, products.map(function (p) { return p.series; }));
        fillSelect(el.fPackage, products.map(function (p) { return p.package; }));
        fillSelect(el.fLogic, products.map(function (p) { return p.logic_type; }));
        fillSelect(el.fApp, products.reduce(function (acc, p) {
          return acc.concat(p.applications_domains || []);
        }, []));

        el.statModels.textContent = products.length;
        el.statSpecs.textContent = "18439";
        el.meta.textContent = "离线数据库 · 静态网页版";
        runFilters();
        setTimeout(function () { prefetchSpecs(products); }, 1500);
      })
      .catch(function (err) {
        el.meta.textContent = "数据加载失败";
        el.empty.textContent = "无法加载 products.json：" + err.message;
        el.empty.classList.remove("hidden");
      });
  }

  bindEvents();
  load();
})();
