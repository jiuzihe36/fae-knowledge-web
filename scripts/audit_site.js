/* 端到端巡检：驱动 Safari 走遍四个栏目页 + 详情抽屉 + 搜索，抓 JS 错误与异常状态。
   用法：node scripts/audit_site.js
   依赖：Safari 已开「开发 > Allow JavaScript from Apple Events」。

   实现要点：osascript -e '...' 里嵌 JS 时，JS 的单双引号会与 shell/AppleScript
   的引号冲突（报「预期是字符串，却找到脚本的结尾」）。改为**把 JS 写进临时文件**，
   AppleScript 用 `read POSIX file ... as «class utf8»` 读进来执行，彻底绕开转义。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const URL_BASE = 'https://logic-qbu.pages.dev/?audit=' + Date.now();
const TMP_JS = path.join(os.tmpdir(), 'audit_probe.js');
const TMP_AS = path.join(os.tmpdir(), 'audit_probe.applescript');

function safari(js) {
  fs.writeFileSync(TMP_JS, js, 'utf8');
  fs.writeFileSync(TMP_AS,
    'set jsCode to (read POSIX file "' + TMP_JS + '" as «class utf8»)\n' +
    'tell application "Safari"\n' +
    '  do JavaScript jsCode in front document\n' +
    'end tell\n', 'utf8');
  try {
    return execSync('osascript "' + TMP_AS + '"', { encoding: 'utf8', timeout: 40000 }).trim();
  } catch (e) {
    return 'ERR: ' + ((e.stderr || e.message || '') + '').split('\n')[0].slice(0, 200);
  }
}

function setUrl(url) {
  fs.writeFileSync(TMP_AS,
    'tell application "Safari"\n  set URL of front document to "' + url + '"\nend tell\n', 'utf8');
  try { execSync('osascript "' + TMP_AS + '"', { encoding: 'utf8', timeout: 40000 }); } catch (e) { /* ignore */ }
}

const report = [];
function snap(label, js, wait) {
  if (wait) execSync('sleep ' + wait);
  const r = safari(js);
  report.push({ label, value: r });
  console.log('[' + label + '] ' + r);
}

setUrl(URL_BASE);
console.log('等待页面加载…');
execSync('sleep 12');

/* 轮询等待目录树渲染完成（部署后首屏可能较慢），最多等 60 秒 */
(function waitReady(){
  for (let i = 0; i < 20; i++) {
    const r = safari(`(function(){ var t=document.getElementById('catTree'); return t ? t.querySelectorAll('.cat-row').length : 0; })()`);
    if (parseInt(r, 10) > 0) { console.log('目录树就绪（' + r + ' 个大类行）'); return; }
    execSync('sleep 3');
  }
  console.log('⚠️ 目录树未就绪，继续巡检');
})();

safari(`(function(){
  window.__auditErrs = [];
  window.addEventListener('error', function(e){ window.__auditErrs.push('ERROR: ' + e.message + ' @' + (e.filename||'') + ':' + (e.lineno||'')); });
  window.addEventListener('unhandledrejection', function(e){ window.__auditErrs.push('REJECT: ' + (e.reason && e.reason.message || e.reason)); });
  var oe = console.error; console.error = function(){ window.__auditErrs.push('CONSOLE: ' + Array.prototype.join.call(arguments,' ')); oe.apply(console, arguments); };
  return 'collector ready';
})()`);

const LIGHT_SCAN = `
function lightBlocks(){
  /* 只在深色模式下扫亮块（浅色模式全页本就该是亮色，不构成问题） */
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (!isDark) return 'n/a(浅色模式)';
  var els = document.querySelectorAll('body *'), n = 0, names = [];
  for (var i=0;i<els.length;i++){
    var e = els[i]; if(!e.offsetWidth && !e.offsetHeight) continue;
    var bg = getComputedStyle(e).backgroundColor; var m = bg.match(/[0-9.]+/g);
    if (!m || m.length < 3) continue;
    var a = m.length>3?+m[3]:1; if (a < 0.35) continue;
    var L = 0.2126*(+m[0]) + 0.7152*(+m[1]) + 0.0722*(+m[2]);
    var cls = (typeof e.className === 'string' && e.className) ? e.className.split(' ')[0] : e.tagName;
    /* logo/q-bar/band 是品牌色与数据可视化，不算残留 */
    if (L > 60 && cls !== 'logo' && cls !== 'q-bar' && cls !== 'band') { n++; if (names.length < 6) names.push(cls); }
  }
  return n + (names.length ? '(' + names.join(',') + ')' : '');
}`;

snap('初始态', `(function(){${LIGHT_SCAN}
  var t = document.getElementById('catTree');
  return '大类行=' + t.querySelectorAll('.cat-row').length +
         ' 工艺组行=' + t.querySelectorAll('.grp-row').length +
         ' 系列行=' + t.querySelectorAll('.pro-row').length +
         ' 型号数=' + ((document.getElementById('statModels')||{}).textContent||'?') +
         ' 亮块=' + lightBlocks();
})()`);

const pages = ['apps', 'docs', 'quality', 'catalog'];
for (const p of pages) {
  safari(`document.querySelectorAll('.band-in a[data-page]').forEach(function(a){ if(a.dataset.page==='${p}') a.click(); }); 'ok'`);
  snap('页面 ' + p, `(function(){${LIGHT_SCAN}
    var pb = document.getElementById('pageBody');
    var vis = pb && !pb.classList.contains('hidden');
    var txt = pb ? pb.innerText.length : 0;
    return '可见=' + vis + ' 文本长度=' + txt + ' 亮块=' + lightBlocks();
  })()`, 7);
}

safari(`document.querySelectorAll('.band-in a[data-page]').forEach(function(a){ if(a.dataset.page==='catalog') a.click(); }); 'ok'`);
execSync('sleep 6');
safari(`(function(){ var b=document.getElementById('expandAll'); if(b) b.click(); return 'expanded'; })()`);
snap('全展开(到功能层)', `(function(){
  var t = document.getElementById('catTree');
  return '大类行=' + t.querySelectorAll('.cat-row').length +
         ' 系列行=' + t.querySelectorAll('.pro-row').length +
         ' 功能行=' + t.querySelectorAll('.func-row').length +
         ' 路数行=' + t.querySelectorAll('.ser-row').length +
         ' 型号行=' + t.querySelectorAll('.mod-row').length;
})()`, 9);

/* 路数层默认折叠（设计如此：避免一次涌出 652 行），先点开几个路数行再点型号 */
snap('点开路数行', `(function(){
  var sers = document.querySelectorAll('.ser-row');
  if (!sers.length) return 'no ser-row';
  sers[0].click();
  if (sers[1]) sers[1].click();
  return 'clicked ' + Math.min(2, sers.length);
})()`, 5);

snap('点第一个型号', `(function(){
  var m = document.querySelector('.mod-row');
  if (!m) return 'no mod-row (路数行未展开?)';
  m.click();
  return 'clicked ' + m.textContent.trim().slice(0, 30);
})()`, 6);

snap('详情抽屉', `(function(){
  var d = document.getElementById('detail');
  var open = d && !d.classList.contains('hidden');
  var model = (document.getElementById('detailModel')||{}).textContent || '';
  var specs = document.querySelectorAll('#specTable tbody tr').length;
  var pin = document.getElementById('pinImg');
  var cir = document.getElementById('circuitImg');
  return '打开=' + open + ' 型号=' + model + ' 参数行=' + specs +
         ' 引脚图=' + (pin && pin.src ? '有' : '无') +
         ' 电路图=' + (cir && cir.src ? '有' : '无');
})()`);

safari(`(function(){ var c=document.getElementById('closeDetail'); if(c) c.click(); return 'closed'; })()`);
execSync('sleep 3');
/* 先清空搜索框（上一轮可能留有值），再输入测试词 */
safari(`(function(){ var q=document.getElementById('q'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); return 'cleared-first'; })()`);
execSync('sleep 2');
safari(`(function(){ var q=document.getElementById('q'); q.value='74hc'; q.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()`);
snap('搜索 74hc', `(function(){
  var rs = document.getElementById('results');
  var cards = rs ? rs.querySelectorAll('.rcard').length : 0;
  var sm = (document.getElementById('resultSummary')||{}).textContent || '';
  return '结果卡=' + cards + ' 摘要=' + sm.slice(0,50);
})()`, 5);

safari(`(function(){ var b=document.getElementById('clearBtn'); if(b) b.click(); return 'cleared'; })()`);
snap('清空搜索', `(function(){
  var cm = document.getElementById('catalogMode');
  var sm = document.getElementById('searchMode');
  return '目录模式可见=' + (cm && !cm.classList.contains('hidden')) +
         ' 搜索模式可见=' + (sm && !sm.classList.contains('hidden'));
})()`, 4);

snap('JS 错误', `(function(){ return (window.__auditErrs && window.__auditErrs.length) ? window.__auditErrs.join(' ;; ') : '无'; })()`);

snap('undefined 全扫', `(function(){
  var t = document.documentElement.outerHTML;
  var n = 0, i = 0;
  while ((i = t.indexOf('undefined', i)) !== -1) { n++; i += 9; }
  return 'undefined 出现 ' + n + ' 次';
})()`);

console.log('\n===== 汇总 =====');
const errs = report.filter(r => /^ERR|undefined [1-9]|REJECT|ERROR:|亮块=[1-9]/.test(r.value) && !/亮块=n\/a/.test(r.value));
if (errs.length) { console.log('可疑项 ' + errs.length + ' 条:'); errs.forEach(e => console.log('  - ' + e.label + ': ' + e.value.slice(0, 160))); }
else console.log('无可疑项 ✅');
