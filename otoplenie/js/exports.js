/**
 * Выгрузки: Excel (SheetJS) и приказ с кошторисом (docx). Работают в браузере;
 * библиотеки передаются параметром, поэтому тот же код проверяется в Node.
 */

var EXPORT_FORMATS = { money: '#,##0.00', tariff: '0.00', num3: '#,##0.000', num4: '#,##0.0000', pct: '0.0%' };

/** Книга Excel из таблиц отчётов. X — библиотека SheetJS. */
function exportWorkbook(tables, X) {
  var wb = X.utils.book_new();
  var used = {};
  tables.forEach(function (t) {
    var W = t.headers.length;
    var pad = function (arr) { var a = arr.slice(); while (a.length < W) a.push(''); return a; };
    var aoa = [pad([t.title]), pad([t.note || '']), t.headers.slice()]
      .concat(t.rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : v; }); }));
    var ws = X.utils.aoa_to_sheet(aoa);
    t.rows.forEach(function (r, i) {
      r.forEach(function (v, c) {
        if (typeof v !== 'number') return;
        var f = t.formats[c] === 'x' && t.rowFormats ? t.rowFormats[i] : t.formats[c];
        var ref = X.utils.encode_cell({ r: i + 3, c: c });
        if (ws[ref] && EXPORT_FORMATS[f]) ws[ref].z = EXPORT_FORMATS[f];
      });
    });
    ws['!cols'] = t.headers.map(function (h, c) { return { wch: c < 3 ? 16 : Math.min(24, Math.max(12, String(h).length * 0.6)) }; });
    ws['!freeze'] = { xSplit: 0, ySplit: 3 };
    var name = t.title.replace(/[\[\]\*\?\/\\:]/g, ' ').substring(0, 31).trim();
    var base = name, n = 2;
    while (used[name]) { name = base.substring(0, 28) + ' ' + n++; }
    used[name] = true;
    X.utils.book_append_sheet(wb, ws, name);
  });
  return wb;
}

// ---------------------------------------------------------------------------
// Приказ
// ---------------------------------------------------------------------------

var ORDER_UA_MONTHS = ['листопад 2026', 'грудень 2026', 'січень 2027', 'лютий 2027', 'березень 2027'];
var ORDER_MONTHS = [
  { label: 'Листопад 2026', gen: 'листопада 2026', mm: '11-2026' },
  { label: 'Грудень 2026', gen: 'грудня 2026', mm: '12-2026' },
  { label: 'Січень 2027', gen: 'січня 2027', mm: '01-2027' },
  { label: 'Лютий 2027', gen: 'лютого 2027', mm: '02-2027' },
  { label: 'Березень 2027', gen: 'березня 2027', mm: '03-2027' },
  { label: 'Квітень 2027', gen: 'квітня 2027', mm: '04-2027' }
];

function orderFileName(zk, orderMonth) {
  var om = ORDER_MONTHS[orderMonth] || ORDER_MONTHS[0];
  return 'Наказ_опалення_' + String(zk).replace(/\s+/g, '_') + '_' + om.mm + '.docx';
}

function uaNum(x, d) {
  return engineFmt(x, d === undefined ? 2 : d);
}

function uaMonths(m) {
  return String(m).replace('.', ',');
}

/**
 * Документ приказа. D — библиотека docx.
 * o: { req, k (koshtCompute), rows (engineCompute по ЖК), settings, opts: { orderMonth, number, day, startDate } }
 */
function orderDocument(o, D) {
  var S = o.settings, k = o.k, req = o.req, rows = o.rows;
  var om = ORDER_MONTHS[o.opts.orderMonth] || ORDER_MONTHS[0];
  var num = (o.opts.number || '___') + '/' + om.mm;
  var day = o.opts.day || '___';
  var hasMeters = rows.some(function (r) { return r.gkMeter > 0; });
  var hasSpch = rows.some(function (r) { return r.areaSpch > 0; });
  var fixedHeat = rows.some(function (r) { return r.fixed === 1; });
  var title = req.name;
  var FONT = 'Times New Roman';
  var out = [];

  var para = function (text, opt) {
    opt = opt || {};
    var align = opt.center ? D.AlignmentType.CENTER : opt.right ? D.AlignmentType.RIGHT :
      opt.justify ? D.AlignmentType.JUSTIFIED : D.AlignmentType.LEFT;
    var runs = Array.isArray(text) ? text : [{ text: text, bold: opt.bold }];
    out.push(new D.Paragraph({
      alignment: align,
      spacing: { after: opt.after === undefined ? 80 : opt.after, line: 264 },
      indent: opt.indent ? { firstLine: 567 } : undefined,
      tabStops: opt.tabRight ? [{ type: D.TabStopType.RIGHT, position: 9600 }] : undefined,
      children: runs.map(function (r) {
        return new D.TextRun({ text: r.text, bold: !!r.bold, font: FONT, size: (opt.size || 12) * 2 });
      })
    }));
  };
  var pageBreak = function () { out.push(new D.Paragraph({ children: [new D.PageBreak()] })); };
  var border = { style: D.BorderStyle.SINGLE, size: 4, color: '808080' };
  var table = function (cells, widths, boldRows) {
    boldRows = boldRows || [];
    var total = widths.reduce(function (s, w) { return s + w; }, 0);
    out.push(new D.Table({
      width: { size: total, type: D.WidthType.DXA },
      columnWidths: widths,
      rows: cells.map(function (row, ri) {
        return new D.TableRow({
          tableHeader: ri === 0,
          children: row.map(function (txt, ci) {
            return new D.TableCell({
              width: { size: widths[ci], type: D.WidthType.DXA },
              borders: { top: border, bottom: border, left: border, right: border },
              shading: ri === 0 ? { fill: 'EEEEEE', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [new D.Paragraph({
                alignment: ci >= 2 && ri > 0 ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT,
                children: [new D.TextRun({ text: String(txt), font: FONT, size: 20,
                  bold: ri === 0 || boldRows.indexOf(ri) >= 0 })]
              })]
            });
          })
        });
      })
    }));
  };
  var appHead = function (no) {
    para('Додаток ' + no, { right: true, after: 0 });
    para('до наказу № ' + num + ' від «' + day + '» ' + om.gen + ' р.', { right: true, after: 240 });
  };

  // --- Наказ ---
  para(req.company, { bold: true, center: true, after: 0 });
  para('(ідентифікаційний код ' + (req.edrpou || '________') + ')', { center: true, after: 240 });
  para('НАКАЗ № ' + num, { bold: true, center: true, size: 14, after: 120 });
  para('м. Одеса\t«' + day + '» ' + om.gen + ' р.', { tabRight: true, after: 240 });
  para('Про встановлення тарифів на послугу з опалення', { bold: true, after: 0 });
  para(title + ' на опалювальний сезон 2026/2027', { bold: true, after: 240 });
  para('Відповідно до пунктів 3.3 та 3.4 Договорів про надання послуг з управління, Закону України «Про житлово-комунальні послуги» від 09.11.2017 № 2189-VIII, Правил надання послуги з управління багатоквартирним будинком, затверджених постановою Кабінету Міністрів України від 05.09.2018 № 712, Методики розподілу між споживачами обсягів спожитих у будівлі комунальних послуг, затвердженої наказом Міністерства регіонального розвитку, будівництва та житлово-комунального господарства України від 22.11.2018 № 315, з урахуванням переходу підприємства на загальну систему оподаткування з 01.10.2026, у зв\'язку з початком опалювального сезону 2026/2027,', { justify: true, indent: true });
  para('НАКАЗУЮ:', { bold: true, after: 120 });
  para('1. Встановити на опалювальний сезон 2026/2027 (з дати початку опалювального періоду, але не раніше 15 листопада 2026 року, до дати його завершення) для споживачів ' + title + ', ' + req.address + ', тарифи на послугу з опалення (у грн, у тому числі ПДВ 20 %):', { justify: true, indent: true });
  para('1.1. Утримання та обслуговування котельні — ' + uaNum(k.tariff) + ' грн за 1 м² опалюваної площі приміщення на місяць (у т.ч. ПДВ ' + uaNum(k.tariffVat) + ' грн), незалежно від наявності вузла розподільного обліку теплової енергії; за листопад 2026 року нараховується 50 % тарифу (опалювальний період з 15 листопада). Кошторис — Додаток 1.', { justify: true, indent: true });
  para('1.2. Вартість енергоносія для опалення — за місяцями опалювального сезону згідно з Додатком 2:', { justify: true, indent: true });
  var letters = ['а', 'б', 'в'], li = 0;
  if (hasMeters) para(letters[li++] + ') для приміщень, обладнаних вузлами розподільного обліку теплової енергії, — у грн за 1 Гкал за показаннями вузла обліку;', { justify: true, indent: true });
  para(letters[li++] + ') для приміщень без вузлів розподільного обліку — у грн за 1 м² опалюваної площі' + (hasSpch ? ';' : '.'), { justify: true, indent: true });
  if (hasSpch) para(letters[li++] + ') для приміщень, відключених від внутрішньобудинкової системи опалення (СПЧ), — у грн за 1 м² опалюваної площі, з урахуванням мінімальної частки ' + Math.round(S.kSpch * 100) + ' % (розділ VI Методики № 315).', { justify: true, indent: true });
  if (o.opts.orderMonth === 0) para('1.3. Листопад: авансові нарахування на початок опалювального сезону у сумі ____________ грн.', { justify: true, indent: true });
  if (o.opts.orderMonth === 5) para('1.3. Квітень: перерахунок авансових нарахувань після закінчення опалювального сезону: ____________.', { justify: true, indent: true });
  para('2. Тарифи, встановлені підпунктом 1.2, розраховані на підставі обсягів споживання та цін постачальника. Фактичні тарифи за кожен місяць визначаються за фактичними рахунками постачальника енергоносія та показаннями вузлів обліку відповідно до Порядку розрахунку (Додаток 3) і оформлюються розрахунком, що є невід\'ємною частиною цього наказу. Остаточний перерахунок за сезон — не пізніше двох місяців після його завершення.', { justify: true, indent: true });
  para('3. Нарахування за спожиту у місяці теплову енергію здійснювати у квитанції наступного місяця (споживання листопада — у квитанції за грудень тощо).', { justify: true, indent: true });
  para('4. Бухгалтеру забезпечити нарахування споживачам згідно з цим наказом.', { justify: true, indent: true });
  para('5. Адміністратору комплексу довести цей наказ до відома споживачів шляхом розміщення на інформаційних стендах, в особистих кабінетах та в месенджер-каналі комплексу у строк, передбачений Договорами про надання послуг з управління.', { justify: true, indent: true });
  para('6. Встановити початок опалювального сезону: ' + (o.opts.startDate || '________________') + '.', { justify: true, indent: true });
  para('7. Контроль за виконанням цього наказу залишаю за собою.', { justify: true, indent: true, after: 360 });
  para([{ text: 'Директор', bold: true }, { text: '\t' + (req.director || ''), bold: true }], { tabRight: true, after: 360 });
  para('З наказом ознайомлені:', { after: 120 });
  para('Бухгалтер ______________ / ____________ /');

  // --- Додаток 1 ---
  pageBreak();
  appHead(1);
  para('КОШТОРИС ВИТРАТ НА УТРИМАННЯ ТА ОБСЛУГОВУВАННЯ КОТЕЛЬНІ', { bold: true, center: true, after: 0 });
  para('на опалювальний сезон 2026/2027', { bold: true, center: true, after: 120 });
  para(title + ', ' + req.address, { center: true, after: 40 });
  para('Опалювана площа: ' + uaNum(k.area) + ' м² · Період нарахування: ' + uaMonths(k.months) + ' міс. (' + (koshtMonthShare(0, k.months) >= 1 ? 'листопад' : '15 листопада') + ' 2026 – березень 2027)', { center: true, size: 11, after: 160 });
  var cells = [['№', 'Стаття витрат', 'грн/м² на місяць', 'грн на місяць', 'грн за сезон (' + uaMonths(k.months) + ' міс.)']];
  var bold = [];
  var groupNo = { admin: '1', oper: '2' };
  k.articles.forEach(function (a) {
    if (a.group) bold.push(cells.length);
    cells.push([a.group ? groupNo[a.key] : a.num, a.title, uaNum(a.perM2), uaNum(a.perMonth), uaNum(a.season)]);
  });
  bold.push(cells.length, cells.length + 1, cells.length + 2);
  cells.push(['', 'Всього, без ПДВ', uaNum(k.perM2.net), uaNum(k.perMonth.net), uaNum(k.season.net)]);
  cells.push(['', 'ПДВ 20 %', uaNum(k.perM2.vat), uaNum(k.perMonth.vat), uaNum(k.season.vat)]);
  cells.push(['', 'Всього з ПДВ', uaNum(k.perM2.gross), uaNum(k.perMonth.gross), uaNum(k.season.gross)]);
  table(cells, [600, 4400, 1500, 1600, 1700], bold);
  para('Тариф на утримання котельні = Всього з ПДВ за сезон ÷ опалювана площа ÷ ' + uaMonths(k.months) + ' (кількість місяців нарахування); ' + koshtNovNote(k.months) + '. Розподіл ФСО та МЗК до цього тарифу не включається (входить лише до вартості енергоносія).', { justify: true, size: 10, after: 240 });
  para('Бухгалтер ______________');

  // --- Додаток 2 ---
  pageBreak();
  appHead(2);
  para('ТАРИФИ НА ЕНЕРГОНОСІЙ ДЛЯ ОПАЛЕННЯ', { bold: true, center: true, after: 0 });
  para('на опалювальний сезон 2026/2027 (з ПДВ)', { bold: true, center: true, after: 120 });
  para(title + ', ' + req.address, { center: true, after: 40 });
  para('Джерело теплопостачання: ' + (req.source || '') + '.', { center: true, size: 11, after: 160 });
  var head = ['Місяць споживання'], widths = [2000];
  if (hasMeters) { head.push('З вузлом обліку, грн/Гкал'); widths.push(1700); }
  head.push('Без вузла обліку, грн/м²'); widths.push(1700);
  if (hasSpch) { head.push('Відключені (СПЧ), грн/м²'); widths.push(1700); }
  head.push('Утримання котельні, грн/м²', 'Дані'); widths.push(1700, 900);
  var c2 = [head];
  rows.forEach(function (r) {
    var line = [ORDER_UA_MONTHS[r.monthIdx] || r.month];
    if (hasMeters) line.push(uaNum(r.price));
    line.push(uaNum(r.tNo));
    if (hasSpch) line.push(uaNum(r.tSpch));
    line.push(uaNum(engineRound(k.tariff * koshtMonthShare(r.monthIdx, k.months), 2)), r.source === 'факт' ? 'факт' : 'план');
    c2.push(line);
  });
  table(c2, widths);
  para('1. Тарифи включають ПДВ 20 %.', { size: 10, after: 40 });
  para('2. Вартість понадлімітного обсягу газу розподілена на сезон: частина — надбавкою до ціни 1 Гкал, частина — на приміщення без вузлів обліку і СПЧ за профілем квитанції.', { size: 10, justify: true, after: 40 });
  para('3. «план» — тариф розраховано за плановими даними; після надходження рахунку постачальника тариф уточнюється за фактом.', { size: 10, justify: true, after: 240 });
  para('Бухгалтер ______________');

  // --- Додаток 3 ---
  pageBreak();
  appHead(3);
  para('ПОРЯДОК РОЗРАХУНКУ ТА РОЗПОДІЛУ ВАРТОСТІ ОПАЛЕННЯ', { bold: true, center: true, after: 120 });
  para(title + ', ' + req.address, { center: true, after: 200 });
  [
    'Розподіл обсягів і вартості теплової енергії між споживачами здійснюється відповідно до розділів II та VI Методики розподілу між споживачами обсягів спожитих у будівлі комунальних послуг, затвердженої наказом Мінрегіону від 22.11.2018 № 315.',
    fixedHeat ? 'Загальний обсяг теплової енергії будівлі (Q, Гкал) визначається за показаннями загальнобудинкового вузла обліку теплової енергії; приміщення з вузлами розподільного обліку оплачують 1 Гкал за ціною постачальника.' :
      'Загальний обсяг теплової енергії будівлі (Q, Гкал) визначається як обсяг спожитого котельнею газу (м³), помножений на коефіцієнт ' + String(S.kcal).replace('.', ',') + ' Гкал/м³.',
    'Із загального обсягу виокремлюються обсяги на функціонування внутрішньобудинкової системи опалення (ФСО) — ' + Math.round(S.fso * 100) + ' % та на опалення місць загального користування (МЗК) — ' + Math.round(S.mzk * 100) + ' %. Вартість ФСО і МЗК включається виключно до вартості енергоносія і не включається до тарифу на утримання котельні.',
    'Приміщення з вузлами розподільного обліку оплачують обсяг за показаннями за ціною 1 Гкал. Якщо показання перевищують індивідуальну частку, у першу чергу зменшується частка ФСО та МЗК.',
    'Приміщення без вузлів обліку оплачують залишок обсягу (Q − ФСО − МЗК − показання вузлів обліку) пропорційно опалюваній площі.',
    'Для приміщень, відключених від внутрішньобудинкової системи опалення (СПЧ), застосовується мінімальна частка ' + Math.round(S.kSpch * 100) + ' % тарифу для приміщень без вузлів обліку (розділ VI Методики № 315).',
    'Вартість газу понад ліміт, виставлена постачальником, розподіляється на весь опалювальний сезон: частина — надбавкою до ціни 1 Гкал, частина — на приміщення без вузлів обліку і СПЧ за профілем квитанції. Загальна сума нарахувань за сезон дорівнює сумі рахунків постачальника.',
    'Тариф на утримання котельні встановлюється єдиним на сезон: сума кошторису з ПДВ ÷ опалювана площа ÷ ' + uaMonths(k.months) + ' (кількість місяців нарахування); ' + koshtNovNote(k.months) + '.',
    'Підприємство є платником ПДВ; ПДВ нараховується на повну вартість послуги з опалення за ставкою 20 %.'
  ].forEach(function (t, i) { para((i + 1) + '. ' + t, { justify: true, indent: true }); });
  para('', { after: 240 });
  para([{ text: 'Директор', bold: true }, { text: '\t' + (req.director || ''), bold: true }], { tabRight: true });

  return new D.Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 1418, right: 850 } } },
      children: out
    }]
  });
}
