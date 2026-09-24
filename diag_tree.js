const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('/Users/hu/fae-knowledge-web/index.html', 'utf-8');
const appJs = fs.readFileSync('/Users/hu/fae-knowledge-web/app.js', 'utf-8');
const uniJs = fs.readFileSync('/Users/hu/fae-knowledge-web/unified.js', 'utf-8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;
global.window = window; global.document = window.document; global.localStorage = window.localStorage;
global.navigator = window.navigator; global.requestAnimationFrame = (f) => setTimeout(f, 0);
const catalog = JSON.parse(fs.readFileSync('/Users/hu/fae-knowledge-web/data/catalog.json', 'utf-8'));
window.fetch = (url) => Promise.resolve({ ok: true, json: () => {
  if (/catalog/.test(url)) return Promise.resolve(catalog);
  if (/products_lite/.test(url)) return Promise.resolve({ products: [] });
  return Promise.resolve({});
}});
const ctx = dom.getInternalVMContext();
ctx.fetch = window.fetch; ctx.requestAnimationFrame = global.requestAnimationFrame;
ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout; ctx.setInterval = () => 0; ctx.clearInterval = () => {}; ctx.console = console;
const vm = require('vm');
(async () => {
  try { vm.runInContext(appJs, ctx, { filename: 'app.js' }); vm.runInContext(uniJs, ctx, { filename: 'unified.js' }); }
  catch (e) { console.log('加载报错:', e.message); process.exit(1); }
  await new Promise(r => setTimeout(r, 500));
  const catTree = window.document.getElementById('catTree');
  console.log('catTree 存在:', !!catTree, ' 内容长度:', catTree ? catTree.innerHTML.length : 'n/a');
  console.log('catalogMode 类名:', window.document.getElementById('catalogMode') ? window.document.getElementById('catalogMode').className : 'n/a');
  console.log('是否 hidden:', window.document.getElementById('catalogMode') ? window.document.getElementById('catalogMode').classList.contains('hidden') : 'n/a');
  // 看 window 上 CATALOG
  console.log('window.CATALOG:', typeof ctx.CATALOG, ctx.CATALOG ? Object.keys(ctx.CATALOG) : 'n/a');
  process.exit(0);
})();
