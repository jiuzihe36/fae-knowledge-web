const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = '/Users/hu/fae-knowledge-web';
const liteArr = JSON.parse(fs.readFileSync(ROOT + '/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync(ROOT + '/index.html', 'utf-8');
const uniJs = fs.readFileSync(ROOT + '/unified.js', 'utf-8');
html = html.replace(/<script src="\.\/app\.js\?v=[^"]*"><\/script>/, '')
           .replace(/<script src="\.\/unified\.js\?v=[^"]*"><\/script>/, '<script>' + uniJs + '</script>');
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => errs.push(e.message));
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
(async () => {
  await sleep(2500);
  const link = doc.querySelector('.band-in a[data-page="docs"]');
  console.log('导航链接存在:', !!link);
  if (link) { link.click(); await sleep(2000); }
  const head = doc.querySelector('.doc-head');
  const ths = doc.querySelectorAll('.doc-head .doc-th');
  const rows = doc.querySelectorAll('.doc-row');
  console.log('doc-head:', !!head, '| doc-th:', ths.length, '| doc-row:', rows.length,
              '| doc-sticky:', !!doc.querySelector('.doc-sticky'));
  if (ths.length) {
    console.log('表头:', [...ths].map(t => t.textContent.trim()).join(' / '));
    console.log('可排序列数:', [...ths].filter(t => t.dataset.sort).length);
  }
  if (rows.length) {
    console.log('首行:', rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 120));
    console.log('首行单元格:', rows[0].children.length);
  }
  const q = doc.getElementById('docQ');
  if (q) {
    q.value = '74hc00'; q.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(800);
    console.log('搜 74hc00 → 高亮:', doc.querySelectorAll('.doc-hl').length, '| 行:', doc.querySelectorAll('.doc-row').length);
  }
  console.log('undefined:', (doc.documentElement.outerHTML.match(/undefined/g) || []).length);
  console.log('JS 错误:', errs.length ? errs.slice(0, 2) : '无');
  process.exit(0);
})();
