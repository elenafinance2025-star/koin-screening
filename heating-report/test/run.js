// Проверка чистых функций Code.gs в Node: node heating-report/test/run.js
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ctx = { Logger: { log: function (s) { console.log('  ' + s); } }, console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);

var failed = 0;
function check(name, cond) { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) failed++; }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1); }

var parsed = vm.runInContext('parseSettingsValues_([' +
  '["ЖК","Лист-источник"],' +
  '["Лимнос","Лимнос26-27",42,"Q","смешанный",694634,"Да"],' +
  '["ЛП","ЛП 26-27",42,"Q","по м²",0,"Да"],' +
  '["Гавайи","Гавайи26-27",26,"J","смешанный",0,"Да"],' +
  '["2. Сверхлимит"],' +
  '["веса профиля квитанции",0.6,1,1,1,0.9],' +
  '["суммы сверхлимита по месяцам, грн",0,0,0,0,0],' +
  '["Коэффициент для СПЧ (отключённые)",0.35]' +
  '])', ctx);
var cfg = ctx.validateSettings_(parsed);
check('настройки: коэф. СПЧ перенесён по названию (0.35)', cfg.params.kSpch === 0.35);
check('настройки: недостающие параметры по умолчанию', cfg.params.fso === 0.05 && cfg.params.mode === 'профиль квитанции');

// --- Лимнос, п. 5 ТЗ ---
var bills = [134902.91, 331260.63, 435515.99, 377670.79, 612625.70];
var ol = [0, 0, 0, 300000, 394634];
var a = ctx.allocateOverlimit_(bills.map(function (b, i) { return { monthIdx: i, bill: b, ol: ol[i] }; }), 694634, cfg);
var expAdds = [114776, 84871, 0, 338461, 156527];
var expBases = [249679, 416131, 435516, 416131, 374518];
check('добавки ' + a.adds.map(Math.round).join(' · '), a.adds.every(function (x, i) { return near(x, expAdds[i]); }));
var bases = bills.map(function (b, i) { return b - ol[i] + a.adds[i]; });
check('базы ' + bases.map(Math.round).join(' · '), bases.every(function (x, i) { return near(x, expBases[i]); }));
var sb = bases.reduce(function (s, x) { return s + x; }, 0), sbl = bills.reduce(function (s, x) { return s + x; }, 0);
check('сумма баз ' + sb.toFixed(2) + ' = сумма счетов ' + sbl.toFixed(2), near(sb, sbl, 0.005));
check('профиль: база ноя/дек = 0.6', near(bases[0] / bases[1], 0.6, 1e-9) && near(bases[4] / bases[3], 0.9, 1e-9));

// Неполный сезон: только ноябрь — добавка положительная и не сдвигает сумму > плана
var a1 = ctx.allocateOverlimit_([{ monthIdx: 0, bill: bills[0], ol: 0 }], 694634, cfg);
check('неполный сезон: ноябрь получает добавку ' + Math.round(a1.adds[0]) + ', остальные пусто',
  a1.adds[0] > 0 && a1.adds[1] === null && a1.estimated);

// --- Полный расчёт строк ---
var boiler = function (obj, m) { return obj.name === 'Гавайи' ? { value: 3.31942318 } : { value: 11.75099985 }; };
function row(rowNum, month, obj, v) {
  return { rowNum: rowNum, values: [month, obj].concat(v).concat(['']) };
}
// [счёт, сверхлимит, газ, Гкал ОДПУ, итого, со сч, СПЧ, без сч, Гкал сч]
var inputs = [
  row(4, 'Ноябрь', 'Лимнос', [134902.91, 0, 15623.16, '', 25094.84, 4380.87, 5090.81, 15623.16, 51.2616]),
  row(5, 'Декабрь', 'Лимнос', [331260.63, 0, 38000, '', 25094.84, 4380.87, 5090.81, 15623.16, 152.676]),
  row(6, 'Январь', 'Лимнос', [435515.99, 0, 50000, '', 25086.4, 4380.87, 5090.81, 15614.72, 276.7175]),
  row(7, 'Февраль', 'Лимнос', [377670.79, 300000, 52000, '', 25081.39, 4380.87, 5090.81, 15609.71, 264.0498]),
  row(8, 'Март', 'Лимнос', [612625.70, 394634, 45000, '', 25077.39, 4380.87, 5090.81, 15605.71, 132.7355]),
  row(9, 'Ноябрь', 'ЛП', [250000, 0, 20000, '', 19988.1, '', 1200.5, 18787.6, '']),
  row(10, 'Ноябрь', 'Гавайи', [180000, 0, '', 700, 19703.9, 3000, 500, 16203.9, 40]),
  row(11, 'Ноябрь', 'Гавайи', [180000, 0, '', 700, 19703.9, 3000, 500, 1000, 40]) // дубль + площади не сходятся
];
var res = ctx.computeAll_(cfg, inputs, boiler);
res.rows.forEach(function (c) {
  console.log('     ' + [c.month, c.receipt, c.objName, c.bill, c.boilerTotal, c.price, c.tNo, c.tSpch,
    c.charged === null ? '' : c.charged.toFixed(2), c.diff === null ? '' : c.diff.toFixed(2), c.status].join(' | '));
});
var ok = res.rows.filter(function (c) { return c.status === '✓ сходится'; });
check('Лимнос 5 месяцев + ЛП сходятся', ok.length === 6);
check('дубль Гавайев помечен ошибкой', res.rows.filter(function (c) { return c.objName === 'Гавайи' && /повтор/.test(c.status); }).length === 2);
check('лаг: ноябрь → декабрь, март → апрель', res.rows[0].receipt === 'Декабрь' && res.rows[4].receipt === 'Апрель');
check('ЛП без цены Гкал и без деления на ноль', res.rows[5].objName === 'ЛП' && res.rows[5].price === null && res.rows[5].tNo > 0);
var sumBase = res.rows.slice(0, 5).reduce(function (s, c) { return s + c.base; }, 0);
check('Лимнос: сумма баз = сумма счетов', near(sumBase, sbl, 0.01));
check('ширина строки отчёта = 11', ctx.fitRow_(['x'], 11).length === 11);

console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
