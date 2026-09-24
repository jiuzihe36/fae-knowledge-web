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

  function normPn(value) {
    return String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function splitTokens(value) {
    return String(value == null ? "" : value)
      .split(/[;,，；、/|]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function slugTokens(slug) {
    return String(slug == null ? "" : slug).split(/[^A-Za-z0-9]+/).filter(Boolean);
  }

  function extractPns(value) {
    const matches = String(value == null ? "" : value).match(/[A-Za-z]{1,6}[0-9][A-Za-z0-9]{1,}/g) || [];
    const seen = Object.create(null);
    const out = [];
    matches.forEach(function (m) {
      const k = normPn(m);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(k);
    });
    return out;
  }

  /* 状态推导（不改 products.json）：Q100 优先，其次 Draft，其余 Product */
  // 电路图文件名 = 型号原样 (已与 circuits/ 下文件逐一对齐); 仅过滤路径穿越字符
  function safeCircuitName(model) {
    return String(model || "").replace(/[\/\\]/g, "_");
  }

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

  function verdictClass(verdict) {
    const raw = String(verdict == null ? "" : verdict);
    const s = raw.trim().toUpperCase();
    if (!s) return "";
    if (s.indexOf("[OK]") !== -1 || s === "OK" || s.indexOf("OK") === 0) return "ok";
    if (s.indexOf("[!]") !== -1 || s.indexOf("!") !== -1) return "warn";
    if (raw.indexOf("✖") !== -1 || raw.indexOf("✕") !== -1 || raw.indexOf("✗") !== -1 ||
        s.indexOf("[X]") !== -1 || s.indexOf("NG") !== -1 || s.indexOf("FAIL") !== -1) return "bad";
    return "";
  }

  function tiStatusClass(status) {
    const s = String(status == null ? "" : status).toUpperCase();
    if (s === "ACTIVE") return "active";
    if (s === "OBSOLETE") return "obsolete";
    if (s === "NOTFOUND") return "notfound";
    return "";
  }

  function tiStatus(index, pn) {
    const rec = index && index.status ? index.status[normPn(pn)] : null;
    return rec ? rec.status : "UNKNOWN";
  }

  function tiEvidence(index, pn) {
    const rec = index && index.status ? index.status[normPn(pn)] : null;
    return rec ? rec.evidence : "";
  }

  function evidenceHref(evidence) {
    const s = String(evidence == null ? "" : evidence).trim();
    if (!s) return "";
    const abs = s.match(/https?:\/\/[^\s)"'<>,;]+/);
    if (abs) return abs[0].replace(/[.,;]+$/, "");
    const rel = s.match(/\bti\.com\/[A-Za-z0-9/_-]+\/[A-Za-z0-9/_-]+/i);
    if (rel) return "https://" + rel[0];
    return "";
  }

  /* PN 的 ti.com 落地页：NOTFOUND 不给链接；否则优先证据链接，再回退官方 product 页 */
  function pnHref(index, pn) {
    const st = tiStatus(index, pn);
    if (st === "NOTFOUND") return "";
    const href = evidenceHref(tiEvidence(index, pn));
    if (href) return href;
    if (st === "ACTIVE" || st === "OBSOLETE") return "https://www.ti.com/product/" + normPn(pn);
    return "";
  }

  function evidenceHtml(evidence) {
    const raw = String(evidence == null ? "" : evidence).trim();
    if (!raw) return "—";
    const href = evidenceHref(raw);
    const shown = raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
    if (!href) return esc(shown);
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener" title="' + esc(raw) + '">' + esc(shown) + "</a>";
  }

  /* 客户端反查索引：遍历 ti[] / ti_index / logic / analog 建立 em、ti 双向索引 */
  function buildP2PIndex(p2p) {
    const data = p2p && typeof p2p === "object" ? p2p : {};
    const byEm = Object.create(null);
    const byTi = Object.create(null);
    const byAiP = Object.create(null);
    const status = Object.create(null);

    const tiIndex = data.ti_index && typeof data.ti_index === "object" ? data.ti_index : {};
    Object.keys(tiIndex).forEach(function (pn) {
      const raw = tiIndex[pn] || {};
      status[normPn(pn)] = {
        pn: pn,
        status: String(raw.status || "UNKNOWN").toUpperCase(),
        evidence: raw.evidence || ""
      };
    });

    function add(map, key, rec) {
      if (!key) return;
      (map[key] || (map[key] = [])).push(rec);
    }

    (Array.isArray(data.logic) ? data.logic : []).forEach(function (entry) {
      const rec = { kind: "logic", entry: entry, key: "logic|" + (entry.slug || "") + "|" + (entry.em || "") };
      splitTokens(entry.em).forEach(function (t) { add(byEm, normPn(t), rec); });
      slugTokens(entry.slug).forEach(function (t) { add(byEm, normPn(t), rec); });
      (Array.isArray(entry.ti) ? entry.ti : []).forEach(function (t) { add(byTi, normPn(t), rec); });
    });

    (Array.isArray(data.analog) ? data.analog : []).forEach(function (entry) {
      const rec = { kind: "analog", entry: entry, key: "analog|" + (entry.slug || "") + "|" + (entry.ti_text || "") };
      slugTokens(entry.slug).forEach(function (t) { add(byEm, normPn(t), rec); });
      extractPns(entry.ti_text).forEach(function (t) { add(byTi, normPn(t), rec); });
      extractPns(entry.evidence).forEach(function (t) { add(byTi, normPn(t), rec); });
    });

    (Array.isArray(data.aip) ? data.aip : []).forEach(function (entry) {
      const rec = { kind: "aip", entry: entry, key: "aip|" + (entry.model || "") + "|" + (entry.em || "") };
      add(byAiP, normPn(entry.model), rec);
      if (entry.em && entry.em !== "-") add(byEm, normPn(entry.em), rec);
    });

    return { byEm: byEm, byTi: byTi, byAiP: byAiP, status: status };

    /* ti_index 中未被 logic/analog 引用的孤立 PN（多为 NOTFOUND 记录）也要可反查 */
    Object.keys(status).forEach(function (k) {
      if (k in byTi) return;
      const raw = status[k];
      add(byTi, k, {
        kind: "status",
        entry: { slug: raw.pn, em: "", ti: [raw.pn], ti_text: raw.pn, verdict: "", note: "", evidence: raw.evidence },
        key: "status|" + k
      });
    });

    return { byEm: byEm, byTi: byTi, status: status, data: data };
  }

  /* EM / TI 双向查询：精确 → 前缀/包含 → 子串 */
  function searchP2P(index, query) {
    if (!index) return [];
    const q = normPn(query);
    if (!q) return [];
    const matchers = [
      function (k) { return k === q; },
      function (k) { return k.indexOf(q) === 0 || (k.length > 0 && q.indexOf(k) === 0); },
      function (k) { return k.indexOf(q) !== -1 || q.indexOf(k) !== -1; }
    ];
    for (let i = 0; i < matchers.length; i++) {
      const out = [];
      const seen = Object.create(null);
      [index.byEm, index.byTi, index.byAiP].forEach(function (map) {
        Object.keys(map).forEach(function (k) {
          if (!matchers[i](k)) return;
          map[k].forEach(function (rec) {
            if (seen[rec.key]) return;
            seen[rec.key] = true;
            out.push(rec);
          });
        });
      });
      if (out.length) {
        out.sort(function (a, b) {
          const ka = a.kind === "logic" ? 0 : 1;
          const kb = b.kind === "logic" ? 0 : 1;
          if (ka !== kb) return ka - kb;
          return String(a.entry.em || a.entry.slug || "").localeCompare(String(b.entry.em || b.entry.slug || ""));
        });
        return out;
      }
    }
    return [];
  }

  const MIN_PN = 5;

  /* 型号 → P2P 条目（详情 TI 对标卡用） */
  function entriesForModel(index, model) {
    const m = normPn(model);
    if (!index || !m) return [];
    const out = [];
    const seen = Object.create(null);
    Object.keys(index.byEm).forEach(function (k) {
      if (!k) return;
      if (!(m === k || (k.length >= MIN_PN && m.indexOf(k) === 0))) return;
      index.byEm[k].forEach(function (rec) {
        if (seen[rec.key]) return;
        seen[rec.key] = true;
        out.push(rec);
      });
    });
    out.sort(function (a, b) {
      const ka = a.kind === "logic" ? 0 : 1;
      const kb = b.kind === "logic" ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return String(a.entry.em || a.entry.slug || "").localeCompare(String(b.entry.em || b.entry.slug || ""));
    });
    return out;
  }

  /* 料号 → 型号对象（精确 → 前缀 → 子串，取最短命中） */
  function resolveModel(products, token) {
    const q = normPn(token);
    if (!q || !Array.isArray(products) || !products.length) return null;
    let i;
    let p;
    for (i = 0; i < products.length; i++) {
      if (normPn(products[i].model) === q) return products[i];
    }
    let best = null;
    let bestLen = Infinity;
    for (i = 0; i < products.length; i++) {
      p = products[i];
      const m = normPn(p.model);
      if (m.length >= MIN_PN && m.indexOf(q) === 0 && m.length < bestLen) { best = p; bestLen = m.length; }
    }
    if (best) return best;
    for (i = 0; i < products.length; i++) {
      p = products[i];
      const m = normPn(p.model);
      if (m.length >= MIN_PN && m.indexOf(q) !== -1 && m.length < bestLen) { best = p; bestLen = m.length; }
    }
    return best;
  }

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

  function specPlain(spec) {
    if (!spec) return "";
    let out = String(spec.value == null ? "" : spec.value);
    if (spec.conditions) out += " [" + spec.conditions + "]";
    return out;
  }

  function specHtml(spec) {
    if (!spec) return "";
    const v = spec.value_html || ("<strong>" + esc(spec.value) + "</strong>");
    let c = "";
    if (spec.conditions_html) {
      c = '<br><span class="spec-cond">[' + spec.conditions_html + "]</span>";
    } else if (spec.conditions) {
      c = '<br><span class="spec-cond">[' + esc(spec.conditions) + "]</span>";
    }
    return v + c;
  }

  function normParam(param) {
    return String(param == null ? "" : param).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function groupByKey(specs) {
    const map = Object.create(null);
    const order = [];
    (Array.isArray(specs) ? specs : []).forEach(function (s) {
      const k = normParam(s && s.param) || "—";
      if (!(k in map)) { map[k] = { key: k, param: String((s && s.param) || "—"), items: [] }; order.push(k); }
      map[k].items.push(s);
    });
    return order.map(function (k) { return map[k]; });
  }

  function joinedPlain(group) {
    const seen = Object.create(null);
    const out = [];
    group.items.forEach(function (s) {
      const v = specPlain(s) || "-";
      if (seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out.join("；");
  }

  function joinedHtml(group) {
    if (group.items.length === 1) return specHtml(group.items[0]);
    const seen = Object.create(null);
    const out = [];
    group.items.forEach(function (s) {
      const v = specPlain(s) || "-";
      if (seen[v]) return;
      seen[v] = true;
      out.push(esc(v));
    });
    return out.join("<br>");
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

  /* A/B 对比：关键字段 + 按 param 名合并的参数表，返回前 limit 行 */
  function compareProducts(a, b, limit) {
    limit = limit || 100;
    const A = a || {};
    const B = b || {};
    const fields = CMP_FIELDS.map(function (f) {
      const av = text(A[f[0]]);
      const bv = text(B[f[0]]);
      return { key: f[0], label: f[1], a: av, b: bv, diff: av !== bv };
    });
    const ga = groupByKey(A.specs);
    const gb = groupByKey(B.specs);
    const mb = Object.create(null);
    gb.forEach(function (g) { mb[g.key] = g; });
    const used = Object.create(null);
    const rows = [];
    ga.forEach(function (g) {
      const other = mb[g.key] || null;
      used[g.key] = true;
      const av = joinedPlain(g);
      const bv = other ? joinedPlain(other) : "—";
      rows.push({
        param: g.param,
        aHtml: joinedHtml(g),
        bHtml: other ? joinedHtml(other) : "—",
        a: av,
        b: bv,
        diff: av !== bv
      });
    });
    gb.forEach(function (g) {
      if (used[g.key]) return;
      rows.push({
        param: g.param,
        aHtml: "—",
        bHtml: joinedHtml(g),
        a: "—",
        b: joinedPlain(g),
        diff: true
      });
    });
    return { fields: fields, rows: rows.slice(0, limit), total: rows.length, shown: Math.min(rows.length, limit) };
  }

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

  const P2P = {
    esc: esc,
    text: text,
    normPn: normPn,
    splitTokens: splitTokens,
    slugTokens: slugTokens,
    extractPns: extractPns,
    deriveStatus: deriveStatus,
    statusBadgeHtml: statusBadgeHtml,
    verdictClass: verdictClass,
    tiStatusClass: tiStatusClass,
    tiStatus: tiStatus,
    tiEvidence: tiEvidence,
    evidenceHref: evidenceHref,
    pnHref: pnHref,
    evidenceHtml: evidenceHtml,
    buildP2PIndex: buildP2PIndex,
    searchP2P: searchP2P,
    entriesForModel: entriesForModel,
    resolveModel: resolveModel,
    groupSpecs: groupSpecs,
    specPlain: specPlain,
    specHtml: specHtml,
    groupByKey: groupByKey,
    compareProducts: compareProducts,
    buildHaystack: buildHaystack,
    recJumpToken: function (rec) {
      if (rec.kind === "status") return "";
      const e = rec.entry;
      const list = rec.kind === "logic" ? splitTokens(e.em).concat(slugTokens(e.slug)) : slugTokens(e.slug);
      return list.length ? normPn(list[0]) : "";
    }
  };

  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = P2P;
  }
  if (typeof document === "undefined") return;

  /* =========================================================
   * DOM 层
   * ========================================================= */

  const THEME_KEY = "xs-theme";
  const FILTER_IDS = ["fFunction", "fSeries", "fPackage", "fLogic", "fApp", "fStatus"];
  const RENDER_LIMIT = 500;

  const products = [];
  let p2p = null;
  let p2pIndex = null;
  let filtered = [];
  let debounceTimer = null;
  let p2pTimer = null;

  const el = {
    meta: document.getElementById("meta"),
    statModels: document.getElementById("statModels"),
    statSpecs: document.getElementById("statSpecs"),
    themeBtn: document.getElementById("themeBtn"),
    viewTabs: document.getElementById("viewTabs"),
    viewList: document.getElementById("viewList"),
    viewSearch: document.getElementById("viewSearch"),
    viewCompare: document.getElementById("viewCompare"),
    viewComp: document.getElementById("viewComp"),
    compVendorTabs: document.getElementById("compVendorTabs"),
    compQuery: document.getElementById("compQuery"),
    compCat: document.getElementById("compCat"),
    compCount: document.getElementById("compCount"),
    compResults: document.getElementById("compResults"),
    compTotal: document.getElementById("compTotal"),
    q: document.getElementById("q"),
    fFunction: document.getElementById("fFunction"),
    fSeries: document.getElementById("fSeries"),
    fPackage: document.getElementById("fPackage"),
    fLogic: document.getElementById("fLogic"),
    fApp: document.getElementById("fApp"),
    fStatus: document.getElementById("fStatus"),
    clearBtn: document.getElementById("clearBtn"),
    resultCount: document.getElementById("resultCount"),
    tableBody: document.getElementById("tableBody"),
    empty: document.getElementById("empty"),
    p2pQuery: document.getElementById("p2pQuery"),
    p2pResults: document.getElementById("p2pResults"),
    p2pEmpty: document.getElementById("p2pEmpty"),
    cmpA: document.getElementById("cmpA"),
    cmpB: document.getElementById("cmpB"),
    cmpBtn: document.getElementById("cmpBtn"),
    cmpSwap: document.getElementById("cmpSwap"),
    cmpResult: document.getElementById("cmpResult"),
    cmpEmpty: document.getElementById("cmpEmpty"),
    modelList: document.getElementById("modelList"),
    detail: document.getElementById("detail"),
    detailBackdrop: document.querySelector(".drawer-backdrop"),
    closeDetail: document.getElementById("closeDetail"),
    detailModel: document.getElementById("detailModel"),
    detailBadges: document.getElementById("detailBadges"),
    detailDesc: document.getElementById("detailDesc"),
    detailMeta: document.getElementById("detailMeta"),
    tiCard: document.getElementById("tiCard"),
    compCard: document.getElementById("compCard"),
    compNote: document.getElementById("compNote"),
    compList: document.getElementById("compList"),
    compIndexNote: document.getElementById("compIndexNote"),
    tiNote: document.getElementById("tiNote"),
    tiList: document.getElementById("tiList"),
    circuitWrap: document.getElementById("circuitWrap"),
    circuitImg: document.getElementById("circuitImg"),
    pinWrap: document.getElementById("pinWrap"),
    pinImg: document.getElementById("pinImg"),
    specTable: document.getElementById("specTable").querySelector("tbody"),
    specEmpty: document.getElementById("specEmpty"),
    relatedDoc: document.getElementById("relatedDoc"),
    relatedFunc: document.getElementById("relatedFunc"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightboxImg"),
    lightboxCap: document.getElementById("lightboxCap"),
    lightboxClose: document.getElementById("lightboxClose")
  };

  /* ---------- 视图切换 ---------- */

  function switchView(name) {
    const views = { list: el.viewList, search: el.viewSearch, compare: el.viewCompare, comp: el.viewComp };
    Object.keys(views).forEach(function (key) {
      const active = key === name;
      views[key].classList.toggle("hidden", !active);
      views[key].setAttribute("aria-hidden", active ? "false" : "true");
    });
    const tabs = el.viewTabs.querySelectorAll(".tab");
    Array.prototype.forEach.call(tabs, function (tab) {
      const active = tab.dataset.view === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  /* ---------- 主题（localStorage 仅存主题） ---------- */

  function getStoredTheme() {
    try {
      return window.localStorage.getItem(THEME_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
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
    if (mode === "dark" || mode === "light") {
      document.documentElement.setAttribute("data-theme", mode);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const dark = isDarkNow(mode);
    el.themeBtn.textContent = dark ? "☀️" : "🌙";
    el.themeBtn.title = dark ? "切换到浅色" : "切换到深色";
  }

  function toggleTheme() {
    const mode = getStoredTheme();
    const next = isDarkNow(mode) ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch (e) { /* 忽略 */ }
    applyTheme(next);
  }

  /* ---------- 列表 ---------- */

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
    const fStatus = el.fStatus.value;

    filtered = products.filter(function (item) {
      if (fFunction && item.function !== fFunction) return false;
      if (fSeries && item.series !== fSeries) return false;
      if (fPackage && item.package !== fPackage) return false;
      if (fLogic && item.logic_type !== fLogic) return false;
      if (fApp && (item.applications_domains || []).indexOf(fApp) === -1) return false;
      if (fStatus && deriveStatus(item) !== fStatus) return false;
      if (q && item.haystack.indexOf(q) === -1) return false;
      return true;
    });

    el.resultCount.textContent = filtered.length;
    renderRows();
  }

  function renderRows() {
    el.tableBody.innerHTML = "";
    el.empty.classList.toggle("hidden", filtered.length > 0);
    if (!filtered.length) return;

    const rows = filtered.slice(0, RENDER_LIMIT).map(function (item) {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;
      tr.innerHTML = [
        '<td class="model-cell" data-label="型号">' + esc(item.model) + statusBadgeHtml(deriveStatus(item)) + "</td>",
        '<td data-label="功能">' + esc(text(item.function_detail || item.function)) + "</td>",
        '<td data-label="系列">' + esc(text(item.series)) + "</td>",
        '<td data-label="封装">' + esc(text(item.package)) + "</td>",
        '<td data-label="逻辑类型">' + esc(text(item.logic_type)) + "</td>",
        '<td data-label="电压">' + esc(text(item.voltage)) + "</td>",
        '<td data-label="封装尺寸">' + esc(text(item.package_size)) + "</td>"
      ].join("");
      return tr;
    });

    rows.forEach(function (tr) {
      tr.addEventListener("click", function () {
        openDetail(Number(tr.dataset.id));
      });
    });
    el.tableBody.append.apply(el.tableBody, rows);

    if (filtered.length > RENDER_LIMIT) {
      const note = document.createElement("tr");
      note.innerHTML = '<td colspan="7" class="empty">显示前 ' + RENDER_LIMIT + " 条，继续搜索可缩小范围</td>";
      el.tableBody.appendChild(note);
    }
  }

  /* ---------- 详情 ---------- */

  function displayEm(entry) {
    if (entry && entry.em) return entry.em;
    const tokens = slugTokens(entry && entry.slug);
    if (tokens.length) return tokens.map(function (t) { return t.toUpperCase(); }).join(" / ");
    return text(entry && entry.slug);
  }

  function recJumpToken(rec) {
    if (rec.kind === "status") return "";
    const e = rec.entry;
    if (rec.kind === "aip") return e.em && e.em !== "-" ? normPn(splitTokens(e.em)[0] || "") : "";
    const list = rec.kind === "logic"
      ? splitTokens(e.em).concat(slugTokens(e.slug))
      : slugTokens(e.slug);
    return list.length ? normPn(list[0]) : "";
  }

  /* ---------- specs 懒加载：首次开详情才拉（3.7MB，占 products 原体积 95%） ---------- */
  var SPECS = null, SPECS_PROMISE = null;
  function ensureSpecs() {
    if (SPECS) return Promise.resolve(SPECS);
    if (SPECS_PROMISE) return SPECS_PROMISE;
    SPECS_PROMISE = fetch("./data/specs.json")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) {
        SPECS = m || {};
        /* 回填到每个产品，后续代码无感知 */
        products.forEach(function (p) {
          if (SPECS[String(p.id)]) p.specs = SPECS[String(p.id)];
        });
        /* 顺带把参数总数补上（首屏占位 "-"） */
        if (el.statSpecs) {
          var n = 0;
          products.forEach(function (p) { if (Array.isArray(p.specs)) n += p.specs.length; });
          el.statSpecs.textContent = n;
        }
        return SPECS;
      })
      .catch(function (e) { console.warn("[specs] 加载失败", e); SPECS = {}; return SPECS; });
    return SPECS_PROMISE;
  }

  function openDetail(id) {
    const item = products.find(function (p) { return p.id === id; });
    if (!item) return;
    /* 详情页需要 specs（参数表）+ 竞品/P2P（竞品对标区块）。
       首次打开时并发拉齐，之后就同步走（各 loader 幂等）。 */
    if (!SPECS) {
      Promise.all([ensureSpecs(), loadComp(), loadCompP2P(), loadP2P(), loadParams()])
        .then(function () { openDetail(id); });
      return;
    }

    el.detailModel.textContent = item.model;
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
      metaItem("应用场景", (item.applications_domains || []).join("、") || item.applications),
      dsUrl ? '<div class="meta-item"><div class="label">规格书</div><div class="value"><a href="' + esc(dsUrl) + '" target="_blank" rel="noopener">👁 查看</a> · <a href="' + esc(dsUrl) + '" download>⬇ 下载</a></div></div>' : ""
    ].join("");

    renderTiCard(item);
    renderCompCard(item);

    // 应用电路图: circuits/{model}_wiring.svg (670 款全量, 引脚与走向取自规格书)
    const circuitUrl = new URL("./circuits/" + safeCircuitName(item.model) + "_wiring.svg", document.baseURI).href;
    const circuitSrc = item.circuit_svg
      ? new URL(item.circuit_svg, document.baseURI).href
      : circuitUrl;
    if (el.circuitWrap && el.circuitImg) {
      if (item.circuit_svg !== null) {
        el.circuitWrap.classList.remove("hidden");
        el.circuitImg.src = circuitSrc;
        el.circuitImg.alt = item.model + " 应用电路图";
      } else {
        el.circuitWrap.classList.add("hidden");
        el.circuitImg.src = "";
        el.circuitImg.alt = "Application circuit";
      }
    }

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

    const specs = Array.isArray(item.specs) ? item.specs : [];
    el.specTable.innerHTML = "";
    el.specEmpty.classList.toggle("hidden", specs.length > 0);
    const groups = groupSpecs(specs.slice(0, 300));
    groups.forEach(function (group) {
      const head = document.createElement("tr");
      head.className = "spec-group";
      head.innerHTML = '<td colspan="2">' + esc(group.kind) + " · " + group.items.length + "</td>";
      el.specTable.appendChild(head);
      group.items.forEach(function (spec) {
        const row = document.createElement("tr");
        row.innerHTML = "<td>" + (spec.param_html || esc(spec.param)) + "</td><td>" + specHtml(spec) + "</td>";
        el.specTable.appendChild(row);
      });
    });

    const docModels = products
      .filter(function (p) { return p.source_label && p.source_label === item.source_label && p.id !== item.id; })
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

  function renderTiCard(item) {
    el.tiCard.classList.remove("hidden");
    if (!p2p) {
      el.tiNote.textContent = "";
      el.tiList.innerHTML = '<div class="ti-empty">数据未就绪</div>';
      return;
    }
    const recs = entriesForModel(p2pIndex, item.model);
    el.tiNote.textContent = p2p.generated ? "· 数据截至 " + p2p.generated : "";
    if (!recs.length) {
      el.tiList.innerHTML = '<div class="ti-empty">暂无该型号的 TI 对标数据</div>';
      return;
    }
    el.tiList.innerHTML = recs.map(tiRowHtml).join("");
  }

  /* ---------- 竞品对标（圣邦/中微爱芯/帝奥微） ---------- */
  var compP2P = null;
  var paramData = null;
  function __xxHook() { window.__xx = window.__xx || {}; }
  var paramIndex = null;
  var compP2PIndex = null;   /* family -> item */
  var compByModel = null;    /* 芯祥型号 -> item */

  function buildCompIndex(data) {
    var byFamily = Object.create(null);
    var byModel = Object.create(null);
    var items = (data && Array.isArray(data.items)) ? data.items : [];
    items.forEach(function (it) {
      byFamily[it.family] = it;
      (it.em || []).forEach(function (m) {
        var k = normPn(m);
        if (!byModel[k]) byModel[k] = [];
        if (byModel[k].indexOf(it) < 0) byModel[k].push(it);
      });
    });
    var famKeys = Object.keys(byFamily).sort(function (a, b) { return b.length - a.length; });
    return { byFamily: byFamily, byModel: byModel, famKeys: famKeys, data: data };
  }

  /* 从型号推功能族，兜底匹配（byModel 未命中时） */
  function famOf(model) {
    var s = normPn(model);
    /* 先剥厂商前缀，与后端 Python 侧的族提取保持一致 */
    var pres = ["EMS", "EXS", "EM", "EL", "AIP", "SGM", "DIO", "CD", "HEF", "MC", "SN"];
    for (var i = 0; i < pres.length; i++) {
      if (s.indexOf(pres[i]) === 0 && s.length > pres[i].length) { s = s.slice(pres[i].length); break; }
    }
    var m = s.match(/^(74[A-Z]{2,4}\d{1,3}G?\d{1,3})/);
    if (m) return m[1];
    m = s.match(/^(4\d{3})/);
    if (m) return m[1];
    m = s.match(/^([A-Z]{0,4}\d{3,4})/);
    return m ? m[1] : s;
  }

  /* 族规范化：优先用数据里的族名表做「最长前缀」匹配，避免正则猜封装后缀。
     compP2PIndex.byFamily 的键就是权威族名（74CBTLV3257、74AHC1G08、3157…），
     型号只要以某个族名为前缀即归入该族（取最长的那个）。 */
  function canonFam(f) {
    if (!compP2PIndex || !compP2PIndex.famKeys) return f;
    var keys = compP2PIndex.famKeys;
    var best = "";
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (f.indexOf(k) === 0 && k.length > best.length) best = k;
    }
    return best || f;
  }

  function compItemsForModel(model) {
    if (!compP2PIndex) return [];
    var k = normPn(model);
    var hit = compP2PIndex.byModel[k];
    if (hit && hit.length) return hit;
    var f = canonFam(famOf(model));
    var it = compP2PIndex.byFamily[f];
    if (it) return [it];
    /* 前缀兜底：74CBTLV3257PW → 74CBTLV3257 */
    var keys = Object.keys(compP2PIndex.byFamily);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (f.length >= 5 && (k.indexOf(f) === 0 || f.indexOf(k) === 0) && Math.abs(k.length - f.length) <= 2) {
        return [compP2PIndex.byFamily[k]];
      }
    }
    return [];
  }

  function compVendorName(v) { return COMP_VN[v] || v; }

  /* 单个竞品料号的参数对比块 */
  function fmtLim(min, max, unit) {
    if (min === null && max === null) return "—";
    var lo = (min === null || min === undefined) ? "" : String(min);
    var hi = (max === null || max === undefined) ? "" : String(max);
    if (lo && hi) return lo + " ~ " + hi + (unit || "");
    if (hi) return "≤ " + hi + (unit || "");
    return "≥ " + lo + (unit || "");
  }

  function verdictBadge(v) {
    var cls = v === "参数一致" ? "badge-ok" : (v === "有差异" ? "badge-warn" : "badge-muted");
    return '<span class="badge ' + cls + '">' + esc(v || "—") + "</span>";
  }

  function compParamBlock(c, pr) {
    var html = '<div class="comp-blk">';
    html += '<div class="comp-blk-head">' +
      '<span class="comp-badge comp-' + esc(c.v) + '">' + esc(compVendorName(c.v)) + "</span> " +
      '<span class="mono"><b>' + esc(c.pn) + "</b></span>";
    if (pr) html += " " + verdictBadge(pr.verdict);
    html += '<a class="comp-dl" href="' + esc(c.url || "") + '" target="_blank" rel="noopener" style="margin-left:8px">规格书 ↗</a>';
    html += "</div>";
    if (!pr || !pr.params || !pr.params.length) {
      html += '<div class="ti-note">该型号暂无提取到的参数对比（可点规格书人工核对）</div></div>';
      return html;
    }
    html += '<table class="comp-param-table"><thead><tr>' +
      "<th>参数</th><th>芯祥 " + esc(pr.em) + "</th><th>" + esc(compVendorName(c.v)) + " " + esc(c.pn) + "</th><th>判定</th>" +
      "</tr></thead><tbody>";
    pr.params.forEach(function (p_) {
      var emTxt = p_.em_val || p_.em_raw || "—";
      var cTxt = (p_.comp_param ? esc(p_.comp_param) + " " : "") + fmtLim(p_.comp_min, p_.comp_max, "");
      var v = p_.verdict || "";
      var vCls = v === "一致" ? "v-ok" : (v === "类别不同" ? "v-muted" : "v-diff");
      html += "<tr>" +
        "<td>" + esc(p_.label) + ' <span class="mono comp-sym">' + esc(p_.sym) + "</span></td>" +
        '<td class="mono">' + esc(emTxt) + "</td>" +
        '<td class="mono">' + cTxt + "</td>" +
        '<td class="' + vCls + '">' + esc(v) + "</td>" +
        "</tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }


  /* 竞品料号 → 芯祥替代（点型号可直接跳到详情，带参数判定徽标） */
  function emForCompPn(pn) {
    if (!compP2PIndex) return '<span class="comp-none">—</span>';
    var f = canonFam(famOf(pn));
    var it = compP2PIndex.byFamily[f];
    if (!it || !it.em || !it.em.length) return '<span class="comp-none">—</span>';
    var links = it.em.map(function (m) {
      return '<a class="comp-em-link mono" href="#" data-model="' + esc(m) + '">' + esc(m) + "</a>";
    }).join(" ");
    /* 附参数判定：取该竞品料号下最好的一个判定 */
    var best = "";
    if (paramData && Array.isArray(paramData.items)) {
      var rank = { "参数一致": 3, "有差异": 2, "需核对": 1 };
      (it.em || []).forEach(function (m) {
        (paramIndex[normPn(m)] || []).forEach(function (pr) {
          if (pr.comp_pn === pn && pr.comp_vendor === it.comps[0].v) {
            if ((rank[pr.verdict] || 0) > (rank[best] || 0)) best = pr.verdict;
          }
        });
      });
    }
    return links + (best ? " " + verdictBadge(best) : "");
  }


  function renderCompCard(item) {
    if (!el.compCard) return;
    var items = compItemsForModel(item.model);
    el.compCard.classList.remove("hidden");
    if (!compP2P) {
      el.compNote.textContent = "";
      el.compList.innerHTML = '<div class="ti-empty">数据未就绪</div>';
      return;
    }
    var gen = compP2P.generated || "";
    el.compNote.textContent = gen ? "· 数据截至 " + gen : "";
    if (!items.length) {
      el.compList.innerHTML = '<div class="ti-empty">暂无该型号的竞品对标数据（仅覆盖与竞品同功能族的料号）</div>';
      return;
    }
    var html = "";
    /* 该型号的参数级对比（按竞品料号索引） */
    var pmap = Object.create(null);
    var pkey = normPn(item.model);
    (paramIndex && paramIndex[pkey] ? paramIndex[pkey] : []).forEach(function (pr) {
      pmap[pr.comp_vendor + "|" + pr.comp_pn] = pr;
    });
    items.forEach(function (it) {
      var comps = Array.isArray(it.comps) ? it.comps : [];
      if (!comps.length) return;
      html += '<div class="ti-row">';
      html += '<div class="comp-head"><span class="mono"><b>' + esc(it.em.join(" / ")) + "</b></span>";
      if (it.em_func) html += '<span class="ti-note">' + esc(it.em_func) + "</span>";
      if (it.em_pkg && it.em_pkg.length) html += '<span class="ti-note">封装可选 ' + esc(it.em_pkg.join("、")) + "</span>";
      html += "</div>";
      html += '<div class="comp-same">同功能族：<span class="mono">' + esc(it.family) + "</span>（" + comps.length + " 个竞品料号）</div>";
      comps.forEach(function (c) {
        var pr = pmap[c.v + "|" + c.pn];
        html += compParamBlock(c, pr);
      });
      html += "</div>";
    });
    el.compList.innerHTML = html || '<div class="ti-empty">暂无该型号的竞品对标数据</div>';
  }

  function tiStatusBadgesHtml(pns, dedupe) {
    const seen = Object.create(null);
    const out = [];
    pns.forEach(function (pn) {
      const st = tiStatus(p2pIndex, pn);
      const key = dedupe ? st : pn + "|" + st;
      if (seen[key]) return;
      seen[key] = true;
      out.push('<span class="badge ' + tiStatusClass(st) + '">' + esc(st) + "</span>");
    });
    return out.join("");
  }


  function tiRowHtml(rec) {
    const e = rec.entry;
    const verdict = String(e.verdict || "").trim();
    const verdictHtml = verdict ? '<span class="badge ' + verdictClass(verdict) + '">' + esc(verdict) + "</span>" : "";
    const noteHtml = e.note ? '<div class="ti-note">' + esc(e.note) + "</div>" : "";

    if (rec.kind === "logic") {
      const tiList = Array.isArray(e.ti) ? e.ti : [];
      if (!tiList.length) return '<div class="ti-row"><div class="ti-empty">暂无 TI 对应型号</div></div>';
      const nxpList = Array.isArray(e.nxp) ? e.nxp : [];
      return tiList.map(function (pn, idx) {
        const st = tiStatus(p2pIndex, pn);
        const evi = tiEvidence(p2pIndex, pn);
        const href = pnHref(p2pIndex, pn);
        /* 家族电压按位覆盖: HC+HCT/AHC+AHCT 合并条目的第二颗是 4.5–5.5V,
           无 vcc_parts 时回落条目级值(单 TI 条目不受影响) */
        const part = (Array.isArray(e.vcc_parts) && e.vcc_parts[idx]) || null;
        const vccEm = (part && part.vcc_em) || e.vcc_em;
        const vccTi = (part && part.vcc_ti) || e.vcc_ti;
        const noteText = (part && part.note) || e.note;
        const noteHtml = noteText ? '<div class="ti-note">' + esc(noteText) + "</div>" : "";
        const pnHtml = href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(pn) + "</a>"
          : esc(pn);
        const vcc = (vccEm || vccTi)
          ? '<div class="ti-evi">VCC 芯祥 ' + esc(text(vccEm)) + " / TI " + esc(text(vccTi)) + "</div>"
          : "";
        const nxpPn = nxpList[idx];
        const nxpHtml = nxpPn
          ? '<div class="ti-line ti-nxp-line"><span class="ti-tag">NXP</span><span class="ti-pn">' + esc(nxpPn) + "</span>" +
            '<a class="ti-evi" href="https://www.nexperia.com/products/' + esc(nxpPn.toLowerCase()) + '/" target="_blank" rel="noopener">查证 ↗</a></div>'
          : "";
        return [
          '<div class="ti-row">',
          '<div class="ti-line"><span class="ti-pn">' + pnHtml + "</span>",
          '<span class="badge ' + tiStatusClass(st) + '">' + esc(st) + "</span>",
          verdictHtml,
          "</div>",
          vcc,
          nxpHtml,
          noteHtml,
          '<div class="ti-evi">证据：' + evidenceHtml(evi) + "</div>",
          "</div>"
        ].join("");
      }).join("");
    }

    const pns = extractPns(e.ti_text).concat(extractPns(e.evidence));
    return [
      '<div class="ti-row">',
      '<div class="ti-line"><span class="ti-plain">' + esc(text(e.ti_text)) + "</span>",
      tiStatusBadgesHtml(pns, true),
      verdictHtml,
      "</div>",
      noteHtml,
      '<div class="ti-evi">证据：' + evidenceHtml(e.evidence) + "</div>",
      "</div>"
    ].join("");
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

  /* ---------- 替代查询视图 ---------- */

  function p2pBadgesHtml(rec) {
    const e = rec.entry;
    const out = [];
    const verdict = String(e.verdict || "").trim();
    if (verdict) out.push('<span class="badge ' + verdictClass(verdict) + '">' + esc(verdict) + "</span>");
    if (rec.kind === "logic") {
      out.push(tiStatusBadgesHtml(Array.isArray(e.ti) ? e.ti : [], false));
    } else if (rec.kind === "status") {
      out.push(tiStatusBadgesHtml(Array.isArray(e.ti) ? e.ti : [], false));
    } else {
      out.push(tiStatusBadgesHtml(extractPns(e.ti_text).concat(extractPns(e.evidence)), true));
    }
    return out.join("");
  }

  function p2pCardHtml(rec) {
    const e = rec.entry;
    const token = esc(recJumpToken(rec));
    if (rec.kind === "aip") {
      const emHtml = (e.em && e.em !== "-")
        ? '<span class="p2p-em">' + esc(displayEm(e)) + "</span>"
        : '<span class="p2p-em p2p-na" title="芯祥暂无直接对应料号">—</span>';
      const aipHtml = '<span>' + esc(e.model) + '</span>';
      const head = [
        '<div class="p2p-top">',
        emHtml,
        '<span class="p2p-arrow">→</span>',
        '<span class="p2p-ti">' + aipHtml + "</span>",
        '<span class="p2p-badges">' + p2pBadgesHtml(rec) + "</span>",
        "</div>"
      ].join("");
      const meta = '<div class="p2p-meta"><span>竞品：<b>' + esc(text(e.competitor)) + "</b></span>" +
        (e.pins && e.pins !== "-" ? "<span>引脚：" + esc(e.pins) + "</span>" : "") + "</div>";
      const note = e.note ? '<div class="p2p-note">备注：' + esc(e.note) + "</div>" : "";
      return '<article class="p2p-card" data-em="' + token + '" tabindex="0">' + head + meta + note + "</article>";
    }
    const tiHtml = rec.kind === "logic"
      ? (Array.isArray(e.ti) ? e.ti : []).map(function (pn) { return "<span>" + esc(pn) + "</span>"; }).join("")
      : "<span>" + esc(text(e.ti_text)) + "</span>";
    const emHtml = rec.kind === "status"
      ? '<span class="p2p-em p2p-na" title="无对应芯祥料号">—</span>'
      : '<span class="p2p-em">' + esc(displayEm(e)) + "</span>";
    const head = [
      '<div class="p2p-top">',
      emHtml,
      '<span class="p2p-arrow">→</span>',
      '<span class="p2p-ti">' + tiHtml + "</span>",
      '<span class="p2p-badges">' + p2pBadgesHtml(rec) + "</span>",
      "</div>"
    ].join("");
    const meta = rec.kind === "logic"
      ? '<div class="p2p-meta"><span>VCC 芯祥：<b>' + esc(text(e.vcc_em)) + "</b></span><span>VCC TI：<b>" + esc(text(e.vcc_ti)) + "</b></span></div>"
      : "";
    const note = e.note ? '<div class="p2p-note">备注：' + esc(e.note) + "</div>" : "";
    const evi = rec.kind !== "logic" && e.evidence
      ? '<div class="p2p-note">证据：' + evidenceHtml(e.evidence) + "</div>"
      : "";
    return '<article class="p2p-card" data-em="' + token + '" tabindex="0">' + head + meta + note + evi + "</article>";
  }

  function renderP2P() {
    if (!p2p) {
      el.p2pResults.innerHTML = "";
      el.p2pEmpty.textContent = "数据未就绪";
      el.p2pEmpty.classList.remove("hidden");
      return;
    }
    const q = el.p2pQuery.value.trim();
    if (!q) {
      el.p2pResults.innerHTML = "";
      el.p2pEmpty.textContent = "输入芯祥 / TI / 竞品料号开始查询，例如 EM74HC00 / SN74HC00 / SGM7SZ00 / AiP74LVC1G08";
      el.p2pEmpty.classList.remove("hidden");
      return;
    }
    const recs = searchP2P(p2pIndex, q);
    const compRecs = searchCompP2P(q);
    if (!recs.length && !compRecs.length) {
      el.p2pResults.innerHTML = "";
      el.p2pEmpty.textContent = "没有匹配「" + q + "」的替代关系";
      el.p2pEmpty.classList.remove("hidden");
      return;
    }
    el.p2pEmpty.classList.add("hidden");
    const shown = recs.slice(0, 100);
    el.p2pResults.innerHTML =
      compRecs.map(compP2PRowHtml).join("") +
      shown.map(p2pCardHtml).join("") +
      (recs.length > shown.length
        ? '<div class="p2p-count">显示前 100 条，共 ' + recs.length + " 条，继续输入可缩小范围</div>"
        : "");
  }


  /* 去厂商前缀：SGM74HC541 → 74HC541, AiP74LVC1G08 → 74LVC1G08 */
  function stripVendor(s) {
    var pres = ["AIP", "SGM", "DIO", "EMS", "EXS", "EM", "EL", "CD", "HEF", "MC", "SN"];
    for (var i = 0; i < pres.length; i++) {
      if (s.indexOf(pres[i]) === 0 && s.length > pres[i].length) return s.slice(pres[i].length);
    }
    return s;
  }

  /* 竞品料号反查：输入圣邦/AiP/DIOO 料号 → 给芯祥替代 */
  function searchCompP2P(query) {
    if (!compP2PIndex) return [];
    var q = normPn(query);
    if (!q || q.length < 3) return [];
    var out = [];
    var seen = Object.create(null);
    /* 查询词也去厂商前缀：SGM74HC541 → 74HC541 */
    var qn = stripVendor(q);
    (compP2PIndex.data.items || []).forEach(function (it) {
      var hit = false;
      (it.comps || []).forEach(function (c) {
        var p = normPn(c.pn);
        var pn = stripVendor(p);
        if (p === q || pn === q || pn === qn ||
            p.indexOf(q) === 0 || pn.indexOf(q) === 0 || pn.indexOf(qn) === 0 ||
            (q.length >= 5 && (p.indexOf(q) !== -1 || pn.indexOf(qn) !== -1))) hit = true;
      });
      if (!hit) return;
      if (seen[it.family]) return;
      seen[it.family] = true;
      /* 精确度打分：竞品料号与查询词完全相等 > 去掉厂商前缀后相等 > 前缀 */
      var score = 3;
      (it.comps || []).forEach(function (c) {
        var p = normPn(c.pn), pn = stripVendor(p);
        if (p === q || pn === q) score = Math.min(score, 0);
        else if (pn === qn) score = Math.min(score, 1);
      });
      out.push({ it: it, score: score });
    });
    out.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.it.family.localeCompare(b.it.family);
    });
    return out.slice(0, 30).map(function (r) { return r.it; });
  }

  function compP2PRowHtml(it) {
    var ems = (it.em || []).map(function (m) {
      return '<a class="comp-em-link mono" href="#" data-model="' + esc(m) + '">' + esc(m) + "</a>";
    }).join("、");
    var comps = (it.comps || []).map(function (c) {
      return '<span class="comp-badge comp-' + esc(c.v) + '">' + esc(compVendorName(c.v)) + "</span> " +
             '<span class="mono">' + esc(c.pn) + "</span>";
    }).join(" ｜ ");
    return '<div class="p2p-card comp-p2p-card">' +
      '<div class="p2p-head"><span class="badge badge-ok">芯祥替代</span>' +
      '<span class="ti-note">' + esc(it.em_func || "") + "</span></div>" +
      '<div class="comp-p2p-em">' + ems + "</div>" +
      '<div class="comp-p2p-competitors">竞品：' + comps + "</div>" +
      "</div>";
  }

  function jumpToProduct(token) {
    const target = resolveModel(products, token);
    switchView("list");
    if (target) {
      openDetail(target.id);
    } else {
      el.q.value = token;
      runFilters();
    }
  }

  /* ---------- A/B 对比视图 ---------- */

  function runCompare() {
    const a = resolveModel(products, el.cmpA.value);
    const b = resolveModel(products, el.cmpB.value);
    if (!products.length) {
      showCmpEmpty("型号数据未加载");
      return;
    }
    if (!a || !b) {
      showCmpEmpty("未找到匹配型号，可输入部分料号后从下拉建议中选择");
      return;
    }
    if (a.id === b.id) {
      showCmpEmpty("请选择两个不同型号（当前 A、B 命中同一型号 " + a.model + "）");
      return;
    }
    el.cmpEmpty.classList.add("hidden");

    const c = compareProducts(a, b, 100);
    const head = '<thead><tr><th>字段</th><th><a href="#" class="cmp-model-link" data-open="' + a.id + '">' + esc(a.model) + '</a></th><th><a href="#" class="cmp-model-link" data-open="' + b.id + '">' + esc(b.model) + "</a></th></tr></thead>";
    const fieldRows = c.fields.map(function (f) {
      return '<tr class="' + (f.diff ? "cmp-diff" : "") + '"><td>' + esc(f.label) + "</td><td>" + esc(f.a) + "</td><td>" + esc(f.b) + "</td></tr>";
    }).join("");
    const specRows = c.rows.map(function (r) {
      return '<tr class="' + (r.diff ? "cmp-diff" : "") + '"><td>' + esc(r.param) + "</td><td>" + r.aHtml + "</td><td>" + r.bHtml + "</td></tr>";
    }).join("");
    const foot = c.total > c.shown
      ? '<div class="cmp-foot">显示前 ' + c.shown + " 行，共 " + c.total + " 行（余 " + (c.total - c.shown) + " 行未显示）</div>"
      : '<div class="cmp-foot">共 ' + c.total + " 行</div>";

    el.cmpResult.innerHTML = [
      '<div class="cmp-block"><h3>关键字段对比</h3><table class="cmp-table">', head,
      "<tbody>", fieldRows, "</tbody></table></div>",
      '<div class="cmp-block"><h3>电气参数对比</h3><table class="cmp-table"><thead><tr><th>参数</th><th>',
      esc(a.model), "</th><th>", esc(b.model), "</th></tr></thead><tbody>", specRows, "</tbody></table>", foot, "</div>"
    ].join("");
  }

  function showCmpEmpty(message) {
    el.cmpResult.innerHTML = "";
    el.cmpEmpty.textContent = message;
    el.cmpEmpty.classList.remove("hidden");
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
    el.q.addEventListener("input", function () {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runFilters, 120);
    });
    FILTER_IDS.forEach(function (id) {
      el[id].addEventListener("change", runFilters);
    });
    el.clearBtn.addEventListener("click", function () {
      el.q.value = "";
      FILTER_IDS.forEach(function (id) { el[id].value = ""; });
      runFilters();
    });

    el.viewTabs.addEventListener("click", function (event) {
      const tab = event.target.closest(".tab");
      if (!tab) return;
      switchView(tab.dataset.view);
    });

    el.p2pQuery.addEventListener("input", function () {
      window.clearTimeout(p2pTimer);
      p2pTimer = window.setTimeout(renderP2P, 120);
    });
    el.p2pResults.addEventListener("click", function (event) {
      const card = event.target.closest(".p2p-card");
      if (!card) return;
      jumpToProduct(card.getAttribute("data-em"));
    });
    el.p2pResults.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      const card = event.target.closest(".p2p-card");
      if (!card) return;
      event.preventDefault();
      jumpToProduct(card.getAttribute("data-em"));
    });

    el.cmpBtn.addEventListener("click", runCompare);
    el.cmpSwap.addEventListener("click", function () {
      const tmp = el.cmpA.value;
      el.cmpA.value = el.cmpB.value;
      el.cmpB.value = tmp;
      if (el.cmpResult.innerHTML) runCompare();
    });
    [el.cmpA, el.cmpB].forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          runCompare();
        }
      });
    });
    el.cmpResult.addEventListener("click", function (event) {
      const link = event.target.closest("[data-open]");
      if (!link) return;
      event.preventDefault();
      openDetail(Number(link.getAttribute("data-open")));
    });

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
    el.relatedDoc.addEventListener("click", relatedClick);
    el.relatedFunc.addEventListener("click", relatedClick);

    // 空值保护: 浏览器缓存旧版 index.html 时新元素为 null, 直接 addEventListener 会抛错中断整个 init
    if (el.pinImg) el.pinImg.addEventListener("click", function () { openLightbox(el.pinImg); });
    if (el.circuitImg) el.circuitImg.addEventListener("click", function () { openLightbox(el.circuitImg); });
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
  }

  function relatedClick(event) {
    const link = event.target.closest("[data-id]");
    if (!link) return;
    event.preventDefault();
    openDetail(Number(link.dataset.id));
  }

  /* ---------- 数据加载 ---------- */

  function load() {
    // 首屏骨架屏
    var skCols = [40, 60, 30, 50, 40, 30, 70];
    var skHtml = "";
    for (var r = 0; r < 12; r++) {
      skHtml += '<tr class="skeleton-row">';
      for (var c = 0; c < skCols.length; c++) {
        skHtml += '<td><div class="sk-bar w' + skCols[c] + '"></div></td>';
      }
      skHtml += "</tr>";
    }
    el.tableBody.innerHTML = skHtml;

    /* 首屏只拉精简版（446KB vs 4.16MB，specs 占 95% 已拆到 specs.json 懒加载） */
    fetch("./data/products_lite.json")
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

        el.modelList.innerHTML = "";
        products.forEach(function (p) {
          const opt = document.createElement("option");
          opt.value = p.model;
          el.modelList.appendChild(opt);
        });

        el.statModels.textContent = products.length;
        el.statSpecs.textContent = "-";
        if (el.meta) el.meta.textContent = "离线数据库 · 静态网页版";
        el.tableBody.innerHTML = "";
        runFilters();
        /* 首屏渲染完成后空闲时预取 specs（不阻塞首屏，点开详情时已就绪） */
        var prefetch = function () { ensureSpecs(); };
        if (window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 3000 });
        else setTimeout(prefetch, 1200);

        /* 桥接给 unified.js：数据 + 按型号打开详情 */
        window.__xx = window.__xx || {};
        window.__xx.products = products;
        window.__xx.openByModel = function (model) {
          const m = String(model || "").toUpperCase();
          const item = products.find(function (p) { return p.model.toUpperCase() === m; })
            || products.find(function (p) { return p.model.toUpperCase().indexOf(m) === 0; });
          if (item) openDetail(item.id);
        };
      })
      .catch(function (err) {
        if (el.meta) el.meta.textContent = "数据加载失败";
        el.empty.textContent = "无法加载产品数据：" + err.message;
        el.empty.classList.remove("hidden");
        el.tableBody.innerHTML = "";
      });
  }

  /* ---------- P2P 数据懒加载 ----------
     首页只需要 products_lite，以下四份（合计约 4MB）只在真正用到时才拉：
       p2p.json / p2p_competitor.json / competitor_index.json / p2p_params.json
     每份带 _loaded / _promise 标记，重复调用不会重复请求。 */
  function lazyLoad(name, flag, url, onData) {
    var st = lazyLoad._st = lazyLoad._st || {};
    if (st[flag]) return Promise.resolve(st[flag]);
    if (st[flag + "_p"]) return st[flag + "_p"];
    st[flag + "_p"] = fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { st[flag] = d || (flag === "comp" ? [] : {}); return onData(st[flag]); })
      .catch(function (e) { console.warn("[" + name + "] 加载失败", e); st[flag] = (flag === "comp" ? [] : {}); return onData(st[flag]); });
    return st[flag + "_p"];
  }

  function loadP2P() {
    return lazyLoad("p2p", "p2p", "./data/p2p.json", function (data) {
      p2p = data && typeof data === "object" ? data : null;
      p2pIndex = p2p ? buildP2PIndex(p2p) : null;
      __xxHook(); window.__xx.p2p = p2p; window.__xx.p2pIndex = p2pIndex;
      renderP2P();
    });
  }

  /* ---------- 竞品规格书视图 ---------- */
  var compData = null;
  var compVendor = "";
  var compTimer = null;
  var compCat = "";
  var COMP_VN = { SGM: "圣邦", AiP: "中微爱芯", DIOO: "帝奥微", TI: "TI", NXP: "NXP" };

  function compFillCats() {
    if (!compData) return;
    var seen = {};
    compData.forEach(function (r) {
      if (compVendor && r.v !== compVendor) return;
      seen[r.c] = 1;
    });
    var cats = Object.keys(seen).sort();
    var html = '<option value="">全部分类</option>';
    cats.forEach(function (c) {
      html += '<option value="' + esc(c) + '">' + esc(c) + " (" + (byCat(c)) + ")</option>";
    });
    el.compCat.innerHTML = html;
    function byCat(c) {
      var n = 0;
      compData.forEach(function (r) { if (r.c === c && (!compVendor || r.v === compVendor)) n++; });
      return n;
    }
  }

  function renderComp() {
    if (!compData) {
      el.compResults.innerHTML = '<div class="empty">加载失败或暂无数据</div>';
      return;
    }
    var kw = (el.compQuery.value || "").trim().toLowerCase();
    var rows = compData.filter(function (r) {
      if (compVendor && r.v !== compVendor) return false;
      if (compCat && r.c !== compCat) return false;
      if (kw) {
        var hay = (r.p + " " + r.c + " " + (r.d || "") + " " + (r.k || "")).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    el.compCount.textContent = "命中 " + rows.length + " 条" + (rows.length > 300 ? "（仅显示前 300 条，请继续缩小范围）" : "");
    if (!rows.length) {
      el.compResults.innerHTML = '<div class="empty">没有匹配的规格书</div>';
      return;
    }
    var html = '<table class="comp-table"><thead><tr>' +
      "<th>厂商</th><th>型号</th><th>分类</th><th>功能描述</th><th>封装</th><th>芯祥对应</th><th>大小</th><th>规格书</th>" +
      "</tr></thead><tbody>";
    rows.slice(0, 300).forEach(function (r) {
      html += "<tr>" +
        '<td><span class="comp-badge comp-' + esc(r.v) + '">' + esc(COMP_VN[r.v] || r.v) + "</span></td>" +
        '<td class="mono"><b>' + esc(r.p) + "</b></td>" +
        "<td>" + esc(r.c) + "</td>" +
        "<td>" + esc(r.d || "-") + "</td>" +
        '<td class="mono">' + esc(r.k || "-") + "</td>" +
        "<td>" + emForCompPn(r.p) + "</td>" +
        "<td>" + (r.s ? r.s + " MB" : "-") + "</td>" +
        '<td><a class="comp-dl" href="' + esc(r.u) + '" target="_blank" rel="noopener">官网下载 ↗</a></td>' +
        "</tr>";
    });
    html += "</tbody></table>";
    el.compResults.innerHTML = html;
  }

  function loadParams() {
    return lazyLoad("params", "params", "./data/p2p_params.json", function (data) {
      paramData = data && typeof data === "object" ? data : null;
      paramIndex = Object.create(null);
      (paramData && Array.isArray(paramData.items) ? paramData.items : []).forEach(function (it) {
        var k = normPn(it.em);
        if (!paramIndex[k]) paramIndex[k] = [];
        paramIndex[k].push(it);
      });
      __xxHook(); window.__xx.paramData = paramData; window.__xx.paramIndex = paramIndex;
    });
  }

  function loadCompP2P() {
    return lazyLoad("compP2P", "compP2P", "./data/p2p_competitor.json", function (data) {
      compP2P = data && typeof data === "object" ? data : null;
      compP2PIndex = compP2P ? buildCompIndex(compP2P) : null;
      __xxHook(); window.__xx.compP2P = compP2P; window.__xx.compP2PIndex = compP2PIndex;
    });
  }

  function loadComp() {
    return lazyLoad("comp", "comp", "./data/competitor_index.json", function (data) {
      compData = Array.isArray(data) ? data : [];
      if (el.compTotal) el.compTotal.textContent = compData.length;
      __xxHook(); window.__xx.compIndex = compData;
      compFillCats();
      renderComp();
    });
  }

  // 启动时按时间（或已存的手动选择）应用主题
  applyTheme(getStoredTheme());

  // 每整分钟检查：若用户未手动锁定，随时间自动切换纯白/纯黑
  setInterval(function () {
    if (getStoredTheme() === "auto") applyTheme("auto");
  }, 60 * 1000);

  el.compVendorTabs.addEventListener("click", function (event) {
    var btn = event.target.closest(".comp-vtab");
    if (!btn) return;
    Array.prototype.forEach.call(el.compVendorTabs.querySelectorAll(".comp-vtab"), function (b) {
      b.classList.toggle("active", b === btn);
    });
    compVendor = btn.dataset.v || "";
    compCat = "";
    el.compCat.value = "";
    compFillCats();
    renderComp();
  });
  el.compQuery.addEventListener("input", function () {
    window.clearTimeout(compTimer);
    compTimer = window.setTimeout(renderComp, 120);
  });
  el.compCat.addEventListener("change", function () {
    compCat = el.compCat.value || "";
    renderComp();
  });
  el.compResults.addEventListener("click", function (event) {
    var a = event.target.closest("a.comp-em-link");
    if (!a) return;
    event.preventDefault();
    jumpToProduct(a.dataset.model);
  });

  bindEvents();
  switchView("list");
  renderP2P();
  /* 首屏：只拉 products_lite.json（446KB）—— 目录树/搜索/详情骨架全靠它。
     P2P 数据（p2p/comp/compP2P/params 合计约 4MB）改为按需：
     竞品相关只在竞品面板打开时拉，p2p_params 只在参数对比展开时拉。 */
  load();

  /* 空闲预热：等首屏可交互之后再悄悄拉竞品索引（打开竞品面板即秒开） */
  var warm = function () { loadComp(); };
  if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 5000 });
  else setTimeout(warm, 2500);
})();
