#!/usr/bin/env node
/**
 * 目录树「渲染层」折叠自检（跑 unified.js 的真实渲染函数 + 真实 catalog.json）
 *
 * 与同目录 verify_catalog_tree.js 的分工：
 *   verify_catalog_tree.js  = 数据层（catalog.json 的计数/分层/覆盖率）
 *   本脚本                  = 渲染层（点击后 HTML 到底变了没有）
 *
 * 为什么需要：数据全对、语法检查全过、页面也「能跑」，但某层的行是**写死的 HTML 字符串**
 * （aria-expanded="false"、caret 永远 ▸、内容区空着），没读折叠状态 ——
 * 表现是「展开上一层后，点这一层没反应」。数据层脚本抓不到这类错。
 *
 * 做法：从 unified.js 里按括号配平抠出渲染函数，拼成一个模块跑真实数据，
 * 模拟 bindTree 的点击写入状态，断言每一层的行数变化 —— 只断言「有结果」会
 * 放过「点上去像有反应又像没反应」的 bug，必须断言**各层行数的增量**。
 *
 * 用法：node verify_tree_interaction.js [unified.js] [catalog.json]
 * 退出码非 0 = 有 FAIL。进部署前 gate。
 */
const fs = require('fs');

const JS = process.argv[2] || '/Users/hu/fae-knowledge-web/unified.js';
const CAT = process.argv[3] || '/Users/hu/fae-knowledge-web/data/catalog.json';
const src = fs.readFileSync(JS, 'utf8');
const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));

/* 按大括号配平抠出 function <name>(...) 的完整定义 */
function slice(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('unified.js 里找不到 ' + name + '()');
  let d = 0;
  for (let p = src.indexOf('{', i); p < src.length; p++) {
    if (src[p] === '{') d++;
    else if (src[p] === '}') { d--; if (!d) return src.slice(i, p + 1); }
  }
  throw new Error(name + '() 大括号不配平');
}

/* 渲染函数清单 —— 层级改了要同步改这里，漏一个就会在启动时抛错提醒 */
const RENDERERS = ['renderModels', 'renderRoutes', 'renderFuncs', 'renderSeriesList', 'renderProcs', 'renderCatalog'];
const body = `
var openCats = Object.create(null), openProcs = Object.create(null),
    openSeries = Object.create(null), openFuncs = Object.create(null), openSers = Object.create(null);
var CATALOG = ${JSON.stringify(cat)};
var el = { catTree: { innerHTML: "" }, catCount: { textContent: "" } };
/* window 桩：渲染函数里有移动端判断（window.innerWidth），Node 里没有 window */
var window = { innerWidth: 1440 };
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
function renderCrumb(){}
${RENDERERS.map(slice).join('\n')}

/* 与 bindTree 的写状态逻辑保持一致 */
function click(cls, a) {
  var k;
  if (cls === "cat-row")      openCats[a.cat] = !openCats[a.cat];
  else if (cls === "grp-row") { k = a.cat + "|" + a.proc;                 openProcs[k]  = !openProcs[k]; }
  else if (cls === "pro-row") { k = a.cat + "|" + a.path;                 openSeries[k] = !openSeries[k]; }
  else if (cls === "func-row"){ k = a.cat + "|" + a.path;                 openFuncs[k]  = !openFuncs[k]; }
  else if (cls === "ser-row") { k = a.cat + "|" + a.path + "|" + a.ser;   openSers[k]   = !openSers[k]; }
  renderCatalog();
}
/* 默认展开最大类 —— 真实代码里在 afterReady() 里做（unified.js:68-72），
   不在 renderCatalog() 里；测试桩必须复刻这一步，否则初始态恒为空，
   会误报「初始态无展开」「点工艺组不出系列行」等一串假失败。 */
(function defaultExpand() {
  if (CATALOG && CATALOG.cats && CATALOG.cats.length) {
    var big = CATALOG.cats.slice().sort(function (a, b) { return b.count - a.count; })[0];
    if (big) openCats[big.key] = true;
  }
  renderCatalog();
})();
function counts() {
  var h = el.catTree.innerHTML, c = (re) => (h.match(re) || []).length;
  return { cat: c(/class="cat-row/g), grp: c(/class="grp-row/g), pro: c(/class="pro-row/g),
           func: c(/class="func-row/g), ser: c(/class="ser-row/g), mod: c(/class="mod-row/g), html: h };
}
module.exports = { click, counts };
`;

const tmp = require('os').tmpdir() + '/__tree_interaction_' + process.pid + '.js';
fs.writeFileSync(tmp, body);
let T;
try { T = require(tmp); } finally { fs.unlinkSync(tmp); }

let fails = [];
const ok = (n, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); if (!cond) fails.push(n); };

/* 取一条真实路径（用数据里实际存在的名字，不写死字符串） */
const c0 = cat.cats.slice().sort((a, b) => b.count - a.count)[0];
const procWithName = (c0.procs || []).find(p => p.name);
const s0 = procWithName ? procWithName.series[0]
                        : (c0.procs || [])[0].series[0];
const f0 = s0.funcs[0];
const r0 = (f0.routes || [])[0];

console.log('路径样本：' + [c0.name, procWithName && procWithName.name, s0.name, f0.name, r0 && r0.name]
  .filter(Boolean).join(' → '));
console.log('-'.repeat(62));

let c = T.counts();
const rowsOf = (x) => [x.cat, x.grp, x.pro, x.func, x.ser, x.mod].join('/');

/* 1. 初始态：必须至少有一个大类展开（否则用户打开只看到光秃秃几行） */
ok('初始态含展开的大类', c.cat > 0 && c.grp > 0, '大类' + c.cat + ' 工艺组' + c.grp);

/* 2. 逐层点击，每层必须真的新生出下一层行 —— 这是抓「写死的行」的核心断言 */
T.click('grp-row', { cat: c0.key, proc: procWithName ? procWithName.name : '' });
c = T.counts();
ok('点工艺组 → 出系列行', c.pro > 0, rowsOf(c));

const proBefore = c.pro;
T.click('pro-row', { cat: c0.key, path: s0.name });
c = T.counts();
ok('点系列 → 出功能行', c.func > 0, rowsOf(c));
ok('点系列后系列行数不因重渲而丢失', c.pro >= proBefore, c.pro + ' vs ' + proBefore);

T.click('func-row', { cat: c0.key, path: s0.name + '>' + f0.name });
c = T.counts();
ok('点功能 → 出路数行', c.ser > 0, rowsOf(c));

if (r0) {
  T.click('ser-row', { cat: c0.key, path: s0.name + '>' + f0.name, ser: r0.name });
  c = T.counts();
  ok('点路数 → 出型号行', c.mod > 0, rowsOf(c));
}

/* 3. 逐层收起必须回退（点两次 = 回到上一态） */
T.click('ser-row', { cat: c0.key, path: s0.name + '>' + f0.name, ser: r0 ? r0.name : '' });
c = T.counts();
ok('再点路数 → 型号行收起', c.mod === 0, rowsOf(c));

T.click('func-row', { cat: c0.key, path: s0.name + '>' + f0.name });
c = T.counts();
ok('再点功能 → 路数行收起', c.ser === 0, rowsOf(c));

T.click('pro-row', { cat: c0.key, path: s0.name });
c = T.counts();
ok('再点系列 → 功能行收起', c.func === 0, rowsOf(c));

/* 4. 渲染函数不许只剩一份定义被覆盖（同名重复定义会静默漂移） */
RENDERERS.forEach(n => {
  const cnt = (src.match(new RegExp('function ' + n + '\\(', 'g')) || []).length;
  ok('函数唯一 ' + n, cnt === 1, cnt + ' 份');
});

/* 5. 反模式扫描：某层行模板里不许出现写死的 aria-expanded="false"/静态 caret */
['renderProcs', 'renderSeriesList', 'renderFuncs', 'renderRoutes'].forEach(n => {
  const bodyTxt = slice(n);
  const hardFalse = /aria-expanded="false"/.test(bodyTxt);
  const delegate = /render(SeriesList|Funcs|Routes)\(/.test(bodyTxt);
  /* 要么自己按状态渲染，要么委托给下层渲染器；两者都没有 = 写死的行 */
  const readsState = /open(Procs|Series|Funcs|Sers)\[/.test(bodyTxt);
  ok(n + ' 读状态或委托下层', readsState || delegate,
     'readsState=' + readsState + ' delegate=' + delegate + (hardFalse ? ' 含写死的 aria-expanded=false' : ''));
});

console.log('-'.repeat(62));
if (fails.length) { console.log('FAILED: ' + fails.length + ' / ' + fails.join('; ')); process.exit(1); }
console.log('ALL PASS');
