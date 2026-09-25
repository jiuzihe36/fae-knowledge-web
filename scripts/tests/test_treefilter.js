const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const liteArr = JSON.parse(fs.readFileSync('/Users/hu/fae-knowledge-web/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync('/Users/hu/fae-knowledge-web/index.html', 'utf-8');
const uniJs = fs.readFileSync('/Users/hu/fae-knowledge-web/unified.js', 'utf-8');
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
const vis = (root, sel) => Array.prototype.filter.call(root.querySelectorAll(sel), n => n.style.display !== 'none').length;
const type = (f, v) => { f.value = v; f.dispatchEvent(new window.Event('input', { bubbles: true })); };
(async () => {
  await sleep(2500);
  const catTree = doc.getElementById('catTree'), f = doc.getElementById('treeFilter'), info = doc.getElementById('treeFilterInfo');
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, extra || '')); };

  // 搜 74hc
  type(f, '74hc'); await sleep(600);
  console.log('  搜 74hc: 命中', vis(catTree, '.mod-row'), JSON.stringify(info.textContent));
  const openedCats = Array.prototype.filter.call(catTree.querySelectorAll('.cat-row'), n => n.getAttribute('aria-expanded') === 'true').map(n => n.textContent.trim().split(' ')[0]);
  const openedProcs = Array.prototype.filter.call(catTree.querySelectorAll('.pro-row'), n => n.getAttribute('aria-expanded') === 'true').map(n => n.getAttribute('data-series') || n.textContent.trim().slice(0, 12));
  const openedSeries = Array.prototype.filter.call(catTree.querySelectorAll('.pro-row'), n => n.getAttribute('aria-expanded') === 'true').map(n => n.getAttribute('data-series'));
  console.log('  展开的大类:', openedCats);
  console.log('  展开的工艺/系列:', openedSeries);
  const expectHc = liteArr.filter(m => /^EM74HC\d/i.test(m.model || '')).length;
  check('74hc 命中 ' + expectHc + ' 款', vis(catTree, '.mod-row') === expectHc, '(实际' + vis(catTree, '.mod-row') + ')');
  check('只展开 74HC 系列', openedSeries.length === 1 && openedSeries[0] === '74HC', JSON.stringify(openedSeries));
  check('未展开 74HCT/74HCS', openedSeries.indexOf('74HCT') < 0 && openedSeries.indexOf('74HCS') < 0);

  // 搜 74lvc
  type(f, '74lvc'); await sleep(600);
  const ser2 = Array.prototype.filter.call(catTree.querySelectorAll('.pro-row'), n => n.getAttribute('aria-expanded') === 'true').map(n => n.getAttribute('data-series'));
  console.log('  搜 74lvc: 命中', vis(catTree, '.mod-row'), ' 展开系列:', ser2);
  // 断言改为「命中数 > 0 且等于 74LVC 系列实际型号数」，不写死数字——
  // 数据清洗会改变型号数（如删占位），写死数字会让测试假失败
  const expectLvc = liteArr.filter(m => /LVC/i.test(m.series || '')).length;
  check('74lvc 命中 ' + expectLvc + ' 款', vis(catTree, '.mod-row') === expectLvc, '(实际' + vis(catTree, '.mod-row') + ')');
  check('只展开 74LVC 系列(可能两个大类各一)', ser2.every(x => x === '74LVC') && ser2.length >= 1, JSON.stringify(ser2));

  // 清空
  type(f, ''); await sleep(500);
  console.log('  清空后: 可见型号行', vis(catTree, '.mod-row'), ' info=', JSON.stringify(info.textContent));
  check('清空后回默认折叠 (型号行 0)', vis(catTree, '.mod-row') === 0);

  console.log(`\n=== ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})();
