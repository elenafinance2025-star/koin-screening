// Режим «цена Гкал одна на сезон»: node heating-web/test/flatprice.test.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = {};
vm.createContext(ctx);
['engine.js', 'seed.js', 'koshtoris.js', 'reports.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', f), 'utf8'), ctx);
});
var S = ctx.engineDefaultSettings();
S.zk['Лимнос'] = { smoothRest: 'по профилю', smoothPrice: 'одна на сезон', olProfile: 'по профилю' };
var plan = ctx.seedPlanRows();
var failed = 0;
function check(n, c) { console.log((c ? 'OK   ' : 'FAIL ') + n); if (!c) failed++; }
function lim(rows) { return rows.filter(function (r) { return r.zk === 'Лимнос'; }); }
var rows = lim(ctx.engineCompute(plan, S, {}, {}));
rows.forEach(function (r) { console.log('     ' + r.month + ' · Гкал ' + r.price + ' · м² ' + r.tNo + ' · СПЧ ' + r.tSpch + ' · ' + r.status2.substring(0, 70)); });
check('цена Гкал одинаковая во всех месяцах', rows.every(function (r) { return r.price === rows[0].price; }));
var cost = rows.reduce(function (s, r) { return s + r.priceRaw * r.gkMeter; }, 0);
var paid = rows.reduce(function (s, r) { return s + r.price * r.gkMeter; }, 0);
var gkSum = rows.reduce(function (s, r) { return s + r.gkMeter; }, 0), roundTol = 0.005 * gkSum; // пол-копейки на Гкал
check('счётчики за сезон платят столько же (' + paid.toFixed(2) + ' ≈ ' + cost.toFixed(2) + ')', Math.abs(paid - cost) <= roundTol);
var base = rows.reduce(function (s, r) { return s + r.base; }, 0), charged = rows.reduce(function (s, r) { return s + r.charged; }, 0);
check('начислено за сезон = база сезона (Δ ' + (charged - base).toFixed(2) + ')', Math.abs(charged - base) < rows[0].seasonTol);
check('статусы без ошибок', rows.every(function (r) { return !r.isError; }));
// закрываем ноябрь по цене месяца — остальные месяцы добирают разницу
var nov = rows[0];
var closed = { 'Лимнос|Ноябрь': { price: 1700, tNo: nov.tNo, tSpch: nov.tSpch } };
var journal = { 'Лимнос': nov.tNo * nov.areaNo + nov.tSpch * nov.areaSpch };
var plan2 = plan.map(function (r) { var c = JSON.parse(JSON.stringify(r)); if (r.zk === 'Лимнос' && r.month === 'Ноябрь') c.status = 'закрыт'; return c; });
var rows2 = lim(ctx.engineCompute(plan2, S, journal, closed));
var paid2 = rows2.reduce(function (s, r) { return s + r.price * r.gkMeter; }, 0);
check('после закрытия ноября (1700): открытые месяцы по ' + rows2[1].price + ', сезон сходится (' + paid2.toFixed(2) + ')',
  rows2[0].price === 1700 && Math.abs(paid2 - cost) <= roundTol && rows2.slice(1).every(function (r) { return r.price === rows2[1].price; }));
// Гавайи (покупное тепло) не трогаем
S.zk['Гавайи'] = { smoothRest: 'нет', smoothPrice: 'одна на сезон', olProfile: 'по профилю' };
var hw = ctx.engineCompute(plan, S, {}, {}).filter(function (r) { return r.zk === 'Гавайи'; });
check('Гавайи остаются по фиксированной цене 1813,94', hw.every(function (r) { return r.price === 1813.94; }));
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nРежим «одна на сезон» работает');
process.exit(failed ? 1 : 0);
