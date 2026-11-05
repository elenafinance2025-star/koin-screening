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
  var planCalc = repSortRows(engineCompute(ctx.plan, S, {}, {}));
  var work = repMerge(ctx.plan, ctx.fact);
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
      repDetails(workCalc)
    ]
  };
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
      var kt = repKoshtTariff(koshtFact, r.zk) * koshtMonthShare(r.monthIdx);
      return [r.month, r.receipt, r.zk, r.source || 'план', r.bill, engineRound(kt, 2), r.price, r.tNo, r.tSpch,
        r.charged, r.diff, r.status2];
    })
  };
}

/** 2. Отчёт по начислению: содержание котельной и газ, план / факт / отклонение. */
function repAccrual(planCalc, workCalc, factIdx, koshtPlan, koshtFact) {
  var pIdx = repIndex(planCalc);
  var reserveAcc = {}, reservePlanAcc = {};
  var rows = workCalc.map(function (w) {
    var p = pIdx[repKey(w)] || {};
    var isFact = repHasFact(factIdx[repKey(w)]);
    // Запас = начислено жильцам по газовым тарифам − счёт поставщика (плюс — собрано больше счёта, минус — меньше)
    var reservePlan = engineNum(p.charged) - engineNum(p.bill);
    var reserveFact = isFact ? w.charged - w.bill : '';
    reservePlanAcc[w.zk] = (reservePlanAcc[w.zk] || 0) + reservePlan;
    if (isFact) reserveAcc[w.zk] = (reserveAcc[w.zk] || 0) + reserveFact;
    var share = koshtMonthShare(w.monthIdx);
    var boilerPlan = repKoshtTariff(koshtPlan, w.zk) * share * repKoshtArea(koshtPlan, w.zk);
    var boilerFact = repKoshtTariff(koshtFact, w.zk) * share * repKoshtArea(koshtFact, w.zk);
    var f = function (v) { return isFact ? v : ''; };
    var d = function (a, b) { return isFact ? a - b : ''; };
    return [w.month, w.zk,
      boilerPlan, isFact ? boilerFact : '', d(boilerFact, boilerPlan),
      engineNum(p.gas), f(w.gas), d(w.gas, engineNum(p.gas)),
      engineNum(p.norm), f(w.norm), d(w.norm, engineNum(p.norm)),
      engineNum(p.bill), f(w.bill), d(w.bill, engineNum(p.bill)),
      engineNum(p.charged), f(w.charged), d(w.charged, engineNum(p.charged)),
      reservePlan, reservePlanAcc[w.zk], reserveFact, isFact ? reserveAcc[w.zk] : ''];
  });
  return {
    id: 'accrual', title: 'Начисление: содержание котельной и расход газа (план / факт)',
    note: 'Котельная: тариф кошториса × площадь × доля месяца (ноябрь — 50 %). Газ: объём, норматив, счёт поставщика и начислено по газовым тарифам. Факт показывается только для месяцев с введёнными счетами.',
    headers: ['Месяц', 'ЖК',
      'Котельная план, грн', 'Котельная факт, грн', 'Котельная Δ, грн',
      'Газ план, тыс. м³', 'Газ факт, тыс. м³', 'Газ Δ, тыс. м³',
      'Норматив план, Гкал', 'Норматив факт, Гкал', 'Норматив Δ, Гкал',
      'Счёт план, грн', 'Счёт факт, грн', 'Счёт Δ, грн',
      'Начислено газ план, грн', 'Начислено газ факт, грн', 'Начислено газ Δ, грн',
      'ЗАПАС план, грн', 'ЗАПАС план нараст., грн', 'ЗАПАС факт, грн', 'ЗАПАС факт нараст., грн'],
    formats: ['text', 'text', 'money', 'money', 'money', 'num4', 'num4', 'num4', 'num3', 'num3', 'num3',
      'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money'],
    rows: rows
  };
}

/** 3. Сверхлимит: в счетах и начислено в тарифах, помесячно и нарастающим итогом. */
function repOverlimit(planIdx, workCalc, factIdx) {
  var acc = {};
  var rows = workCalc.map(function (w) {
    var a = acc[w.zk] = acc[w.zk] || { billPlan: 0, chargedPlan: 0, bill: 0, charged: 0 };
    var p = planIdx[repKey(w)] || {};
    a.billPlan += engineNum(p.ol);
    a.chargedPlan += engineNum(p.olCharged);
    a.bill += w.ol;
    a.charged += w.olCharged;
    var season = w.olSeason;
    return [w.month, w.zk, w.source || 'план',
      engineNum(p.ol), engineNum(p.olCharged), a.billPlan, a.chargedPlan,
      w.ol, w.olCharged, a.bill, a.charged, season - a.charged];
  });
  return {
    id: 'overlimit', title: 'Сверхлимит газа: выставлено в счетах и начислено в тарифах',
    note: 'Начислено в тарифах = надбавка μ × Гкал по счётчикам + добавка сглаживания на квартиры без счётчиков и СПЧ. «Осталось разнести» = сверхлимит сезона − начислено нарастающим итогом.',
    headers: ['Месяц', 'ЖК', 'Данные',
      'План: в счёте, грн', 'План: начислено в тарифах, грн', 'План: в счетах нараст., грн', 'План: начислено нараст., грн',
      'Рабочие: в счёте, грн', 'Рабочие: начислено в тарифах, грн', 'Рабочие: в счетах нараст., грн',
      'Рабочие: начислено нараст., грн', 'Осталось разнести, грн'],
    formats: ['text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money'],
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
    var share = koshtMonthShare(w.monthIdx);
    var boilerItems = [['Содержание котельной, грн/м²', repKoshtTariff(koshtPlan, w.zk) * share,
      repKoshtTariff(koshtFact, w.zk) * share, 'tariff']];
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
