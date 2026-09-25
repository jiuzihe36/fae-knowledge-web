const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const liteArr = JSON.parse(fs.readFileSync('/Users/hu/fae-knowledge-web/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync('/Users/hu/fae-knowledge-web/index.html', 'utf-8');
const uniJs = fs.readFileSync('/Users/hu/fae-knowledge-web/unified.js', 'utf-8');
html = html.replace('<script src="./app.js?v=20260925n"></script>', '')
           .replace('<script src="./unified.js?v=20260925n"></script>', '<script>' + uniJs + '</script>');
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
const vis = (root, sel) => Array.prototype.filter.call(root.querySelectorAll(sel), n => n.style.display !== 'none').length;
const type = (f, v) => { f.value = v; f.dispatchEvent(new window.Event('input', { bubbles: true })); };
(async () => {
  await sleep(2500);
  const catTree = doc.getElementById('catTree'), f = doc.getElementById('treeFilter'), info = doc.getElementById('treeFilterInfo');
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, extra || '')); };
  const initialRows = catTree.querySelectorAll('.mod-row').length;
  console.log('初始 DOM 型号行:', initialRows, '(默认只展开最大类)');

  type(f, '74hc'); await sleep(600);
  const h1 = vis(catTree, '.mod-row.hit');
  console.log('  搜 74hc: 命中', h1, JSON.stringify(info.textContent));
  check('74hc 精确命中 104 款', h1 === 104, '(实际' + h1 + ')');

  type(f, '74lvc'); await sleep(600);
  console.log('  搜 74lvc: 命中', vis(catTree, '.mod-row.hit'), JSON.stringify(info.textContent));
  check('74lvc 命中 202 款', vis(catTree, '.mod-row.hit') === 202);

  type(f, 'EM74HCT125D'); await sleep(500);
  console.log('  搜 EM74HCT125D: 命中', vis(catTree, '.mod-row.hit'), JSON.stringify(info.textContent));
  check('具体型号命中 >=1', vis(catTree, '.mod-row.hit') >= 1);

  type(f, ''); await sleep(500);
  const afterClear = catTree.querySelectorAll('.mod-row').length;
  console.log('  清空后 DOM 型号行:', afterClear, ' (初始', initialRows, ')');
  check('清空后回到默认折叠 (行数≈初始, 非670)', afterClear <= initialRows + 5, '(实际' + afterClear + ')');
  check('清空后 info 清空', info.textContent === '');

  type(f, '74hc'); await sleep(600);
  console.log('  再搜 74hc: 命中', vis(catTree, '.mod-row.hit'));
  check('清空后再搜 74hc 仍 104 款', vis(catTree, '.mod-row.hit') === 104);

  console.log(`\n=== ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})();
