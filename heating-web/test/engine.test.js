// Сверка движка с Excel v4 («Тарифы_отопление_методика_v4»): node heating-web/test/engine.test.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', 'engine.js'), 'utf8'), ctx);
var fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_v4.json'), 'utf8'));

var rows = ctx.engineCompute(fx.rows, ctx.engineDefaultSettings(), {}, {});
var fields = ['norm', 'mu', 'pool', 'costNo', 'volNo', 'fsoMzkVol', 't0', 'lambda', 'addSmooth', 'price', 'tNo', 'tSpch',
  'charged', 'diff', 'tol'];
var failed = 0;
rows.forEach(function (r, i) {
  var e = fx.expected[i], bad = [];
  fields.forEach(function (f) {
    var exp = e[f] === null || e[f] === '' ? 0 : e[f];
    var got = r[f];
    var tol = ['price', 'tNo', 'tSpch'].indexOf(f) >= 0 ? 0.0001 : 1e-6 * Math.max(1, Math.abs(exp));
    if (Math.abs(got - exp) > tol) bad.push(f + ': ' + got + ' ≠ ' + exp);
  });
  var okSign = (e.status.indexOf('ОШИБКА') === 0) === r.isError;
  if (!okSign) bad.push('статус: «' + r.status2 + '» vs «' + e.status + '»');
  console.log((bad.length ? 'FAIL ' : 'OK   ') + r.zk + ' ' + r.month + ' · Гкал ' + r.price + ' · без сч. ' + r.tNo +
    ' · СПЧ ' + r.tSpch + (bad.length ? '\n       ' + bad.join('\n       ') : ''));
  if (bad.length) failed++;
});
console.log(failed ? '\nПРОВАЛЕНО строк: ' + failed : '\nВсе 20 строк совпадают с Excel v4');
process.exit(failed ? 1 : 0);
