const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = '/Users/hu/fae-knowledge-web';
const liteArr = JSON.parse(fs.readFileSync(ROOT + '/data/products_lite.json', 'utf-8'));
let html = fs.readFileSync(ROOT + '/index.html', 'utf-8');
const uniJs = fs.readFileSync(ROOT + '/unified.js', 'utf-8');
html = html.replace(/<script src="\.\/app\.js\?v=[^"]*"><\/script>/, '')
           .replace(/<script src="\.\/unified\.js\?v=[^"]*"><\/script>/, '<script>' + uniJs + '</script>');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'http://localhost:8899/',
  beforeParse(window) {
    window.__xx = { products: liteArr };
    window.fetch = (u, ...rest) => { let url = String(u); if (url[0] === '.') url = 'http://localhost:8899/' + url.replace(/^\.\//, ''); return fetch(url, ...rest); };
    window.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
    window.scrollTo = () => {};
  }
});
const { window } = dom, doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(2500);
  doc.querySelector('.band-in a[data-page="docs"]').click();
  await sleep(2000);
  const pb = doc.getElementById('pageBody');
  const head = doc.querySelector('.doc-head');
  const sticky = doc.querySelector('.doc-sticky');
  const list = doc.getElementById('docList');
  console.log('pageBody 存在:', !!pb);
  console.log('doc-head 存在:', !!head);
  console.log('doc-head 是 pageBody 后代:', pb && head ? pb.contains(head) : 'n/a');
  console.log('doc-sticky 是 pageBody 后代:', pb && sticky ? pb.contains(sticky) : 'n/a');
  console.log('docList 是 pageBody 后代:', pb && list ? pb.contains(list) : 'n/a');
  console.log('doc-head.parent 链:', (() => { let p = head, out = []; while (p && out.length < 5) { out.push(p.id || p.className || p.tagName); p = p.parentElement; } return out.join(' < '); })());
  console.log('docList.parent 链:', (() => { let p = list, out = []; while (p && out.length < 5) { out.push(p.id || p.className || p.tagName); p = p.parentElement; } return out.join(' < '); })());
  // 直接手动派发 click 到 .doc-th
  const th = head.querySelector('.doc-th[data-sort="m"]');
  const before = doc.querySelector('.doc-row').textContent.slice(0, 30);
  th.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  const after = doc.querySelector('.doc-row').textContent.slice(0, 30);
  console.log('手动 dispatch 排序:', before, '→', after, before !== after ? '✅ 生效' : '❌ 未生效');
  process.exit(0);
})();
