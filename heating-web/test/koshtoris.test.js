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
// Гавайи 26/27 после перехода на НДС (смета от 13.11.2026): итого остальное 279 224,27, тариф 3,15
var og = { '8': [9166.67, 18333.33, 18333.33, 18333.33, 18333.33], '10': [3456, 6912, 6912, 6912, 6912], '11': [4125, 8250, 8250, 8250, 8250],
  '12': [3707.58, 7415.15, 7415.15, 7415.15, 7415.15], '13': [3735.91, 7321.44, 7321.44, 7321.44, 7321.44],
  '14': [1577.14, 3154.27, 3154.27, 3154.27, 3154.27], '15': [157304.18, 314608.35, 314608.35, 314608.35, 314608.35], '16': [3684.19, 0, 0, 0, 0],
  '22': [2661.73, 5323.47, 5323.47, 5323.47, 5323.47], '23': [2661.73, 5323.47, 5323.47, 5323.47, 5323.47] };
var kog = ctx.koshtCompute(og, maps['Гавайи'], 19703.6, {});
var okOg = Math.abs(kog.season.gross - 279224.27) < 1 && kog.tariff === 3.15;
console.log((okOg ? 'OK   ' : 'FAIL ') + 'Гавайи 26/27 (НДС): с НДС ' + kog.season.gross.toFixed(2) + ' (ожидается 279 224,27), тариф ' + kog.tariff);
if (!okOg) failed++;
var ogOld = JSON.parse(JSON.stringify(maps)); ogOld['Гавайи'].rows.overhead = [[14, 0.01], [15, 0.01]]; ogOld['Гавайи'].rows.service = [[21, 5 / 6], [22, 5 / 6]];
var okMig = ctx.koshtFixHawaiiVat(ogOld) && JSON.stringify(ogOld['Гавайи'].rows.overhead) === '[[14,1]]' && ogOld['Гавайи'].rows.service[1][0] === 23 && !ctx.koshtFixHawaiiVat(ogOld);
console.log((okMig ? 'OK   ' : 'FAIL ') + 'сохранённая таблица Гавайев: переход на новые строки, повторно не меняется');
if (!okMig) failed++;
// ЛП 26/27 после перехода на НДС (смета от 13.11.2026): итого остальное 1 091 744,23, 5 мес.
var lp = { '9': five(18150), '11': five(33222), '13': five(23117.4),
  '14': [20982.07, 22257.32, 22859.21, 22257.32, 22016.56],                       // НДС — не берётся
  '15': [27710.65, 33230.64, 35835.99, 33230.64, 32188.50],                        // накладные 6 %
  '18': five(20304), '21': five(65.54),
  '24': [2710.32, 3566.56, 3970.69, 3566.56, 3404.90],                             // налог на прибыль 1 %
  '25': [59863.23, 145486.80, 185899.80, 145486.80, 129321.60], '26': five(211168.74),  // газ — не берётся
  '27': five(48406.80), '29': five(640), '30': five(300), '31': five(7800), '32': five(628.66), '33': five(773.44),
  '35': five(686.42), '36': five(420), '37': five(5877) };
var klp = ctx.koshtCompute(lp, maps['Лузановский Парк'], 19988.1, {});
var okLp = Math.abs(klp.season.gross - 1091744.23) < 1 && klp.tariff === 10.92;
console.log((okLp ? 'OK   ' : 'FAIL ') + 'ЛП 26/27 (НДС, 5 мес.): с НДС ' + klp.season.gross.toFixed(2) + ' (ожидается 1 091 744,23), тариф ' + klp.tariff);
if (!okLp) failed++;
var lpOld = JSON.parse(JSON.stringify(maps)); lpOld['Лузановский Парк'].rows.overhead = [[24, 0.01], [25, 0.01]];
lpOld['Лузановский Парк'].rows.gasdist = [[26, 5 / 6]]; lpOld['Лузановский Парк'].rows.service = [28, 29, 30, 31, 32, 33, 34, 35, 36].map(function (r) { return [r, 5 / 6]; });
var okLpMig = ctx.koshtFixLpVat(lpOld) && JSON.stringify(lpOld['Лузановский Парк'].rows.overhead) === '[[24,1]]' &&
  lpOld['Лузановский Парк'].rows.gasdist[0][0] === 27 && lpOld['Лузановский Парк'].rows.service[8][0] === 37 && !ctx.koshtFixLpVat(lpOld);
console.log((okLpMig ? 'OK   ' : 'FAIL ') + 'сохранённая таблица ЛП: переход на новые строки, повторно не меняется');
if (!okLpMig) failed++;
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
