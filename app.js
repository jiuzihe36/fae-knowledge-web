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
      [index.byEm, index.byTi].forEach(function (map) {
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
    tiNote: document.getElementById("tiNote"),
    tiList: document.getElementById("tiList"),
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
    const views = { list: el.viewList, search: el.viewSearch, compare: el.viewCompare };
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
    const list = rec.kind === "logic"
      ? splitTokens(e.em).concat(slugTokens(e.slug))
      : slugTokens(e.slug);
    return list.length ? normPn(list[0]) : "";
  }

  function openDetail(id) {
    const item = products.find(function (p) { return p.id === id; });
    if (!item) return;

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
      dsUrl ? '<div class="meta-item"><div class="label">规格书</div><div class="value"><a href="' + esc(dsUrl) + '" target="_blank" rel="noopener">👁 查看</a> · <a href="' + esc(dsUrl.replace("/datasheets/", "/datasheets_view/")) + '" target="_blank" rel="noopener">👁 快速查看</a> · <a href="' + esc(dsUrl) + '" download>⬇ 下载原版</a></div></div>' : ""
    ].join("");

    renderTiCard(item);

    if (item.pin_image) {
      el.pinWrap.classList.remove("hidden");
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
      return tiList.map(function (pn) {
        const st = tiStatus(p2pIndex, pn);
        const evi = tiEvidence(p2pIndex, pn);
        const href = pnHref(p2pIndex, pn);
        const pnHtml = href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(pn) + "</a>"
          : esc(pn);
        const vcc = (e.vcc_em || e.vcc_ti)
          ? '<div class="ti-evi">VCC 芯祥 ' + esc(text(e.vcc_em)) + " / TI " + esc(text(e.vcc_ti)) + "</div>"
          : "";
        return [
          '<div class="ti-row">',
          '<div class="ti-line"><span class="ti-pn">' + pnHtml + "</span>",
          '<span class="badge ' + tiStatusClass(st) + '">' + esc(st) + "</span>",
          verdictHtml,
          "</div>",
          vcc,
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
      el.p2pEmpty.textContent = "输入 EM 或 TI 料号开始查询，例如 EM74HC00 / SN74HC00";
      el.p2pEmpty.classList.remove("hidden");
      return;
    }
    const recs = searchP2P(p2pIndex, q);
    if (!recs.length) {
      el.p2pResults.innerHTML = "";
      el.p2pEmpty.textContent = "没有匹配「" + q + "」的替代关系";
      el.p2pEmpty.classList.remove("hidden");
      return;
    }
    el.p2pEmpty.classList.add("hidden");
    const shown = recs.slice(0, 100);
    el.p2pResults.innerHTML = shown.map(p2pCardHtml).join("") +
      (recs.length > shown.length
        ? '<div class="p2p-count">显示前 100 条，共 ' + recs.length + " 条，继续输入可缩小范围</div>"
        : "");
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

  function openLightbox() {
    if (!el.pinImg.src) return;
    el.lightboxImg.src = el.pinImg.src;
    el.lightboxImg.alt = el.pinImg.alt;
    el.lightboxCap.textContent = el.pinImg.alt;
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

    el.pinImg.addEventListener("click", openLightbox);
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

        el.modelList.innerHTML = "";
        products.forEach(function (p) {
          const opt = document.createElement("option");
          opt.value = p.model;
          el.modelList.appendChild(opt);
        });

        const specCount = products.reduce(function (sum, p) {
          return sum + (Array.isArray(p.specs) ? p.specs.length : 0);
        }, 0);
        el.statModels.textContent = products.length;
        el.statSpecs.textContent = specCount;
        el.meta.textContent = "离线数据库 · 静态网页版";
        el.tableBody.innerHTML = "";
        runFilters();
      })
      .catch(function (err) {
        el.meta.textContent = "数据加载失败";
        el.empty.textContent = "无法加载 products.json：" + err.message;
        el.empty.classList.remove("hidden");
        el.tableBody.innerHTML = "";
      });
  }

  function loadP2P() {
    fetch("./data/p2p.json")
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        p2p = data && typeof data === "object" ? data : null;
        p2pIndex = p2p ? buildP2PIndex(p2p) : null;
        renderP2P();
      })
      .catch(function () {
        p2p = null;
        p2pIndex = null;
        renderP2P();
      });
  }

  // 启动时按时间（或已存的手动选择）应用主题
  applyTheme(getStoredTheme());

  // 每整分钟检查：若用户未手动锁定，随时间自动切换纯白/纯黑
  setInterval(function () {
    if (getStoredTheme() === "auto") applyTheme("auto");
  }, 60 * 1000);

  bindEvents();
  switchView("list");
  renderP2P();
  load();
  loadP2P();
})();
