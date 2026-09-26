/* 应用页新功能测试：
   ① 搜索覆盖应用场景（搜 I2C 能找到开漏反相器，它们本身不含 I2C 字样）
   ② 应用页筛选框（场景名/型号/功能任一命中）
   ③ 大场景按功能二次分组（125 款门电路 → 与门/与非门/…）+ 展开不截断
   ④ 详情 → 场景 跳转桥接
   用法：node scripts/tests/test_apps_features.js（需 8899 本地服务在跑）
   实现要点（与 test_treefilter.js 一致）：
     - jsdom 不执行外联 <script src> → 把 unified.js 内联进 HTML 再喂给 jsdom
     - 相对 fetch 转绝对；node-fetch 未装 → 用 Node 内置 fetch
     - 顶层数据是数组 → 注入 {products: liteArr} */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = '/Users/hu/fae-knowledge-web';
const liteArr = JSON.parse(fs.readFileSync(ROOT + '/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync(ROOT + '/index.html', 'utf-8');
const uniJs = fs.readFileSync(ROOT + '/unified.js', 'utf-8');
html = html.replace(/<script src="\.\/app\.js\?v=[^"]*"><\/script>/, '')
           .replace(/<script src="\.\/unified\.js\?v=[^"]*"><\/script>/, '<script>' + uniJs + '</script>');
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdomError]', e.message));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost:8899/',
  beforeParse(window) {
    window.__xx = { products: liteArr };
    window.fetch = (u, ...rest) => { let url = String(u); if (url[0] === '.') url = 'http://localhost:8899/' + url.replace(/^\.\//, ''); return fetch(url, ...rest); };
    window.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
  }
});
const { window } = dom, doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const type = (f, v) => { f.value = v; f.dispatchEvent(new window.Event('input', { bubbles: true })); };
let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, extra || '')); };

(async () => {
  await sleep(3000);

  console.log('\n=== ① 搜索覆盖应用场景 ===');
  const q = doc.getElementById('q');
  check('搜索框存在', !!q);
  if (q) {
    type(q, 'I2C'); await sleep(1000);
    const results = doc.getElementById('results');
    const cards = results ? results.querySelectorAll('.rcard').length : 0;
    const summary = (doc.getElementById('resultSummary') || {}).textContent || '';
    console.log('    摘要:', JSON.stringify(summary));
    check('搜 I2C 有结果（旧版 0 条）', cards > 0, '结果卡=' + cards);
    check('摘要含条数', /\d+\s*款|\d+\s*条/.test(summary), summary);
    /* 场景关键词也应命中：搜「总线隔离」 */
    type(q, '总线隔离'); await sleep(1000);
    const c2 = doc.getElementById('results').querySelectorAll('.rcard').length;
    check('搜「总线隔离」（场景名）有结果', c2 > 0, '结果卡=' + c2);
    type(q, ''); await sleep(500);
  }

  console.log('\n=== ② 应用页筛选框 ===');
  /* 切到应用页 */
  const appLink = Array.prototype.find.call(
    doc.querySelectorAll('.band-in a[data-page]'), a => a.getAttribute('data-page') === 'apps');
  check('应用页导航存在', !!appLink);
  if (appLink) {
    appLink.click(); await sleep(2500);
    const appQ = doc.getElementById('appQ');
    check('应用页筛选框存在', !!appQ);
    if (appQ) {
      const total = doc.getElementById('appGrid').querySelectorAll('.app-card').length;
      console.log('    初始场景数:', total);
      type(appQ, 'USB'); await sleep(600);
      const n = doc.getElementById('appGrid').querySelectorAll('.app-card').length;
      const cnt = (doc.getElementById('appCount') || {}).textContent || '';
      check('筛 USB 出场景且少于全部', n > 0 && n < total, '命中 ' + n + ' / ' + total);
      check('计数显示 x / 总数', /\d+ \/ \d+/.test(cnt), cnt);
      type(appQ, ''); await sleep(600);
      const n2 = doc.getElementById('appGrid').querySelectorAll('.app-card').length;
      check('清空筛选回全部', n2 === total, '得到 ' + n2 + ' 期望 ' + total);
    }
  }

  console.log('\n=== ③ 大场景按功能二次分组 + 不截断 ===');
  const grid = doc.getElementById('appGrid');
  if (grid) {
    const cards = grid.querySelectorAll('.app-card');
    let grouped = '', subCount = 0;
    for (const c of cards) {
      const subs = c.querySelectorAll('.app-sub');
      if (subs.length > 1) { grouped = c.getAttribute('data-app'); subCount = subs.length; break; }
    }
    check('存在按功能二次分组的场景', !!grouped, grouped ? grouped + ' 分 ' + subCount + ' 组' : '未找到 .app-sub');
    let trunc = '';
    for (const c of cards) {
      const cnt = parseInt(((c.querySelector('.app-count') || {}).textContent || '0').replace(/[^\d]/g, ''), 10);
      const mods = c.querySelectorAll('.app-mod').length;
      if (mods && cnt && mods !== cnt) { trunc = c.getAttribute('data-app') + ': 显示 ' + mods + ' / 应有 ' + cnt; break; }
    }
    check('展开列表不截断（旧版 slice(0,60)）', !trunc, trunc);
  }

  console.log('\n=== ④ 详情 → 场景 跳转桥接 ===');
  check('window.__xx.goAppScene 已暴露', typeof window.__xx.goAppScene === 'function');

  console.log('\n=== ' + pass + ' 通过, ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
})();
