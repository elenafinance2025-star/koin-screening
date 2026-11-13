/**
 * Кошторис содержания котельной (Додаток 1 к приказу).
 * Статьи собираются из помесячных колонок «факт» сезонной сметы ЖК (файл «Отопление сезон 2026/27.xlsx»)
 * по таблице соответствия: статья ← строки сметы × множитель. Множитель 5/6 убирает НДС из счетов
 * поставщиков, НДС 20 % начисляется сверху на итог без НДС. Логика повторяет «Кошторис Лимнос (25-26)».
 */

var KOSHT_ARTICLES = [
  { key: 'admin', title: 'Адміністративні витрати, всього', group: true, children: ['overhead', 'mgmt'] },
  { key: 'overhead', title: 'Накладні витрати', num: '1.1' },
  { key: 'mgmt', title: 'Послуги управління котельні', num: '1.2' },
  { key: 'oper', title: 'Експлуатаційні витрати, всього', group: true,
    children: ['service', 'utilities', 'routine', 'gasdist', 'startup', 'passive'] },
  { key: 'service', title: 'Технічне обслуговування котельні (ліцензіати)', num: '2.1' },
  { key: 'utilities', title: 'Споживання електроенергії та води для роботи котельні', num: '2.2' },
  { key: 'routine', title: 'Регламентні роботи (обслуговування котлів, насосного обладнання, автоматики)', num: '2.3' },
  { key: 'gasdist', title: 'Розподіл газу', num: '2.4' },
  { key: 'startup', title: 'Пусконалагоджувальні роботи', num: '2.5' },
  { key: 'passive', title: 'Пасивне теплове розподілення', num: '2.6' }
];

var KOSHT_VAT_FACTOR = 5 / 6;

/**
 * Соответствие по ЖК: лист сметы, колонка ноября (факт), ячейка площади, статьи → строки.
 * Строки налогов (НДС, ЕН) и газа/тепловой энергии в кошторис не входят.
 */
/** Номер строки «Адмін-накладні» в смете ЖК: множитель 1 (услуга УК без НДС), а не 5/6. */
var KOSHT_OVERHEAD_FEE_ROWS = { 'Лимнос': 14, 'Атлант': 14, 'Лузановский Парк': 15, 'Гавайи': 13 };

/**
 * Гавайи: смета переработана на НДС — добавлена строка «Налог на прибыль 1 %» (14), строки ниже сдвинулись на 1.
 * Меняет сохранённую таблицу, только если в ней прежняя схема (1 % от стр. 14–15, услуги в стр. 21–22). Возвращает true, если менялось.
 */
function koshtFixHawaiiVat(mapping) {
  var m = mapping && mapping['Гавайи'];
  if (!m || !m.rows) return false;
  var v = Math.round(KOSHT_VAT_FACTOR * 1e6) / 1e6;
  if (!koshtSameRows(m.rows.overhead, [[14, 0.01], [15, 0.01]]) || !koshtSameRows(m.rows.service, [[21, v], [22, v]])) return false;
  m.rows.overhead = [[14, 1]];
  m.rows.service = [[22, KOSHT_VAT_FACTOR], [23, KOSHT_VAT_FACTOR]];
  return true;
}

function koshtSameRows(a, b) {
  return JSON.stringify((a || []).map(function (p) { return [p[0], Math.round(p[1] * 1e6) / 1e6]; })) === JSON.stringify(b);
}

/**
 * Лузановский Парк: смета переработана на НДС — после «Газ:» добавлена строка «налог на прибыль 1 %» (24),
 * газ, распределение газа и услуги сдвинулись на 1. Меняет сохранённую таблицу, только если в ней прежняя схема.
 */
function koshtFixLpVat(mapping) {
  var m = mapping && mapping['Лузановский Парк'];
  if (!m || !m.rows) return false;
  var v = Math.round(KOSHT_VAT_FACTOR * 1e6) / 1e6;
  if (!koshtSameRows(m.rows.overhead, [[24, 0.01], [25, 0.01]]) || !koshtSameRows(m.rows.gasdist, [[26, v]])) return false;
  m.rows.overhead = [[24, 1]];
  m.rows.gasdist = [[27, KOSHT_VAT_FACTOR]];
  m.rows.service = (m.rows.service || []).map(function (p) { return [p[0] + 1, p[1]]; });
  return true;
}

/** Исправляет сохранённую таблицу соответствия: строка накладных с множителем 5/6 → 1. Возвращает true, если менялось. */
function koshtFixOverheadFee(mapping) {
  var changed = false;
  Object.keys(KOSHT_OVERHEAD_FEE_ROWS).forEach(function (zk) {
    var m = mapping && mapping[zk];
    if (!m || !m.rows) return;
    Object.keys(m.rows).forEach(function (k) {
      (m.rows[k] || []).forEach(function (pair) {
        if (pair[0] === KOSHT_OVERHEAD_FEE_ROWS[zk] && Math.abs(pair[1] - KOSHT_VAT_FACTOR) < 1e-9) { pair[1] = 1; changed = true; }
      });
    });
  });
  return changed;
}

function koshtDefaultMapping() {
  var v = KOSHT_VAT_FACTOR;
  return {
    'Лимнос': {
      sheet: 'Лимнос26-27', novCol: 'Q', areaCell: 'Q2', months: 4.5,
      rows: {
        overhead: [[23, 1]],                       // налог на прибыль 1 %
        mgmt: [[8, 1], [10, 1], [12, 1]],          // ответственный, операторы, ЕСВ
        service: [[29, v], [30, v], [31, v], [32, v], [33, v], [34, v], [35, v], [36, v], [37, v]],
        utilities: [[17, v], [18, v], [20, v]],
        routine: [],
        gasdist: [[27, v]],
        startup: [],
        passive: [[14, 1]]                         // админ.-накладные 6 % (услуга УК, без НДС — НДС сверху)
      }
    },
    'Атлант': {
      sheet: 'Атлант26-27', novCol: 'Q', areaCell: 'Q2', months: 4.5,
      rows: {
        overhead: [[22, 1]],
        mgmt: [[8, 1], [10, 1], [12, 1]],
        service: [[27, v], [28, v], [29, v], [30, v], [31, v], [32, v]],
        utilities: [[17, v], [19, v]],
        routine: [],
        gasdist: [[25, v]],
        startup: [],
        passive: [[14, 1]]                         // админ.-накладные 6 %
      }
    },
    'Лузановский Парк': {
      sheet: 'ЛП 26-27', novCol: 'Q', areaCell: 'Q3', months: 5,
      rows: {
        // Смета 2026/27 переработана на НДС (13.11.2026): стр. 14 «Налоги, НДС» не берём (НДС 20 % сверху),
        // стр. 24 — налог на прибыль 1 %, стр. 25–26 — газ (в кошторис не входит)
        overhead: [[24, 1]],
        mgmt: [[9, 1], [11, 1], [13, 1]],
        service: [[29, v], [30, v], [31, v], [32, v], [33, v], [34, v], [35, v], [36, v], [37, v]],
        utilities: [[18, v], [19, v], [21, v]],
        routine: [],
        gasdist: [[27, v]],
        startup: [],
        passive: [[15, 1]]                         // админ.-накладные 6 %
      }
    },
    'Гавайи': {
      sheet: 'Гавайи26-27', novCol: 'J', areaCell: 'J3', months: 4.5,
      rows: {
        // Смета 2026/27 переработана на НДС (13.11.2026): стр. 12 «Налоги НДС» не берём (НДС 20 % сверху),
        // стр. 14 — налог на прибыль 1 %, стр. 15–16 — тепловая энергия и перерасчёт (в кошторис не входят)
        overhead: [[14, 1]],                       // налог на прибыль 1 %
        mgmt: [[8, 1], [11, 1]],                   // инженер-теплотехник, ЕСВ
        service: [[22, v], [23, v]],               // Південна теплова компанія, корп. 1 и 2
        utilities: [[10, v]],                      // электроснабжение теплопунктов
        routine: [],
        gasdist: [],
        startup: [],
        passive: [[13, 1]]                         // админ.-накладные 2 %
      }
    }
  };
}

/**
 * Расчёт кошториса.
 * smeta: { 'номер строки': [ноя, дек, янв, фев, мар] } — значения колонок «факт» сметы;
 * map: элемент koshtDefaultMapping(); area: м²; manual: { overhead: [5], ... } — ручные добавки (например, «фонарь»).
 */
function koshtCompute(smeta, map, area, manual, vatRate) {
  vatRate = vatRate === undefined ? 0.2 : vatRate;
  manual = manual || {};
  var months = map.months || 4.5;
  var lines = {};
  KOSHT_ARTICLES.forEach(function (a) {
    if (a.group) return;
    var m = [0, 0, 0, 0, 0];
    (map.rows[a.key] || []).forEach(function (pair) {
      var vals = smeta[String(pair[0])] || [];
      for (var i = 0; i < 5; i++) m[i] += engineNum(vals[i]) * pair[1];
    });
    var add = manual[a.key] || [];
    for (var j = 0; j < 5; j++) m[j] += engineNum(add[j]);
    lines[a.key] = m;
  });
  KOSHT_ARTICLES.forEach(function (a) {
    if (!a.group) return;
    var m = [0, 0, 0, 0, 0];
    a.children.forEach(function (k) { for (var i = 0; i < 5; i++) m[i] += lines[k][i]; });
    lines[a.key] = m;
  });
  var net = [0, 0, 0, 0, 0];
  ['admin', 'oper'].forEach(function (k) { for (var i = 0; i < 5; i++) net[i] += lines[k][i]; });
  var vat = net.map(function (x) { return x * vatRate; });
  var gross = net.map(function (x, i) { return x + vat[i]; });
  var sum = function (arr) { return arr.reduce(function (s, x) { return s + x; }, 0); };
  var season = { net: sum(net), vat: sum(vat), gross: sum(gross) };
  // Единый тариф на сезон: смета с НДС за сезон ÷ площадь ÷ число месяцев начисления (ноябрь — половина)
  var tariff = area > 0 ? engineRound(season.gross / area / months, 2) : 0;
  var tariffVat = engineRound(tariff * vatRate / (1 + vatRate), 2);
  var articles = KOSHT_ARTICLES.map(function (a) {
    var s = sum(lines[a.key]);
    return {
      key: a.key, num: a.num || '', title: a.title, group: !!a.group, monthly: lines[a.key], season: s,
      perMonth: s / months, perM2: area > 0 ? s / area / months : 0
    };
  });
  return {
    articles: articles, net: net, vat: vat, gross: gross, season: season, area: area, months: months,
    tariff: tariff, tariffVat: tariffVat,
    perMonth: { net: season.net / months, vat: season.vat / months, gross: season.gross / months },
    perM2: area > 0 ? { net: season.net / area / months, vat: season.vat / area / months, gross: season.gross / area / months } :
      { net: 0, vat: 0, gross: 0 }
  };
}

/** Доля месяца в начислении содержания котельной: ноябрь — с 15-го, половина. */
/** Доля тарифа котельной в месяце: ноябрь = число месяцев начисления − 4 (4,5 → 50 %, 5 → 100 %), остальные — 100 %. */
function koshtMonthShare(monthIdx, months) {
  var m = engineNum(months) || 4.5;
  return monthIdx === 0 ? Math.max(0, Math.min(1, m - 4)) : 1;
}

/** Подпись ноября для приказа и подсказок. */
function koshtNovNote(months) {
  var share = koshtMonthShare(0, months);
  return share >= 1 ? 'листопад — повний місяць' : 'за листопад — ' + Math.round(share * 100) + ' % тарифу';
}
