// Отчёты: план из Excel v4, факт — два введённых месяца Лимноса: node heating-web/test/reports.test.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = {};
vm.createContext(ctx);
['engine.js', 'koshtoris.js', 'reports.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', f), 'utf8'), ctx);
});
var fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_v4.json'), 'utf8'));
var sm = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_smeta.json'), 'utf8'));
var maps = ctx.koshtDefaultMapping(), kosht = {};
Object.keys(maps).forEach(function (zk) { kosht[zk] = ctx.koshtCompute(sm[zk].rows, maps[zk], Number(sm[zk].area), {}); });
var fact = fx.rows.slice(0, 2).map(function (r) { var c = JSON.parse(JSON.stringify(r)); c.bill = r.bill * 1.05; c.gas = r.gas * 1.05; return c; });
var res = ctx.repBuildAll({ plan: fx.rows, fact: fact, settings: ctx.engineDefaultSettings(), koshtPlan: kosht, koshtFact: kosht });
var failed = 0;
function check(n, c) { console.log((c ? 'OK   ' : 'FAIL ') + n); if (!c) failed++; }
res.tables.forEach(function (t) {
  var w = t.headers.length;
  check(t.title + ': ' + t.rows.length + ' строк, ширина ' + w, t.rows.every(function (r) { return r.length === w; }));
});
var tar = res.tables[0];
check('источник: Лимнос ноябрь = факт, март = план', tar.rows[0][3] === 'факт' && tar.rows[4][3] === 'план');
var ol = res.tables[2];
var lim = ol.rows.filter(function (r) { return r[1] === 'Лимнос'; });
check('сверхлимит Лимноса: начислено нараст. в марте = сверхлимиту сезона (' + lim[4][14].toFixed(2) + ')',
  Math.abs(lim[4][14] - 650000) < 0.01 && Math.abs(lim[4][15]) < 0.01);
var acc = res.tables[1].rows[0];
check('котельная Лимнос ноябрь план = 11,47 × 0,5 × 25 162,6 (' + acc[2].toFixed(2) + ')', Math.abs(acc[2] - 11.47 * 0.5 * 25162.6) < 0.01);
var sub = ctx.repWithSubtotals(res.tables[1]);
var limTot = sub.rows[sub.totalIdx[0]];
var limRows = res.tables[1].rows.filter(function (r) { return r[1] === 'Лимнос'; });
var billSum = limRows.reduce(function (s, r) { return s + r[11]; }, 0);
check('итоги: строка «Итого» под Лимносом, счёт план = сумма месяцев (' + limTot[11].toFixed(2) + ')', limTot[0] === 'Итого' && limTot[1] === 'Лимнос' && Math.abs(limTot[11] - billSum) < 0.01);
check('итоги: «ЗАПАС план нараст.» = значение марта', limTot[18] === limRows[4][18]);
check('итоги: 4 итога по ЖК + общий итог', sub.totalIdx.length === 5 && sub.rows[sub.rows.length - 1][0] === 'Итого по всем ЖК');
var ols = ctx.repWithSubtotals(res.tables[2]);
check('итоги сверхлимита: «Осталось разнести» по Лимносу = 0 (март)', Math.abs(ols.rows[ols.totalIdx[0]][15]) < 0.01);
check('кошторис-таблица', ctx.repKoshtTable('Лимнос', kosht['Лимнос']).rows.length === 13);
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nОтчёты собраны');
process.exit(failed ? 1 : 0);
