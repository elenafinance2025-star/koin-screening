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
// Сверка логики с готовым «Кошторис Лимнос (25-26)»: ноябрь, без ПДВ 87 107,19 при фонаре 2 782,91
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nКошторисы посчитаны');
process.exit(failed ? 1 : 0);
