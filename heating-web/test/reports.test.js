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
var limOlBill = lim.reduce(function (s, r) { return s + r[5]; }, 0), limOlCh = lim.reduce(function (s, r) { return s + r[6]; }, 0);
check('сверхлимит Лимноса: начислено за сезон = сверхлимиту сезона (' + limOlCh.toFixed(2) + '), в марте разница нараст. и «осталось» = 0',
  Math.abs(limOlCh - 650000) < 0.01 && Math.abs(lim[4][7] - (limOlCh - limOlBill)) < 0.01 && Math.abs(lim[4][7]) < 0.01 && Math.abs(lim[4][8]) < 0.01);
check('сверхлимит: 9 колонок, плановых нет', ol.headers.length === 9 && ol.headers.join('|').indexOf('План') < 0);
var acc = res.tables[1].rows[0];
check('котельная Лимнос ноябрь план = тариф × 0,5 × 25 162,6 (' + acc[2].toFixed(2) + ')', Math.abs(acc[2] - kosht['Лимнос'].tariff * 0.5 * 25162.6) < 0.01);
var sub = ctx.repWithSubtotals(res.tables[1]);
var limTot = sub.rows[sub.totalIdx[0]];
var limRows = res.tables[1].rows.filter(function (r) { return r[1] === 'Лимнос'; });
var billSum = limRows.reduce(function (s, r) { return s + r[8]; }, 0);
check('итоги: строка «Итого» под Лимносом, счёт план = сумма месяцев (' + limTot[8].toFixed(2) + ')', limTot[0] === 'Итого' && limTot[1] === 'Лимнос' && Math.abs(limTot[8] - billSum) < 0.01);
var limFactCum = limRows.map(function (r) { return r[15]; }).filter(function (v) { return typeof v === 'number'; });
check('итоги: «ЗАПАС факт нараст.» = значение последнего месяца с фактом', limFactCum.length > 0 && limTot[15] === limFactCum[limFactCum.length - 1]);
check('начисление: колонок «ЗАПАС план» нет', res.tables[1].headers.join('|').indexOf('ЗАПАС план') < 0 && res.tables[1].headers.length === res.tables[1].formats.length);
check('итоги: 4 итога по ЖК + общий итог', sub.totalIdx.length === 5 && sub.rows[sub.rows.length - 1][0] === 'Итого по всем ЖК');
var ols = ctx.repWithSubtotals(res.tables[2]);
check('итоги сверхлимита: «Осталось разнести» по Лимносу = 0 (март)', Math.abs(ols.rows[ols.totalIdx[0]][8]) < 0.01);
var pf = ctx.repPlanFactTotals(res.tables[3]);
var pfTot = pf.rows.filter(function (r) { return r[0] === 'Итого' && r[1] === 'Лимнос' && r[2] === 'Начислено газ, грн'; })[0];
var pfRows = res.tables[3].rows.filter(function (r) { return r[1] === 'Лимнос' && r[2] === 'Начислено газ, грн'; });
check('план-факт итого: план = сумма 5 месяцев, факт и отклонение — по месяцам с фактом',
  pfTot && Math.abs(pfTot[4] - pfRows.reduce(function (s, r) { return s + r[4]; }, 0)) < 0.01 &&
  Math.abs(pfTot[6] - pfRows.filter(function (r) { return r[3] === 'факт'; }).reduce(function (s, r) { return s + r[6]; }, 0)) < 0.01);
check('план-факт итого: тарифы не суммируются', !pf.rows.some(function (r) { return r[0] === 'Итого' && /грн\/м²|грн\/Гкал/.test(r[2]); }));
var pfFirstAtlant = pf.rows.findIndex(function (r) { return r[1] === 'Атлант'; });
check('план-факт итого: итоги Лимноса стоят под Лимносом, до строк Атланта',
  pf.rows.slice(0, pfFirstAtlant).filter(function (r) { return r[0] === 'Итого'; }).length > 0 &&
  pf.rows.slice(pfFirstAtlant).every(function (r) { return r[1] !== 'Лимнос'; }) &&
  pf.rows[pfFirstAtlant - 1][0] === 'Итого');
check('начисление: колонок норматива нет', res.tables[1].headers.join('|').indexOf('Норматив') < 0);
var rt = res.tables[5];
var rLim = rt.rows.filter(function (r) { return r[0] === 'Лимнос'; });
var rget = function (rows, item) { return rows.filter(function (r) { return r[1] === item; })[0]; };
check('результат: 8 строк на ЖК + блок «Все ЖК»', rt.id === 'result' && rt.rows.length === 8 * 5 && rt.rows[rt.rows.length - 1][0] === 'Все ЖК');
var bAcc = rget(rLim, 'Начислено жильцам: котельная (с НДС)'), bCost = rget(rLim, 'Расход: котельная (с НДС)');
check('результат: котельная по плану с НДС ≈ кошторис (' + bAcc[2].toFixed(2) + ' / ' + bCost[2].toFixed(2) + ')',
  Math.abs(bAcc[2] - kosht['Лимнос'].season.gross) < 0.005 * 4.5 * kosht['Лимнос'].area && bCost[6].indexOf('кошторис') >= 0);
var gRes = rget(rLim, 'Результат: газ');
check('результат: газ по плану ≈ 0 (' + gRes[2].toFixed(2) + ')', Math.abs(gRes[2]) < 100);
check('результат: факт на сегодня — только 2 месяца с фактом', Math.abs(rget(rLim, 'Расход: газ — счета поставщика (с НДС)')[3] - (fact[0].bill + fact[1].bill)) < 0.01);
var res2 = ctx.repBuildAll({ plan: fx.rows, fact: fact, settings: ctx.engineDefaultSettings(), koshtPlan: kosht, koshtFact: kosht,
  boilerCosts: { 'Лимнос': { planAdmin: 100000, planOper: 120000, factAdmin: 90000, factOper: '' } } });
var c2 = rget(res2.tables[5].rows.filter(function (r) { return r[0] === 'Лимнос'; }), 'Расход: котельная (с НДС)');
check('результат: прежний формат — план 100 000 × 1,2 + 120 000 = 240 000; факт 90 000 × 1,2', Math.abs(c2[2] - 240000) < 0.01 && Math.abs(c2[4] - 108000) < 0.01 && c2[6] === 'факт за сезон');
check('результат: итого = газ + котельная', (function (rows) {
  var t = rget(rows, 'Результат итого'); return Math.abs(t[4] - rget(rows, 'Результат: газ')[4] - rget(rows, 'Результат: котельная')[4]) < 0.01;
})(res2.tables[5].rows.filter(function (r) { return r[0] === 'Лимнос'; })));
var res3 = ctx.repBuildAll({ plan: fx.rows, fact: fact, settings: ctx.engineDefaultSettings(), koshtPlan: kosht, koshtFact: kosht,
  boilerCosts: { 'Лимнос': { planCost: 1394602.8, factCost: 918950 } } });
var r3 = res3.tables[5].rows.filter(function (r) { return r[0] === 'Лимнос'; });
var c3 = rget(r3, 'Расход: котельная (с НДС)');
check('результат: одно поле с НДС — план 1 394 602,80, факт 918 950 как есть', Math.abs(c3[2] - 1394602.8) < 0.01 && Math.abs(c3[4] - 918950) < 0.01 && c3[6] === 'факт за сезон');
check('результат: «итого без НДС» = итого ÷ 1,2', !rget(r3, 'Результат: котельная без НДС') && Math.abs(rget(r3, 'Результат итого без НДС')[4] - rget(r3, 'Результат итого')[4] / 1.2) < 0.01);
var marks = ctx.repResultMarks(rt);
check('результат: строки «Результат…» выделены', marks.totalIdx.length === 4 * 5);
check('кошторис-таблица', ctx.repKoshtTable('Лимнос', kosht['Лимнос']).rows.length === 13);
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nОтчёты собраны');
process.exit(failed ? 1 : 0);
