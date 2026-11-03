// Выгрузки: Excel и приказ собираются без ошибок: node heating-web/test/exports.test.js
// Нужны пакеты docx@8.5.0 и xlsx@0.18.5 (NODE_PATH на их node_modules).
var fs = require('fs'), vm = require('vm'), path = require('path');
var ctx = { console: console };
vm.createContext(ctx);
['engine.js', 'koshtoris.js', 'reports.js', 'seed.js', 'exports.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'otoplenie', 'js', f), 'utf8'), ctx);
});
var D = require('docx'), X = require('xlsx');
var sm = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_smeta.json'), 'utf8'));
var maps = ctx.koshtDefaultMapping(), kosht = {};
Object.keys(maps).forEach(function (zk) { kosht[zk] = ctx.koshtCompute(sm[zk].rows, maps[zk], Number(sm[zk].area), {}); });
var plan = ctx.seedPlanRows();
var res = ctx.repBuildAll({ plan: plan, fact: [], settings: ctx.engineDefaultSettings(), koshtPlan: kosht, koshtFact: kosht });
var tables = res.tables.concat(Object.keys(kosht).map(function (zk) { return ctx.repKoshtTable(zk, kosht[zk]); }));
var wb = ctx.exportWorkbook(tables, X);
var out = process.argv[2] || '/tmp';
X.writeFile(wb, path.join(out, 'test_report.xlsx'));
console.log('Excel: листов ' + wb.SheetNames.length + ' — ' + wb.SheetNames.join(' | '));
var req = ctx.seedRequisites();
var jobs = ['Лимнос', 'Лузановский Парк', 'Гавайи'].map(function (zk, i) {
  var doc = ctx.orderDocument({ req: req[zk], k: kosht[zk], rows: res.workCalc.filter(function (r) { return r.zk === zk; }),
    settings: ctx.engineDefaultSettings(), opts: { orderMonth: i === 0 ? 0 : 5, number: '15', day: '14' } }, D);
  return D.Packer.toBuffer(doc).then(function (buf) {
    var f = path.join(out, ctx.orderFileName(zk, i === 0 ? 0 : 5));
    fs.writeFileSync(f, buf);
    console.log('Приказ: ' + f + ' (' + buf.length + ' байт)');
  });
});
Promise.all(jobs).then(function () { console.log('\nВыгрузки собраны'); }, function (e) { console.error(e); process.exit(1); });
