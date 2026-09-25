const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = '/Users/hu/fae-knowledge-web';
const liteArr = JSON.parse(fs.readFileSync(ROOT + '/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync(ROOT + '/index.html', 'utf-8');
const uniJs = fs.readFileSync(ROOT + '/unified.js', 'utf-8');
html = html.replace(/<script src="\.\/app\.js\?v=[^"]*"><\/script>/, '')
           .replace(/<script src="\.\/unified\.js\?v=[^"]*"><\/script>/, '<script>' + uniJs + '</script>');
const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost:8899/',
  beforeParse(window) {
    window.__xx = { products: liteArr };
    window.fetch = (u, ...rest) => { let url = String(u); if (url[0] === '.') url = 'http://localhost:8899/' + url.replace(/^\.\//, ''); return fetch(url, ...rest); };
    window.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
    window.scrollTo = () => {};
  }
});
const { window } = dom, doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, e || '')); };
(async () => {
  await sleep(2500);
  doc.querySelector('.band-in a[data-page="docs"]').click();
  await sleep(2000);

  // ① 表头点击排序
  const ths = [...doc.querySelectorAll('.doc-head .doc-th')];
  const first = () => (doc.querySelector('.doc-row') || {}).textContent?.replace(/\s+/g, ' ') || '';
  const row0a = first();
  const modelTh = ths.find(t => t.dataset.sort === 'm');
  ck('型号表头有 data-sort=m', !!modelTh);
  modelTh.click(); await sleep(400);
  const asc0 = (doc.querySelector('.doc-row') || {}).textContent?.replace(/\s+/g, ' ') || '';
  modelTh.click(); await sleep(400);
  const desc0 = (doc.querySelector('.doc-row') || {}).textContent?.replace(/\s+/g, ' ') || '';
  ck('点表头后首行变化', asc0 !== row0a, row0a.slice(0, 40) + ' → ' + asc0.slice(0, 40));
  ck('再点切换排序方向', asc0 !== desc0, asc0.slice(0, 30) + ' vs ' + desc0.slice(0, 30));
  console.log('    升序首行:', asc0.slice(0, 50));
  console.log('    降序首行:', desc0.slice(0, 50));

  // ② 打开详情 + ESC 关闭
  const r0 = doc.querySelector('.doc-row');
  const detailBefore = !!doc.querySelector('.detail-panel:not(.hidden), #detailBox:not(.hidden), .modal:not(.hidden)');
  r0.click(); await sleep(900);
  const opened = !!doc.querySelector('.detail-panel:not(.hidden), #detailBox:not(.hidden), .modal:not(.hidden)');
  ck('点击行能打开详情', opened || detailBefore !== opened, 'opened=' + opened);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(500);
  const closed = !doc.querySelector('.detail-panel:not(.hidden), #detailBox:not(.hidden), .modal:not(.hidden)');
  ck('ESC 关闭详情', closed, 'closed=' + closed);

  console.log(`\n${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
