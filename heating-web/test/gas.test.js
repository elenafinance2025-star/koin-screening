// Газ по сезонному лимиту: node heating-web/test/gas.test.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = {};
vm.createContext(ctx);
['engine.js', 'seed.js', 'koshtoris.js', 'reports.js', 'gas.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', f), 'utf8'), ctx);
});
var T = ctx.gasDefaultTariffs();
var failed = 0;
function check(n, c) { console.log((c ? 'OK   ' : 'FAIL ') + n); if (!c) failed++; }
function near(a, b, e) { return Math.abs(a - b) <= (e || 0.01); }

// ЛП: план 7,40647 / 18 / 23 / 18 / 43 → сверх лимита 27 тыс. м³ = 750 204,72 (как в плане Excel v4)
var lp = ctx.gasSeason(T['Лузановский Парк'], [7.40647, 18, 23, 18, 43]);
var lpOl = lp.reduce(function (s, x) { return s + x.ol; }, 0);
check('ЛП: сверхлимит сезона 750 204,72 (' + lpOl.toFixed(2) + ')', near(lpOl, 750204.72));
check('ЛП: лимит заканчивается в марте (март частично: льгота ' + lp[4].inLimit.toFixed(4) + ')', lp[3].over === 0 && near(lp[4].inLimit, 16));
// Лимнос при марте 64: 31 × 27 785,36 + потери 7 631,83 = 868 977,99
var lm = ctx.gasSeason(T['Лимнос'], [15.70933, 36, 43, 36, 64]);
check('Лимнос: мартовский сверхлимит 868 977,99 (' + lm[4].ol.toFixed(2) + ')', near(lm[4].ol, 31 * 27785.36 + 7631.83));
check('Лимнос: ноябрьский счёт = 15,70933 × 8 082,60 (' + lm[0].bill + ')', near(lm[0].bill, engineRound(15.70933 * 8082.6, 2)));
// Атлант: лимита нет — весь газ по коммерческой цене
var at = ctx.gasSeason(T['Атлант'], [1.5, 2.5, 3.5, 2.5, 2]);
check('Атлант: ноябрь 1,5 × 27 785,36 = 41 678,04 (' + at[0].bill + ')', near(at[0].bill, 41678.04));
function engineRound(x, d) { return ctx.engineRound(x, d); }

// Прогноз: в ноябре–январе сожгли больше — лимит кончается в январе, сверхлимит прогноза переходит на январь–март
var plan = ctx.seedPlanRows();
var fact = [['Ноябрь', 25], ['Декабрь', 55], ['Январь', 90]].map(function (x) {
  var p = plan.filter(function (r) { return r.zk === 'Лимнос' && r.month === x[0]; })[0];
  var c = JSON.parse(JSON.stringify(p));
  c.gas = x[1];
  return c;
});
// факт-счета введены по объёму и ценам
var factSeason = ctx.gasSeason(T['Лимнос'], [25, 55, 90, 0, 0]);
fact.forEach(function (r, i) { r.bill = factSeason[i].bill; r.ol = factSeason[i].ol; });
var res = ctx.repBuildAll({ plan: plan, fact: fact, settings: ctx.engineDefaultSettings(), gasTariffs: T, koshtPlan: {}, koshtFact: {} });
var w = res.workCalc.filter(function (r) { return r.zk === 'Лимнос'; });
w.forEach(function (r) { console.log('     ' + r.month + ' ' + r.source + ' · газ ' + r.gas + ' · накоплено ' + r.gasInfo.cum.toFixed(3) + ' · сверх ' + r.gasInfo.over.toFixed(3) + ' · сверхлимит ' + r.ol.toFixed(2)); });
check('прогноз: в январе (факт) уже сверх лимита', w[2].gasInfo.over > 0 && w[2].ol > 0);
check('прогноз: февраль и март (план) целиком сверх лимита', near(w[3].gasInfo.inLimit, 0) && near(w[4].gasInfo.inLimit, 0) && w[3].ol > 280000);
var olSeason = w[0].olSeason;
var expected = (25 + 55 + 90 + 36 + 54 - 163.70933) * 27785.36 + 7631.83;
check('сверхлимит сезона по прогнозу = (объём сезона − лимит) × цена + потери (' + olSeason.toFixed(2) + ')', near(olSeason, expected, 0.05));
check('счета факта сходятся с расчётом — предупреждений нет', w.slice(0, 3).every(function (r) { return !r.warn; }));
// ошибочный счёт факта — предупреждение
fact[0].bill += 5000;
var res2 = ctx.repBuildAll({ plan: plan, fact: fact, settings: ctx.engineDefaultSettings(), gasTariffs: T, koshtPlan: {}, koshtFact: {} });
var bad = res2.workCalc.filter(function (r) { return r.zk === 'Лимнос' && r.month === 'Ноябрь'; })[0];
check('счёт не сходится с объёмом — предупреждение в статусе', bad.status2.indexOf('счёт по объёму и ценам') >= 0);
// смена коммерческой цены пересчитывает прогноз
T['Лимнос'].priceOver = 30000;
var res3 = ctx.repBuildAll({ plan: plan, fact: [], settings: ctx.engineDefaultSettings(), gasTariffs: T, koshtPlan: {}, koshtFact: {} });
var mar = res3.planCalc.filter(function (r) { return r.zk === 'Лимнос' && r.month === 'Март'; })[0];
check('цена сверх лимита 30 000 → мартовский сверхлимит пересчитан (' + mar.ol.toFixed(2) + ')', near(mar.ol, (15.70933 + 36 + 43 + 36 + 54 - 163.70933) * 30000 + 7631.83, 0.05));
// Гавайи не затронуты
var hw = res3.planCalc.filter(function (r) { return r.zk === 'Гавайи'; });
var seedHw = plan.filter(function (r) { return r.zk === 'Гавайи'; });
check('Гавайи: счета из ввода, без пересчёта', hw.every(function (r, i) { return r.bill === seedHw[i].bill; }));
// Цена сверх лимита по месяцам (Атлант): ноябрь закрыт по 27 785,36, в декабре цена 30 000
var T2 = ctx.gasDefaultTariffs();
var planFixed = ctx.gasResolvePrices(T2); // план зафиксирован при старых ценах
T2['Атлант'].priceOverByMonth = [27785.36, 30000, '', '', ''];
var atSeason = ctx.gasSeason(T2['Атлант'], [1.5, 2.5, 3.5, 2.5, 2]);
check('Атлант: ноябрь по 27 785,36, декабрь по 30 000, январь–март — по последней (30 000)',
  atSeason[0].priceOver === 27785.36 && atSeason[1].priceOver === 30000 && atSeason[4].priceOver === 30000);
var atPlan = plan.filter(function (r) { return r.zk === 'Атлант'; });
var atFact = [JSON.parse(JSON.stringify(atPlan[0]))];
atFact[0].bill = 41678.04; atFact[0].ol = 41678.04; atFact[0].status = 'закрыт';
var nov = ctx.engineCompute(plan, ctx.engineDefaultSettings(), {}, {}).filter(function (r) { return r.zk === 'Атлант' && r.month === 'Ноябрь'; })[0];
var closedAt = { 'Атлант|Ноябрь': { price: nov.price, tNo: nov.tNo, tSpch: nov.tSpch } };
var journalAt = { 'Атлант': nov.tNo * nov.areaNo + nov.tSpch * nov.areaSpch };
var r4 = ctx.repBuildAll({ plan: plan, fact: atFact, settings: ctx.engineDefaultSettings(), gasTariffs: T2, gasPlanTariffs: planFixed,
  journal: journalAt, closed: closedAt, koshtPlan: {}, koshtFact: {} });
var wAt = r4.workCalc.filter(function (r) { return r.zk === 'Атлант'; });
check('ноябрь (закрыт) — тарифы не изменились после новой цены декабря', wAt[0].price === nov.price && wAt[0].tNo === nov.tNo);
check('ноябрь — проверка счёта по цене ноября, ложного предупреждения нет', !wAt[0].warn);
check('декабрь (прогноз) считается по 30 000: 2,5 × 30 000 = 75 000 (' + wAt[1].bill + ')', near(wAt[1].bill, 75000));
var pAt = r4.planCalc.filter(function (r) { return r.zk === 'Атлант'; });
check('план по ценам, зафиксированным с планом: декабрь 2,5 × 27 785,36 (' + pAt[1].bill + ')', near(pAt[1].bill, 2.5 * 27785.36));
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nГаз по лимиту считается верно');
process.exit(failed ? 1 : 0);
