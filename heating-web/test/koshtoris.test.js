// Кошторисы по сметам 2026/27: node heating-web/test/koshtoris.test.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = {};
vm.createContext(ctx);
['engine.js', 'koshtoris.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', f), 'utf8'), ctx);
});
var sm = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_smeta.json'), 'utf8'));
var maps = ctx.koshtDefaultMapping();
var failed = 0;
Object.keys(maps).forEach(function (zk) {
  var k = ctx.koshtCompute(sm[zk].rows, maps[zk], Number(sm[zk].area), {});
  console.log('\n' + zk + ' · площадь ' + k.area + ' · тариф ' + k.tariff + ' грн/м² (ПДВ ' + k.tariffVat + ')');
  k.articles.forEach(function (a) {
    console.log('  ' + (a.num || ' ') + ' ' + a.title.substring(0, 60).padEnd(60) + a.perM2.toFixed(2).padStart(7) +
      a.season.toFixed(2).padStart(14));
  });
  console.log('  без ПДВ ' + k.season.net.toFixed(2) + ' · ПДВ ' + k.season.vat.toFixed(2) + ' · з ПДВ ' + k.season.gross.toFixed(2));
  var chk = Math.abs(k.season.gross - k.season.net * 1.2) < 0.01 && k.tariff > 0;
  if (!chk) { failed++; console.log('FAIL'); }
});
// Лимнос 26/27 по смете от 12.11.2026 (помесячные «факт», ноя…мар) — как расчёт Елены: 1 394 602,80 с НДС
var five = function (x) { return [x, x, x, x, x]; };
var sm2 = {
  '8': five(17930), '10': five(33810), '12': five(23283),
  '14': [33908.39, 43889.46, 47500.84, 43889.46, 42341.73],       // адмін-накладні 6 %
  '17': five(30672), '20': five(131.08),
  '23': [3235.44, 4799.14, 5364.92, 4799.14, 4556.66],            // налог на прибыль 1 %
  '27': five(83901.25),
  '29': five(500), '30': five(7544.80), '31': five(7800), '32': five(773.44), '34': five(600), '35': five(741.94)
};
var k2 = ctx.koshtCompute(sm2, maps['Лимнос'], 25162.6, {});
var ok2 = Math.abs(k2.season.gross - 1394602.80) < 0.05 && k2.tariff === 12.32;
console.log((ok2 ? 'OK   ' : 'FAIL ') + 'Лимнос 26/27: с НДС ' + k2.season.gross.toFixed(2) + ' (ожидается 1 394 602,80), тариф ' + k2.tariff);
if (!ok2) failed++;
var map5 = JSON.parse(JSON.stringify(maps['Лимнос'])); map5.months = 5;
var k5 = ctx.koshtCompute(sm2, map5, 25162.6, {});
var ok5 = k5.tariff === 11.08 && ctx.koshtMonthShare(0, 5) === 1 && ctx.koshtMonthShare(0, 4.5) === 0.5 && ctx.koshtMonthShare(2, 5) === 1 &&
  Math.abs(k5.tariff * 25162.6 * 5 - 1394602.80) < 0.005 * 25162.6 * 5;
console.log((ok5 ? 'OK   ' : 'FAIL ') + 'Лимнос, 5 мес.: тариф ' + k5.tariff + ' (ожидается 11,08), ноябрь полностью');
if (!ok5) failed++;
var oldMap = JSON.parse(JSON.stringify(maps));
oldMap['Лимнос'].rows.passive = [[14, 5 / 6]];
oldMap['Гавайи'].rows.passive = [[13, 5 / 6]];
var fixed = ctx.koshtFixOverheadFee(oldMap);
var ok3 = fixed && oldMap['Лимнос'].rows.passive[0][1] === 1 && oldMap['Гавайи'].rows.passive[0][1] === 1 && !ctx.koshtFixOverheadFee(oldMap);
console.log((ok3 ? 'OK   ' : 'FAIL ') + 'сохранённая таблица: накладные 5/6 → 1, повторно не меняется');
if (!ok3) failed++;
// Сверка логики с готовым «Кошторис Лимнос (25-26)»: ноябрь, без ПДВ 87 107,19 при фонаре 2 782,91
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nКошторисы посчитаны');
process.exit(failed ? 1 : 0);
