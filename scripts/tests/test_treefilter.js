const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const liteArr = JSON.parse(fs.readFileSync('/Users/hu/fae-knowledge-web/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync('/Users/hu/fae-knowledge-web/index.html', 'utf-8');
const uniJs = fs.readFileSync('/Users/hu/fae-knowledge-web/unified.js', 'utf-8');
html = html.replace('<script src="./app.js?v=20260925n"></script>', '')
           .replace('<script src="./unified.js?v=20260925n"></script>', '<script>' + uniJs + '</script>');
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdomError]', e.message));
vc.on('log', (...a) => console.log('[page log]', ...a));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost:8899/',
  beforeParse(window) {
    window.__xx = { products: liteArr };
    window.fetch = (u, ...rest) => {
      var url = String(u);
      if (url.charAt(0) === '.') url = 'http://localhost:8899/' + url.replace(/^\.\//, '');
      else if (url.charAt(0) === '/') url = 'http://localhost:8899' + url;
      return fetch(url, ...rest);
    };
    window.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
    window.addEventListener('error', ev => console.log('[win error]', ev.error && ev.error.message));
  }
});
const { window } = dom, doc = window.document;
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function visibleRows(root) {
  return Array.prototype.filter.call(root.querySelectorAll('.mod-row,.rcard'), function (n) {
    return n.style.display !== 'none';
  });
}
function visibleHits(root) {
  return Array.prototype.filter.call(root.querySelectorAll('.mod-row.hit,.rcard.hit'), function (n) {
    return n.style.display !== 'none';
  });
}
(async () => {
  await sleep(2500);
  const catTree = doc.getElementById('catTree');
  console.log('catTree 内容长:', catTree.innerHTML.length);
  if (catTree.innerHTML.length === 0) { console.log('目录未渲染，终止'); process.exit(2); }

  doc.getElementById('collapseAll').click(); await sleep(150);
  console.log('    全部折叠后 可见型号行 =', visibleRows(catTree).length);

  const f = doc.getElementById('treeFilter');
  f.value = 'EM74'; f.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(400);
  const af = catTree.querySelectorAll('.mod-row,.rcard').length;
  const vis = visibleRows(catTree).length;
  const hits = visibleHits(catTree).length;
  const info = doc.getElementById('treeFilterInfo');
  console.log('    筛选 EM74: DOM总行=', af, ' 可见行=', vis, ' 可见命中=', hits, ' info=', JSON.stringify(info.textContent));
  check('修复后: 全折叠态下筛选使型号行渲染进DOM (>0)', af > 0);
  check('修复后: 可见命中行 > 0', hits > 0);
  check('修复后: info 显示命中数', info && /\d/.test(info.textContent));

  f.value = ''; f.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(200);
  check('清空筛选后 可见行恢复 (>0)', visibleRows(catTree).length > 0);

  f.value = 'EXS'; f.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(400);
  const h2 = visibleHits(catTree).length;
  const i2 = doc.getElementById('treeFilterInfo');
  console.log('    筛选 EXS: 可见命中=', h2, ' info=', JSON.stringify(i2.textContent));
  check('另一关键词 EXS 也能命中', h2 > 0);

  console.log(`\n=== ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})();
