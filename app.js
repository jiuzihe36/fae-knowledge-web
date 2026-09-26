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
    circuitWrap: document.getElementById("circuitWrap"),
    circuitImg: document.getElementById("circuitImg"),
    pinWrap: document.getElementById("pinWrap"),
    pinImg: document.getElementById("pinImg"),
    specTable: document.getElementById("specTable") && document.getElementById("specTable").querySelector("tbody"),
    specEmpty: document.getElementById("specEmpty"),
    relatedDoc: document.getElementById("relatedDoc"),
    relatedFunc: document.getElementById("relatedFunc"),
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

  /* ---------- specs 懒加载：首次开详情才拉（3.7MB，占 products 原体积 95%） ---------- */
  var SPECS = null, SPECS_PROMISE = null;
  function ensureSpecs() {
    if (SPECS) return Promise.resolve(SPECS);
    if (SPECS_PROMISE) return SPECS_PROMISE;
    SPECS_PROMISE = fetch("./data/specs.json?t=" + Math.floor(Date.now() / 60000))
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
    /* 详情页只需要 specs（参数表）。竞品/P2P 已摘除，不再加载。 */
    if (!SPECS) {
      ensureSpecs().then(function () { openDetail(id); });
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

    /* 竞品对标 / TI 对标 已按需求摘除（网页端不展示任何竞品信息） */

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

  /* 族规范化：优先用数据里的族名表做「最长前缀」匹配，避免正则猜封装后缀。
     型号只要以某个族名为前缀即归入该族（取最长的那个）。 */
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
    /* 首屏只拉精简版（446KB vs 4.16MB，specs 占 95% 已拆到 specs.json 懒加载） */
    fetch("./data/products_lite.json?t=" + Math.floor(Date.now() / 60000))
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

        el.statModels.textContent = products.length;
        el.statSpecs.textContent = "-";
        if (el.meta) el.meta.textContent = "离线数据库 · 静态网页版";

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
        if (el.empty) {
          el.empty.textContent = "无法加载产品数据：" + err.message;
          el.empty.classList.remove("hidden");
        }
      });
  }

  // 启动时按时间（或已存的手动选择）应用主题
  applyTheme(getStoredTheme());

  // 每整分钟检查：若用户未手动锁定，随时间自动切换纯白/纯黑
  setInterval(function () {
    if (getStoredTheme() === "auto") applyTheme("auto");
  }, 60 * 1000);

  bindEvents();
  /* 首屏：只拉 products_lite.json（446KB）—— 目录树/搜索/详情骨架全靠它。 */
  load();

})();
