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
        passive: [[14, v]]                         // админ.-накладные 6 %
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
        passive: [[14, v]]
      }
    },
    'Лузановский Парк': {
      sheet: 'ЛП 26-27', novCol: 'Q', areaCell: 'Q3', months: 4.5,
      rows: {
        // Смета ещё на едином налоге: строку «Налоги, ЕН 6 %» (14) не берём, налог на прибыль 1 % считаем
        // как у Лимноса и Атланта — от газа (стр. 24 и сверхлимит 25); НДС 20 % начисляется сверху
        overhead: [[24, 0.01], [25, 0.01]],
        mgmt: [[9, 1], [11, 1], [13, 1]],
        service: [[28, v], [29, v], [30, v], [31, v], [32, v], [33, v], [34, v], [35, v], [36, v]],
        utilities: [[18, v], [19, v], [21, v]],
        routine: [],
        gasdist: [[26, v]],
        startup: [],
        passive: [[15, v]]
      }
    },
    'Гавайи': {
      sheet: 'Гавайи26-27', novCol: 'J', areaCell: 'J3', months: 4.5,
      rows: {
        // Смета ещё на едином налоге: строку «Налоги ЕН» (12) не берём, налог на прибыль 1 % — от тепловой
        // энергии (стр. 14 и перерасчёт 15); НДС 20 % начисляется сверху
        overhead: [[14, 0.01], [15, 0.01]],
        mgmt: [[8, 1], [11, 1]],                   // инженер-теплотехник, ЕСВ
        service: [[21, v], [22, v]],               // Південна теплова компанія
        utilities: [[10, v]],                      // электроснабжение теплопунктов
        routine: [],
        gasdist: [],
        startup: [],
        passive: [[13, v]]                         // админ.-накладные 2 %
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
function koshtMonthShare(monthIdx) {
  return monthIdx === 0 ? 0.5 : 1;
}
