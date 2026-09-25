// Проверяет, что формулы листа ДЕТАЛИ РАСЧЁТА дают те же числа, что и скрипт: node heating-report/test/formulas.js
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);

// НАСТРОЙКИ: параметры в колонке B, строки по порядку
var settingsRows = [['ЖК', 'Лист-источник'], ['Лимнос', 'Лимнос26-27', 42, 'Q', 'смешанный', 694634, 'Да'],
  ['ЛП', 'ЛП 26-27', 42, 'Q', 'по м²', 0, 'Да'], ['3. Параметры']];
var paramsFirst = settingsRows.length + 1;
ctx.PARAMS.forEach(function (p) { settingsRows.push([p.label, p.key === 'kSpch' ? 0.35 : p.def]); });
var sheets = { 'НАСТРОЙКИ': {}, 'ВВОД': {}, 'Лимнос26-27': {}, 'ЛП 26-27': {}, 'ДЕТАЛИ РАСЧЁТА': {} };
settingsRows.forEach(function (row, i) { row.forEach(function (v, j) { sheets['НАСТРОЙКИ'][ctx.indexToCol_(j + 1) + (i + 1)] = v; }); });
var boil = [5.902370133, 11.75099985, 11.75099985, 11.75099985, 11.75099985];
boil.forEach(function (b, i) { sheets['Лимнос26-27'][ctx.indexToCol_(17 + i) + 42] = b; sheets['ЛП 26-27'][ctx.indexToCol_(17 + i) + 42] = 10.23856553; });

var M = ['Ноябрь', 'Декабрь', 'Январь', 'Февраль', 'Март'];
var data = [
  [134902.91, 0, 16512, '', 25094.84, 15623.16, 4380.87, 5090.81, 51.2616],
  [331260.63, 0, 39556.09, '', 25094.84, 16979.25, 3824.18, 4291.41, 152.676],
  [435515.99, 0, 53883.18, '', 25086.4, 17414.4, 3479.06, 4192.94, 276.7175],
  [377670.79, 300000, 46726.42, '', 25081.39, 17451.47, 3501.3, 4128.62, 264.0498],
  [612625.70, 394634, 23045.8, '', 25077.39, 16514.85, 3744.37, 4818.17, 132.7355]];
var inputs = data.map(function (v, i) { return { rowNum: 4 + i, values: [M[i], 'Лимнос'].concat(v).concat(['']) }; });
inputs.push({ rowNum: 9, values: ['Ноябрь', 'ЛП', 250000, 0, 20000, '', 19988.1, '', 1200.5, 18787.6, '', ''] });
inputs.forEach(function (inp) { inp.values.forEach(function (v, j) { sheets['ВВОД'][ctx.indexToCol_(j + 1) + inp.rowNum] = v; }); });

var failed = 0;
[[',', 'пропорционально газу'], [';', 'пропорционально газу'], [';', 'в содержание котельной']].forEach(function (mode) {
  var sep = mode[0], fsoMode = mode[1];
  var cfg = ctx.readSettingsFromRows = null;
  var parsed = ctx.parseSettingsValues_(settingsRows);
  cfg = ctx.validateSettings_(parsed);
  cfg.params.fsoMode = fsoMode;
  cfg.formulaSep = sep;
  var res = ctx.computeAll_(cfg, inputs, function (obj, m) { return { value: obj.name === 'ЛП' ? 10.23856553 : boil[m] }; });
  var det = sheets['ДЕТАЛИ РАСЧЁТА'] = {};
  var first = 4;
  var rows = res.rows.map(function (c, k) { return ctx.detailFormulas_(c, cfg, first + k); });
  rows.forEach(function (row, k) { row.forEach(function (v, j) { det[ctx.indexToCol_(j + 1) + (first + k)] = v; }); });

  function val(sheet, ref) {
    var v = sheets[sheet][ref];
    if (typeof v === 'string' && v.charAt(0) === '=') return evalF(sheet, v.substring(1));
    return v === '' || v === undefined ? 0 : v;
  }
  function evalF(sheet, f) {
    var js = f.replace(/'([^']+)'!\$?([A-Z]+)\$?(\d+)/g, function (_, sh, col, row) { return 'V(' + JSON.stringify(sh) + ',"' + col + row + '")'; })
      .replace(/(^|[^A-Za-z"])([A-Z]{1,2})(\d+)(?![\d"])/g, function (_, pre, col, row) { return pre + 'V(' + JSON.stringify(sheet) + ',"' + col + row + '")'; })
      .replace(/;/g, ',').replace(/\^/g, '**').replace(/ROUND\(/g, 'R(').replace(/\bN\(/g, 'NN(');
    return Function('V', 'R', 'NN', 'return ' + js)(val, function (x, d) { return ctx.round_(x, d); }, function (x) { return Number(x) || 0; });
  }
  var cols = { F: 'olAdd', G: 'base', H: 'norm', J: 'fsoMzk', M: 'priceBase', N: 'price', O: 'restGkal', P: 'tNo', Q: 'tSpch', S: 'charged', T: 'diff', U: 'tol' };
  res.rows.forEach(function (c, k) {
    var r = first + k, bad = [];
    if (sep === ';') rows[k].forEach(function (f) { if (typeof f === 'string' && /ROUND\([^;]*,/.test(f)) bad.push('запятая в формуле: ' + f); });
    Object.keys(cols).forEach(function (col) {
      var exp = c[cols[col]];
      if (exp === null) return;
      var got = val('ДЕТАЛИ РАСЧЁТА', col + r);
      if (Math.abs(got - exp) > 1e-6 * Math.max(1, Math.abs(exp))) bad.push(col + ': формула ' + got + ' ≠ скрипт ' + exp);
    });
    var receipt = val('ДЕТАЛИ РАСЧЁТА', 'R' + r);
    console.log((bad.length ? 'FAIL ' : 'OK   ') + '«' + sep + '» ' + fsoMode + ' · ' + c.objName + ' ' + c.month + ' · квитанция без сч. ' +
      receipt.toFixed(2) + ' · цена Гкал ' + (c.price === null ? '—' : c.price) + (bad.length ? ' · ' + bad.join('; ') : ''));
    if (bad.length) failed++;
  });
});
console.log(failed ? '\nПРОВАЛЕНО: ' + failed : '\nФормулы совпадают со скриптом');
process.exit(failed ? 1 : 0);
