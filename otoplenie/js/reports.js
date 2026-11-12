/**
 * Отчёты веб-инструмента. Чистые функции: каждая возвращает таблицу
 * { id, title, note, headers: [...], rows: [[...]], formats: ['text'|'money'|'tariff'|'num3'|'num4'|'pct'] }.
 * Одни и те же таблицы показываются в браузере и выгружаются в Excel.
 */

var ZK_ORDER = ['Лимнос', 'Атлант', 'Лузановский Парк', 'Гавайи'];

function repKey(r) { return r.zk + '|' + r.month; }

function repIndex(rows) {
  var m = {};
  rows.forEach(function (r) { m[repKey(r)] = r; });
  return m;
}

/** Факт введён, если есть счёт или газ/Гкал. */
function repHasFact(r) {
  return !!r && (engineNum(r.bill) > 0 || engineNum(r.gas) > 0 || engineNum(r.gkalHouse) > 0);
}

/** Рабочие данные: факт там, где он введён, иначе план (пометка source). */
function repMerge(planRows, factRows) {
  var f = repIndex(factRows || []);
  return (planRows || []).map(function (p) {
    var x = f[repKey(p)];
    var use = repHasFact(x) ? x : p;
    var copy = {};
    Object.keys(use).forEach(function (k) { copy[k] = use[k]; });
    copy.source = repHasFact(x) ? 'факт' : 'план';
    if (x && x.status === 'закрыт') copy.status = 'закрыт';
    return copy;
  });
}

function repSortRows(rows) {
  return rows.slice().sort(function (a, b) {
    var za = ZK_ORDER.indexOf(a.zk), zb = ZK_ORDER.indexOf(b.zk);
    if (za !== zb) return (za < 0 ? 99 : za) - (zb < 0 ? 99 : zb);
    return ENGINE_MONTHS.indexOf(a.month) - ENGINE_MONTHS.indexOf(b.month);
  });
}

/**
 * Все отчёты.
 * ctx: { plan, fact, settings, journal, closed, koshtPlan: {zk: koshtCompute}, koshtFact: {zk: koshtCompute} }
 */
function repBuildAll(ctx) {
  var S = ctx.settings;
  // Газ по сезонному лимиту (gas.js): план — счёт и сверхлимит из объёма; рабочие — прогноз от факта
  var useGas = ctx.gasTariffs && typeof gasApplyPlan === 'function';
  // план считается по ценам, зафиксированным вместе с планом (если фиксировали), рабочие — по текущим
  var plan = useGas ? gasApplyPlan(ctx.plan, ctx.gasPlanTariffs || ctx.gasTariffs) : ctx.plan;
  var planCalc = repSortRows(engineCompute(plan, S, {}, {}));
  var work = repMerge(plan, ctx.fact);
  if (useGas) work = gasApplyWork(work, ctx.gasTariffs);
  var workCalc = repSortRows(engineCompute(work, S, ctx.journal || {}, ctx.closed || {}));
  var factIdx = repIndex(ctx.fact || []);
  var planIdx = repIndex(planCalc);
  return {
    planCalc: planCalc,
    workCalc: workCalc,
    tables: [
      repTariffs(workCalc, ctx.koshtFact),
      repAccrual(planCalc, workCalc, factIdx, ctx.koshtPlan, ctx.koshtFact),
      repOverlimit(planIdx, workCalc, factIdx),
      repPlanFact(planIdx, workCalc, factIdx, ctx.koshtPlan, ctx.koshtFact),
      repDetails(workCalc),
      repResult(planCalc, workCalc, factIdx, ctx.koshtPlan, ctx.koshtFact, ctx.boilerCosts || {})
    ]
  };
}

/**
 * 6. Результат сезона по ЖК: начислено − расход = результат (+ доход, − убыток).
 * Газ — с НДС (начисление и счета поставщика с НДС, налог взаимно сокращается).
 * Котельная — без НДС: начислено ÷ 1,2; расход = административные (без НДС) + эксплуатационные (с НДС) ÷ 1,2.
 * costs: { zk: { planCost, factCost } } — расход котельной за сезон с НДС (÷ 1,2); пустой план = кошторис.
 * Прежний формат { planAdmin, planOper, factAdmin, factOper } тоже понимается.
 * Прогноз на конец сезона: газ — факт за месяцы с фактом + план (рабочие данные) остальных; котельная — факт расхода, если внесён, иначе план.
 */
var REP_VAT = 1.2;

function repSet(v) { return v !== '' && v !== undefined && v !== null; }

function repResultCostPlan(kosht, c) {
  if (c && repSet(c.planCost)) return { value: engineNum(c.planCost), src: 'план введён' };
  var hasPlan = c && (c.planAdmin !== '' && c.planAdmin !== undefined && c.planAdmin !== null ||
    c.planOper !== '' && c.planOper !== undefined && c.planOper !== null);
  if (hasPlan) return { value: engineNum(c.planAdmin) * REP_VAT + engineNum(c.planOper), src: 'план введён' };
  return { value: kosht ? kosht.season.gross : 0, src: kosht ? 'план = кошторис' : 'нет кошториса' };
}

function repResult(planCalc, workCalc, factIdx, koshtPlan, koshtFact, costs) {
  var rows = [];
  var sum = function (list, f) { return list.reduce(function (s, r) { return s + engineNum(f(r)); }, 0); };
  var all = { accGasP: 0, accGasD: 0, accGasF: 0, billP: 0, billD: 0, billF: 0, accBP: 0, accBD: 0, accBF: 0, costP: 0, costF: 0 };
  var push = function (zk, item, plan, toDate, fc, src) {
    rows.push([zk, item, plan, toDate, fc, typeof plan === 'number' && typeof fc === 'number' ? fc - plan : '', src]);
  };
  var block = function (zk, v, srcGas, srcCost) {
    push(zk, 'Начислено жильцам: газ (с НДС)', v.accGasP, v.accGasD, v.accGasF, srcGas);
    push(zk, 'Расход: газ — счета поставщика (с НДС)', v.billP, v.billD, v.billF, srcGas);
    push(zk, 'Результат: газ', v.accGasP - v.billP, v.billD === '' ? '' : v.accGasD - v.billD, v.accGasF - v.billF, '');
    push(zk, 'Начислено жильцам: котельная (с НДС)', v.accBP, v.accBD, v.accBF, 'тариф кошториса × площадь');
    push(zk, 'Расход: котельная (с НДС)', v.costP, '', v.costF, srcCost);
    push(zk, 'Результат: котельная', v.accBP - v.costP, '', v.accBF - v.costF, '');
    push(zk, 'Результат: котельная без НДС', (v.accBP - v.costP) / REP_VAT, '', (v.accBF - v.costF) / REP_VAT, 'реальный заработок: результат ÷ 1,2');
    var totP = v.accGasP - v.billP + v.accBP - v.costP, totF = v.accGasF - v.billF + v.accBF - v.costF;
    push(zk, 'Результат итого', totP, '', totF, '');
    push(zk, 'Результат итого без НДС', totP / REP_VAT, '', totF / REP_VAT, 'реальный заработок: результат ÷ 1,2');
  };
  ZK_ORDER.forEach(function (zk) {
    var w = workCalc.filter(function (r) { return r.zk === zk; });
    if (!w.length) return;
    var p = planCalc.filter(function (r) { return r.zk === zk; });
    var isF = function (r) { return repHasFact(factIdx[repKey(r)]); };
    var wf = w.filter(isF);
    var boiler = function (kosht, r) { return repKoshtTariff(kosht, zk) * koshtMonthShare(r.monthIdx, repKoshtMonths(kosht, zk)) * repKoshtArea(kosht, zk); };
    var c = costs[zk] || {};
    var cp = repResultCostPlan(koshtPlan && koshtPlan[zk], c);
    var hasFact = repSet(c.factCost) || repSet(c.factAdmin) || repSet(c.factOper);
    var factCost = repSet(c.factCost) ? engineNum(c.factCost) : engineNum(c.factAdmin) * REP_VAT + engineNum(c.factOper);
    var v = {
      accGasP: sum(p, function (r) { return r.charged; }), accGasD: sum(wf, function (r) { return r.charged; }),
      accGasF: sum(w, function (r) { return r.charged; }),
      billP: sum(p, function (r) { return r.bill; }), billD: sum(wf, function (r) { return r.bill; }),
      billF: sum(w, function (r) { return r.bill; }),
      accBP: sum(p, function (r) { return boiler(koshtPlan, r); }), accBD: sum(wf, function (r) { return boiler(koshtFact, r); }),
      accBF: sum(w, function (r) { return boiler(koshtFact, r); }),
      costP: cp.value, costF: hasFact ? factCost : cp.value
    };
    var srcGas = wf.length === w.length ? 'факт за все месяцы' : wf.length ? 'факт ' + wf.length + ' мес. + план ' + (w.length - wf.length) + ' мес.' : 'нет факта — план';
    if (!wf.length) { v.accGasD = ''; v.billD = ''; v.accBD = ''; }
    Object.keys(all).forEach(function (k) { if (typeof v[k] === 'number') all[k] += v[k]; });
    block(zk, v, srcGas, hasFact ? 'факт за сезон' : cp.src + ' (факта ещё нет)');
  });
  if (rows.length > 7) block('Все ЖК', all, '', '');
  return {
    id: 'result', title: 'Результат сезона: начислено − расход',
    note: 'Плюс — доход, минус — убыток. Газ — с НДС (в начислении и в счетах поставщика он одинаков и сокращается). ' +
      'Котельная — тоже с НДС: начислено по тарифу кошториса, расход — сумма с НДС, внесённая над таблицей. Строки «без НДС» — результат ÷ 1,2: реальный заработок, НДС уходит в бюджет. ' +
      '«Факт на сегодня» — только месяцы с введённым счётом. «Прогноз на конец сезона» — факт там, где он есть, остальное по плану. Расход котельной — за сезон: до ввода факта берётся план.',
    headers: ['ЖК', 'Статья', 'План на сезон, грн', 'Факт на сегодня, грн', 'Прогноз на конец сезона, грн', 'Прогноз − план, грн', 'Источник'],
    formats: ['text', 'text', 'money', 'money', 'money', 'money', 'text'],
    rows: rows
  };
}

/** Строки «Результат…» выделяются как итоговые (и после фильтра). */
function repResultMarks(t) {
  var copy = {};
  Object.keys(t).forEach(function (k) { copy[k] = t[k]; });
  copy.totalIdx = [];
  t.rows.forEach(function (r, i) { if (String(r[1]).indexOf('Результат') === 0) copy.totalIdx.push(i); });
  return copy;
}

function repKoshtMonths(kosht, zk) {
  return kosht && kosht[zk] ? kosht[zk].months : 4.5;
}

function repKoshtTariff(kosht, zk) {
  return kosht && kosht[zk] ? kosht[zk].tariff : 0;
}

function repKoshtArea(kosht, zk) {
  return kosht && kosht[zk] ? kosht[zk].area : 0;
}

/** 1. Тарифы месяца (как лист ОТЧЁТ). */
function repTariffs(calc, koshtFact) {
  return {
    id: 'tariffs', title: 'Тарифы по месяцам',
    note: 'Рабочие данные: факт там, где он введён, иначе план. Колонка «Данные» показывает источник.',
    headers: ['Месяц потребления', 'Месяц квитанции', 'ЖК', 'Данные', 'Счёт поставщика, грн',
      'Содержание котельной, грн/м²', 'Газ по счётчику, грн/Гкал', 'Газ без счётчика, грн/м²', 'Газ СПЧ, грн/м²',
      'Расчётно начислено (газ), грн', 'Расхождение, грн', 'Статус'],
    formats: ['text', 'text', 'text', 'text', 'money', 'tariff', 'tariff', 'tariff', 'tariff', 'money', 'money', 'text'],
    rows: calc.map(function (r) {
      var kt = repKoshtTariff(koshtFact, r.zk) * koshtMonthShare(r.monthIdx, repKoshtMonths(koshtFact, r.zk));
      return [r.month, r.receipt, r.zk, r.source || 'план', r.bill, engineRound(kt, 2), r.price, r.tNo, r.tSpch,
        r.charged, r.diff, r.status2];
    })
  };
}

/** 2. Отчёт по начислению: содержание котельной и газ, план / факт / отклонение. */
function repAccrual(planCalc, workCalc, factIdx, koshtPlan, koshtFact) {
  var pIdx = repIndex(planCalc);
  var reserveAcc = {};
  var rows = workCalc.map(function (w) {
    var p = pIdx[repKey(w)] || {};
    var isFact = repHasFact(factIdx[repKey(w)]);
    // Запас = начислено жильцам по газовым тарифам − счёт поставщика (плюс — собрано больше счёта, минус — меньше)
    var reserveFact = isFact ? w.charged - w.bill : '';
    if (isFact) reserveAcc[w.zk] = (reserveAcc[w.zk] || 0) + reserveFact;
    var boilerPlan = repKoshtTariff(koshtPlan, w.zk) * koshtMonthShare(w.monthIdx, repKoshtMonths(koshtPlan, w.zk)) * repKoshtArea(koshtPlan, w.zk);
    var boilerFact = repKoshtTariff(koshtFact, w.zk) * koshtMonthShare(w.monthIdx, repKoshtMonths(koshtFact, w.zk)) * repKoshtArea(koshtFact, w.zk);
    var f = function (v) { return isFact ? v : ''; };
    var d = function (a, b) { return isFact ? a - b : ''; };
    return [w.month, w.zk,
      boilerPlan, isFact ? boilerFact : '', d(boilerFact, boilerPlan),
      engineNum(p.gas), f(w.gas), d(w.gas, engineNum(p.gas)),
      engineNum(p.bill), f(w.bill), d(w.bill, engineNum(p.bill)),
      engineNum(p.charged), f(w.charged), d(w.charged, engineNum(p.charged)),
      reserveFact, isFact ? reserveAcc[w.zk] : ''];
  });
  return {
    id: 'accrual', title: 'Начисление: содержание котельной и расход газа (план / факт)',
    note: 'Котельная: тариф кошториса × площадь × доля месяца (ноябрь — 50 % при 4,5 мес., 100 % при 5 мес.). Газ: объём, счёт поставщика и начислено по газовым тарифам. Факт показывается только для месяцев с введёнными счетами.',
    headers: ['Месяц', 'ЖК',
      'Котельная план, грн', 'Котельная факт, грн', 'Котельная Δ, грн',
      'Газ план, тыс. м³', 'Газ факт, тыс. м³', 'Газ Δ, тыс. м³',
      'Счёт план, грн', 'Счёт факт, грн', 'Счёт Δ, грн',
      'Начислено газ план, грн', 'Начислено газ факт, грн', 'Начислено газ Δ, грн',
      'ЗАПАС факт, грн', 'ЗАПАС факт нараст., грн'],
    formats: ['text', 'text', 'money', 'money', 'money', 'num4', 'num4', 'num4',
      'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money'],
    rows: rows
  };
}

/** 3. Сверхлимит: в счетах и начислено в тарифах, помесячно и нарастающим итогом. */
function repOverlimit(planIdx, workCalc, factIdx) {
  var acc = {};
  var rows = workCalc.map(function (w) {
    var a = acc[w.zk] = acc[w.zk] || { bill: 0, charged: 0 };
    a.bill += w.ol;
    a.charged += w.olCharged;
    var g = w.gasInfo;
    return [w.month, w.zk, w.source || 'план',
      g ? g.cum : '', g ? g.limitLeft : '',
      w.ol, w.olCharged, a.charged - a.bill, w.olSeason - a.charged];
  });
  return {
    id: 'overlimit', title: 'Сверхлимит газа: выставлено в счетах и начислено в тарифах',
    note: 'Данные — факт там, где счёт введён, иначе план. Начислено в тарифах = надбавка μ × Гкал по счётчикам + добавка сглаживания на квартиры без счётчиков и СПЧ. ' +
      '«Разница нараст.» = начислено с ноября − выставлено в счетах с ноября. «Осталось разнести» = сверхлимит сезона − начислено нарастающим итогом. Сравнение с планом — на вкладке «План-факт».',
    headers: ['Месяц', 'ЖК', 'Данные', 'Накоплено с ноября, тыс. м³', 'Остаток лимита, тыс. м³',
      'В счёте поставщика, грн', 'Начислено в тарифах, грн', 'Разница нараст., грн', 'Осталось разнести, грн'],
    formats: ['text', 'text', 'text', 'num4', 'num4', 'money', 'money', 'money', 'money'],
    rows: rows
  };
}

/** 4. План-факт по всем показателям. */
function repPlanFact(planIdx, workCalc, factIdx, koshtPlan, koshtFact) {
  var items = [
    ['Счёт поставщика, грн', 'bill', 'money'],
    ['в т.ч. сверхлимит, грн', 'ol', 'money'],
    ['Газ, тыс. м³', 'gas', 'num4'],
    ['Норматив, Гкал', 'norm', 'num3'],
    ['Гкал по кв. счётчикам', 'gkMeter', 'num3'],
    ['Цена Гкал по счётчику, грн', 'price', 'tariff'],
    ['Тариф без счётчика, грн/м²', 'tNo', 'tariff'],
    ['Тариф СПЧ, грн/м²', 'tSpch', 'tariff'],
    ['Начислено газ, грн', 'charged', 'money'],
    ['Сверхлимит начислен в тарифах, грн', 'olCharged', 'money']
  ];
  var rows = [];
  var formats = ['text', 'text', 'text', 'text', 'x', 'x', 'x', 'pct'];
  var fm = [];
  workCalc.forEach(function (w) {
    var p = planIdx[repKey(w)] || {};
    var isFact = repHasFact(factIdx[repKey(w)]);
    var boilerItems = [['Содержание котельной, грн/м²', repKoshtTariff(koshtPlan, w.zk) * koshtMonthShare(w.monthIdx, repKoshtMonths(koshtPlan, w.zk)),
      repKoshtTariff(koshtFact, w.zk) * koshtMonthShare(w.monthIdx, repKoshtMonths(koshtFact, w.zk)), 'tariff']];
    items.map(function (it) { return [it[0], engineNum(p[it[1]]), engineNum(w[it[1]]), it[2]]; })
      .concat(boilerItems)
      .forEach(function (it) {
        var plan = it[1], fact = it[2];
        rows.push([w.month, w.zk, it[0], isFact ? 'факт' : 'нет факта', plan, isFact ? fact : '',
          isFact ? fact - plan : '', isFact && plan !== 0 ? (fact - plan) / Math.abs(plan) : '']);
        fm.push(it[3]);
      });
  });
  return {
    id: 'planfact', title: 'План-факт', note: 'План — данные и кошторис, зафиксированные при утверждении приказа. Факт — введённые счета и последняя загрузка сметы.',
    headers: ['Месяц', 'ЖК', 'Показатель', 'Факт введён', 'План', 'Факт', 'Отклонение', 'Отклонение, %'],
    formats: formats, rowFormats: fm, rows: rows
  };
}

/** 5. Детали расчёта (ключевые промежуточные величины). */
function repDetails(calc) {
  return {
    id: 'details', title: 'Детали расчёта', note: 'Промежуточные величины методики v4 (как лист ДЕТАЛИ РАСЧЁТА).',
    headers: ['Месяц', 'ЖК', 'Данные', 'Счёт, грн', 'Сверхлимит факт, грн', 'Норматив, Гкал', 'Источник норматива',
      'Гкал по кв. счётчикам', 'Объём без счётчиков + СПЧ, Гкал', 'ФСО+МЗК итог, Гкал', 'Надбавка μ, грн/Гкал',
      'Пул на без счётчиков, грн', 'Затраты без сч. до сглаживания, грн', 't0, грн/м²', 'Вес месяца', 'Λ, грн/м²',
      'Добавка сглаживания, грн', 'Цена Гкал, грн', 'Тариф без сч., грн/м²', 'Тариф СПЧ, грн/м²', 'Начислено, грн',
      'Расхождение, грн', 'Допуск, грн', 'Удельный без сч. / со сч.', 'Статус'],
    formats: ['text', 'text', 'text', 'money', 'money', 'num3', 'text', 'num4', 'num4', 'num4', 'money', 'money', 'money',
      'num4', 'num3', 'num4', 'money', 'tariff', 'tariff', 'tariff', 'money', 'money', 'money', 'num3', 'text'],
    rows: calc.map(function (r) {
      return [r.month, r.zk, r.source || 'план', r.bill, r.ol, r.norm, r.normSrc, r.gkMeter, r.volNo, r.fsoMzkVol, r.mu,
        r.pool, r.costNo, r.t0, r.weight, r.lambda, r.addSmooth, r.price, r.tNo, r.tSpch, r.charged, r.diff, r.tol,
        r.ratio === null ? '' : r.ratio, r.status2];
    })
  };
}

/** Таблица кошториса одного ЖК для отчёта / Excel. */
function repKoshtTable(zk, k) {
  var rows = k.articles.map(function (a) {
    return [a.num, a.title, a.perM2, a.perMonth, a.season].concat(a.monthly);
  });
  rows.push(['', 'Всього, без ПДВ', k.perM2.net, k.perMonth.net, k.season.net].concat(k.net));
  rows.push(['', 'ПДВ 20 %', k.perM2.vat, k.perMonth.vat, k.season.vat].concat(k.vat));
  rows.push(['', 'Всього з ПДВ', k.perM2.gross, k.perMonth.gross, k.season.gross].concat(k.gross));
  return {
    id: 'kosht_' + zk, title: 'Кошторис котельні — ' + zk,
    note: 'Площадь ' + k.area + ' м² · ' + k.months + ' міс. · тариф ' + k.tariff + ' грн/м² на місяць (у т.ч. ПДВ ' +
      k.tariffVat + '), листопад — 50 %.',
    headers: ['№', 'Стаття витрат', 'грн/м² на місяць', 'грн на місяць', 'грн за сезон'].concat(
      ['листопад', 'грудень', 'січень', 'лютий', 'березень']),
    formats: ['text', 'text', 'tariff', 'money', 'money', 'money', 'money', 'money', 'money', 'money'],
    rows: rows
  };
}

/** Отчёты, в которых под каждым ЖК выводится строка «Итого». */
var REP_SUBTOTAL_IDS = ['tariffs', 'accrual', 'overlimit'];

/**
 * Строки «Итого» под каждым ЖК и общий итог. Деньги и объёмы суммируются; тарифы, цены и проценты — нет;
 * колонки «нараст.», «Накоплено», «Остаток», «Осталось» берутся по последнему месяцу ЖК.
 * Возвращает копию таблицы; индексы итоговых строк — в totalIdx.
 */
function repWithSubtotals(t) {
  var zkCol = t.headers.indexOf('ЖК');
  if (zkCol < 0 || !t.rows.length) return t;
  var sumFmt = ['money', 'num3', 'num4'];
  var lastOnly = /нараст|Накоплено|Остаток|Осталось/;
  var total = function (rows, label, zk) {
    var out = t.headers.map(function () { return ''; });
    out[0] = label;
    out[zkCol] = zk;
    t.headers.forEach(function (hd, c) {
      if (c === 0 || c === zkCol || sumFmt.indexOf(t.formats[c]) < 0) return;
      var nums = rows.map(function (r) { return r[c]; }).filter(function (v) { return typeof v === 'number'; });
      if (!nums.length) return;
      out[c] = lastOnly.test(hd) ? nums[nums.length - 1] : nums.reduce(function (s, x) { return s + x; }, 0);
    });
    return out;
  };
  var rows = [], totalIdx = [], groups = [], cur = null;
  t.rows.forEach(function (r) {
    if (!cur || cur.zk !== r[zkCol]) { cur = { zk: r[zkCol], rows: [] }; groups.push(cur); }
    cur.rows.push(r);
  });
  groups.forEach(function (g) {
    g.rows.forEach(function (r) { rows.push(r); });
    if (g.rows.length > 1) { totalIdx.push(rows.length); rows.push(total(g.rows, 'Итого', g.zk)); }
  });
  if (groups.length > 1) {
    totalIdx.push(rows.length);
    // общий итог: суммы по всем строкам; «нараст.» — сумма последних значений ЖК
    var lastRows = groups.map(function (g) { return g.rows[g.rows.length - 1]; });
    var all = total(t.rows, 'Итого по всем ЖК', '');
    t.headers.forEach(function (hd, c) {
      if (lastOnly.test(hd) && sumFmt.indexOf(t.formats[c]) >= 0) {
        var nums = lastRows.map(function (r) { return r[c]; }).filter(function (v) { return typeof v === 'number'; });
        all[c] = nums.length ? nums.reduce(function (s, x) { return s + x; }, 0) : '';
      }
    });
    rows.push(all);
  }
  var copy = {};
  Object.keys(t).forEach(function (k) { copy[k] = t[k]; });
  copy.rows = rows;
  copy.totalIdx = totalIdx;
  return copy;
}

/**
 * Итоги план-факта: по каждому ЖК и показателю — сумма за сезон. План — за все месяцы, факт — за месяцы с фактом,
 * отклонение — факт минус план тех же месяцев. Тарифы и цены (грн/м², грн/Гкал) не суммируются.
 */
function repPlanFactTotals(t) {
  if (!t.rows.length) return t;
  var srcFm = t.rowFormats || t.rows.map(function () { return 'money'; });
  // блоки подряд идущих строк одного ЖК; итоги по показателям — сразу под блоком ЖК
  var blocks = [], cur = null;
  t.rows.forEach(function (r, i) {
    if (!cur || cur.zk !== r[1]) { cur = { zk: r[1], idx: [] }; blocks.push(cur); }
    cur.idx.push(i);
  });
  var rows = [], fm = [], totalIdx = [];
  blocks.forEach(function (b) {
    var groups = [], gi = {};
    b.idx.forEach(function (i) {
      var r = t.rows[i], f = srcFm[i];
      rows.push(r);
      fm.push(f);
      if (f === 'tariff') return;
      if (!gi[r[2]]) { gi[r[2]] = { item: r[2], fmt: f, n: 0, plan: 0, fact: 0, planFact: 0, nFact: 0 }; groups.push(gi[r[2]]); }
      var g = gi[r[2]];
      g.n++;
      g.plan += engineNum(r[4]);
      if (r[3] === 'факт') { g.fact += engineNum(r[5]); g.planFact += engineNum(r[4]); g.nFact++; }
    });
    groups.forEach(function (g) {
      if (g.n < 2) return;
      totalIdx.push(rows.length);
      var dev = g.nFact ? g.fact - g.planFact : '';
      rows.push(['Итого', b.zk, g.item, g.nFact ? 'факт: ' + g.nFact + ' мес.' : 'нет факта', g.plan, g.nFact ? g.fact : '',
        dev, g.nFact && g.planFact !== 0 ? dev / Math.abs(g.planFact) : '']);
      fm.push(g.fmt);
    });
  });
  var copy = {};
  Object.keys(t).forEach(function (k) { copy[k] = t[k]; });
  copy.rows = rows;
  copy.rowFormats = fm;
  copy.totalIdx = totalIdx;
  copy.note = t.note + ' Итого: план — за все месяцы, факт — за месяцы с фактом, отклонение — от плана тех же месяцев; тарифы не суммируются.';
  return copy;
}
