#!/usr/bin/env node
/**
 * 目录树折叠自检（芯祥 ~/fae-knowledge-web/data/catalog.json）
 *
 * 为什么需要：目录树有 6 层、每层都可折叠，渲染分支多。
 * 靠肉眼点开看会漏掉两类错：① 某层没被渲染（漏层）② 计数与实际条数不符（数据层错）。
 * 这个脚本同时抓这两类：
 *   - 全展开时「叶子行数 == catalog.total」    -> 抓漏层 / 计数不符
 *   - 每层 count 与其子层实际条数逐级对账      -> 抓分类规则漏型号
 *   - 条件分层（proc_level）下工艺组合计对账    -> 抓工艺映射表漏系列
 *
 * 层级形态（用户裁定的最终形态，勿按旧版 5 层写）：
 *   cats[] → procs[] → series[] → funcs[] → routes[] → models[]
 *   大类 → 工艺组 → 系列 → 功能 → 路数 → 型号
 *
 *   procs[].name 可为 null  —— 表示该大类系列太少、不做工艺子类，
 *                             此时 procs 里只有一个 name=null 的块，系列直列其下。
 *
 * 用法：node verify_catalog_tree.js [catalog.json 路径]
 * 退出码非 0 = 有 FAIL，可直接进 CI 或部署前 gate。
 */
const fs = require('fs');

const P = process.argv[2] || '/Users/hu/fae-knowledge-web/data/catalog.json';
const cat = JSON.parse(fs.readFileSync(P, 'utf8'));

let fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fails.push(name);
};

/* procs 可能带 name=null 的直列块，统一取成「系列数组」 */
const seriesOf = (c) => (c.procs || []).reduce((a, p) => a.concat(p.series || []), []);

/* ---------- 汇总 ---------- */
let nCat = 0, nProc = 0, nSer = 0, nFunc = 0, nRoute = 0, nMod = 0;
const uniqSer = new Set();
cat.cats.forEach(c => {
  nCat++;
  (c.procs || []).forEach(p => {
    if (p.name) nProc++;
    (p.series || []).forEach(s => {
      nSer++; uniqSer.add(s.name);
      (s.funcs || []).forEach(f => {
        nFunc++;
        (f.routes || []).forEach(r => { nRoute++; nMod += r.models.length; });
      });
    });
  });
});
console.log('结构：大类', nCat, '| 工艺组', nProc, '| 系列', nSer, '(唯一', uniqSer.size + ')',
            '| 功能', nFunc, '| 路数', nRoute, '| 型号', nMod);
console.log('catalog.total =', cat.total);
console.log('-'.repeat(58));

/* ---------- 1. 叶子总数 == 声明总量 ---------- */
ok('叶子型号数 == catalog.total', nMod === cat.total, nMod + ' vs ' + cat.total);

/* ---------- 2. 逐层计数对账 ---------- */
const badRoute = [], badFunc = [], badSer = [], badProc = [], badCat = [];
cat.cats.forEach(c => {
  let catSum = 0;
  (c.procs || []).forEach(p => {
    let procSum = 0;
    (p.series || []).forEach(s => {
      let serSum = 0;
      (s.funcs || []).forEach(f => {
        const rs = (f.routes || []).reduce((a, x) => a + x.models.length, 0);
        if (rs !== f.count) badFunc.push(c.name + '/' + s.name + '>' + f.name + ': ' + rs + '!=' + f.count);
        (f.routes || []).forEach(x => {
          if (x.count !== x.models.length) {
            badRoute.push(c.name + '/' + s.name + '>' + f.name + '/' + x.name + ': ' + x.models.length + '!=' + x.count);
          }
        });
        serSum += rs;
      });
      if (serSum !== s.count) badSer.push(c.name + '/' + s.name + ': ' + serSum + '!=' + s.count);
      procSum += serSum;
    });
    if (procSum !== p.count) badProc.push(c.name + '/' + (p.name || '(直列)') + ': ' + procSum + '!=' + p.count);
    catSum += procSum;
  });
  if (catSum !== c.count) badCat.push(c.name + ': ' + catSum + '!=' + c.count);
});
ok('路数层 count 对账', badRoute.length === 0, badRoute.slice(0, 3).join('; '));
ok('功能层 count 对账', badFunc.length === 0, badFunc.slice(0, 3).join('; '));
ok('系列层 count 对账', badSer.length === 0, badSer.slice(0, 3).join('; '));
ok('工艺组层 count 对账', badProc.length === 0, badProc.slice(0, 3).join('; '));
ok('大类层 count 对账', badCat.length === 0, badCat.slice(0, 3).join('; '));

/* ---------- 3. 条件分层一致性 ---------- */
/* 判据是「该大类下的系列数 >= 3」——系列太少时工艺子类是冗余层级。
   实现须与 gen_catalog.py 里的 use_proc 判据一致，改一处必须改两处。 */
cat.cats.forEach(c => {
  const n = seriesOf(c).length;
  const expect = n >= 3;
  ok('条件分层 ' + c.name, !!c.proc_level === expect,
     'proc_level=' + c.proc_level + ' (系列数 ' + n + ', 期望 ' + expect + ')');
  if (!c.proc_level) {
    /* 不分工艺组时，procs 里应只有一个 name=null 的直列块（不得按工艺名拆开） */
    const named = (c.procs || []).filter(p => p.name);
    ok('未分层时无工艺名 ' + c.name, named.length === 0, named.map(p => p.name).join(','));
  }
});

/* ---------- 4. 折叠不变式：模拟逐层展开，全展开时叶子数仍等于总量 ---------- */
function countLayers(oc, op, os, of, orr) {
  let cats = 0, procs = 0, sers = 0, funcs = 0, routes = 0, mods = 0;
  cat.cats.forEach(c => {
    cats++;
    if (!oc[c.key]) return;
    (c.procs || []).forEach(p => {
      const direct = !p.name;           /* 直列块：没有工艺组这一级 */
      if (!direct) {
        procs++;
        if (!op[c.key + '|' + p.name]) return;
      }
      (p.series || []).forEach(s => {
        sers++;
        if (!os[c.key + '|' + s.name]) return;
        (s.funcs || []).forEach(f => {
          funcs++;
          if (!of[c.key + '|' + s.name + '>' + f.name]) return;
          (f.routes || []).forEach(r => {
            routes++;
            if (!orr[c.key + '|' + s.name + '>' + f.name + '|' + r.name]) return;
            mods += r.models.length;
          });
        });
      });
    });
  });
  return { cats, procs, sers, funcs, routes, mods };
}
let r = countLayers({}, {}, {}, {}, {});
ok('全折叠时只有大类行', r.cats === nCat && r.procs === 0 && r.sers === 0 && r.funcs === 0 && r.mods === 0,
   JSON.stringify(r));

const OC = {}, OP = {}, OS = {}, OF = {}, OR = {};
cat.cats.forEach(c => {
  OC[c.key] = true;
  (c.procs || []).forEach(p => {
    if (p.name) OP[c.key + '|' + p.name] = true;
    (p.series || []).forEach(s => {
      OS[c.key + '|' + s.name] = true;
      (s.funcs || []).forEach(f => {
        OF[c.key + '|' + s.name + '>' + f.name] = true;
        (f.routes || []).forEach(x => { OR[c.key + '|' + s.name + '>' + f.name + '|' + x.name] = true; });
      });
    });
  });
});
r = countLayers(OC, OP, OS, OF, OR);
ok('全展开叶子数 == total', r.mods === cat.total, r.mods + ' vs ' + cat.total);

/* ---------- 5. 每个型号必须有详情所需字段 ---------- */
const emptyModels = [];
cat.cats.forEach(c => (c.procs || []).forEach(p => (p.series || []).forEach(s => (s.funcs || []).forEach(f =>
  (f.routes || []).forEach(x => x.models.forEach(m => {
    if (!m.m) emptyModels.push(c.name + '/' + s.name + '/' + f.name + '/' + x.name);
    if (!m.route) emptyModels.push('缺 route: ' + m.m);
  }))))));
ok('所有型号项都有 m 与 route', emptyModels.length === 0, emptyModels.slice(0, 3).join('; '));

/* ---------- 6. 路数覆盖率（「其他」兜底占比过高 = 解析规则退化） ---------- */
let otherN = 0;
cat.cats.forEach(c => (c.procs || []).forEach(p => (p.series || []).forEach(s => (s.funcs || []).forEach(f =>
  (f.routes || []).forEach(x => { if (x.name === '其他') otherN += x.models.length; })))));
const cover = (1 - otherN / nMod) * 100;
ok('路数解析覆盖率 >= 85%', cover >= 85, cover.toFixed(1) + '% (其他 ' + otherN + ')');

console.log('-'.repeat(58));
if (fails.length) { console.log('FAILED: ' + fails.length + ' / ' + fails.join('; ')); process.exit(1); }
console.log('ALL PASS');
