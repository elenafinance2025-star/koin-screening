/**
 * КОІН — отчёт по начислению отопления, сезон 2026/27.
 *
 * Меню «КОІН → Отопление»:
 *   1. Создать / обновить листы
 *   2. Пересчитать отчёт
 *   3. Проверить настройки
 *   4. Пересоздать листы заново
 *
 * Все адреса строк, коэффициенты и режимы берутся с листа НАСТРОЙКИ.
 * В коде нет шаблонных строк с обратными кавычками, поэтому он переживает копирование из Word.
 */

var KOIN_HEAT_VERSION = 4;
var KOIN_META_KEY = 'koin_heat_version';

var SHEET_SETTINGS = 'НАСТРОЙКИ';
var SHEET_INPUT = 'ВВОД';
var SHEET_REPORT = 'ОТЧЁТ';
var SHEET_DETAILS = 'ДЕТАЛИ РАСЧЁТА';
var ARCHIVE_SUFFIX = '_старые';

var SEASON_MONTHS = ['Ноябрь', 'Декабрь', 'Январь', 'Февраль', 'Март'];
var YEAR_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

var MODE_PROFILE = 'профиль квитанции';
var MODE_SUMS = 'суммы по месяцам';
var MODE_WEIGHTS = 'веса добавки';
var MODES = [MODE_PROFILE, MODE_SUMS, MODE_WEIGHTS];
var TYPE_MIXED = 'смешанный';
var TYPE_AREA = 'по м²';
var FSO_BY_GAS = 'пропорционально газу';
var FSO_COMMON = 'в содержание котельной';
var STATUS_OK = '✓ сходится';

var COLOR_INPUT_BG = '#fff2cc';
var COLOR_INPUT_FONT = '#1155cc';
var COLOR_HEADER_BG = '#d9d9d9';
var COLOR_ERROR_BG = '#f4cccc';
var COLOR_ERROR_FONT = '#cc0000';

// ---------- ВВОД ----------
var INPUT_HEADER_ROW = 3;
var INPUT_ROWS = 300;
var INPUT_HEADERS = [
  'Месяц потребления',
  'ЖК',
  'Счёт поставщика, грн',
  'в т.ч. сверхлимит в счёте, грн',
  'Объём газа, м³',
  'Гкал по общедомовому счётчику',
  'Площадь отапливаемая итого, м²',
  'Площадь со счётчиками, м²',
  'Площадь СПЧ (отключённые), м²',
  'Площадь без счётчиков, м²',
  'Гкал по квартирным счётчикам',
  'Примечание'
];
var IN = {
  MONTH: 0, OBJ: 1, BILL: 2, OL: 3, GAS: 4, GKAL_HOUSE: 5, AREA_TOTAL: 6,
  AREA_METER: 7, AREA_SPCH: 8, AREA_NO: 9, GKAL_METER: 10, NOTE: 11
};

// ---------- ОТЧЁТ ----------
var REPORT_HEADER_ROW = 3;
var REPORT_HEADERS = [
  'Месяц потребления',
  'Месяц квитанции',
  'ЖК',
  'Счёт поставщика, грн',
  'СОДЕРЖАНИЕ КОТЕЛЬНОЙ, грн/м² (все)',
  'ГАЗ по счётчику, грн/Гкал',
  'ГАЗ без счётчика, грн/м²',
  'ГАЗ СПЧ, грн/м²',
  'Расчётно начислено, грн',
  'Расхождение, грн',
  'Статус'
];

// ---------- ДЕТАЛИ РАСЧЁТА ----------
var DETAILS_HEADER_ROW = 3;
var DETAILS_HEADERS = [
  'Месяц потребления',
  'ЖК',
  'Сверхлимит факт, грн',
  'Сверхлимит отнесённый, грн',
  'База, грн',
  'Норматив, Гкал',
  'Источник норматива',
  'ФСО+МЗК, грн',
  'ФСО+МЗК, грн/м²',
  'Содержание из сметы, грн/м²',
  'Цена 1 Гкал, грн',
  'Остаток Гкал',
  'Тариф без счётчика, грн/м²',
  'Тариф СПЧ, грн/м²',
  'Начислено, грн',
  'Расхождение, грн',
  'Допуск, грн',
  'Статус'
];

// ---------- НАСТРОЙКИ ----------
var SETTINGS_WIDTH = 7;
var OBJ_HEADERS = [
  'ЖК',
  'Лист-источник',
  'Строка «Содержание котельной»',
  'Колонка ноября (факт)',
  'Тип учёта',
  'Сверхлимит на сезон (план), грн',
  'Активен'
];
var OBJ_SLOTS = 10;
var DEFAULT_OBJECTS = [
  ['Лимнос', 'Лимнос26-27', 42, 'Q', TYPE_MIXED, 0, 'Да'],
  ['Атлант', 'Атлант26-27', 37, 'Q', TYPE_MIXED, 0, 'Да'],
  ['ЛП', 'ЛП 26-27', 42, 'Q', TYPE_AREA, 0, 'Да'],
  ['Гавайи', 'Гавайи26-27', 26, 'J', TYPE_MIXED, 0, 'Да'],
  ['РЮ МЕНАР', 'Рюменар', '', 'Q', TYPE_MIXED, 0, 'Да']
];
var SECTION_OBJECTS = '1. Объекты';
var SECTION_PROFILE = '2. Сверхлимит: профиль по месяцам';
var SECTION_PARAMS = '3. Параметры расчёта';
var PROFILE_WEIGHTS_LABEL = 'веса профиля квитанции';
var PROFILE_SUMS_LABEL = 'суммы сверхлимита по месяцам, грн (для режима «суммы по месяцам»)';
var DEFAULT_WEIGHTS = [0.6, 1, 1, 1, 0.9];
var DEFAULT_SUMS = [0, 0, 0, 0, 0];

var PARAMS = [
  { key: 'mode', label: 'Режим сглаживания сверхлимита', def: MODE_PROFILE, list: MODES,
    note: '«профиль квитанции» · «суммы по месяцам» · «веса добавки»' },
  { key: 'kcal', label: 'Коэффициент калорийности газа, Гкал/м³', def: 0.008364,
    note: 'Норматив = объём газа × коэффициент' },
  { key: 'fso', label: 'ФСО, доля от базы', def: 0.05,
    note: 'Функционирование системы отопления — на всю площадь' },
  { key: 'mzk', label: 'МЗК, доля от базы', def: 0.10,
    note: 'Места общего пользования — на всю площадь' },
  { key: 'kSpch', label: 'Коэффициент для СПЧ (отключённые)', def: 0.5,
    note: 'Доля от тарифа без счётчика за газ' },
  { key: 'digitsArea', label: 'Округление тарифов за м², знаков', def: 2, note: '' },
  { key: 'digitsPrice', label: 'Округление цены за Гкал, знаков', def: 2, note: '' },
  { key: 'lag', label: 'Лаг начисления, месяцев', def: 1,
    note: 'Счёт за ноябрь приходит в декабре → тариф ноября идёт в декабрьскую квитанцию' },
  { key: 'tol', label: 'Допустимое расхождение контроля, грн', def: 5,
    note: 'Плюс половина последнего знака округления на каждый м² и Гкал' },
  { key: 'trueUp', label: 'Доводить сверхлимит в последнем месяце', def: 'Да', list: ['Да', 'Нет'],
    note: 'Когда введён март: март = факт сверхлимита сезона − разнесённое в предыдущих месяцах' },
  { key: 'fsoMode', label: 'Распределение ФСО+МЗК', def: FSO_BY_GAS, list: [FSO_BY_GAS, FSO_COMMON],
    note: '«пропорционально газу» — входит в цену Гкал и тарифы без счётчика / СПЧ; «в содержание котельной» — на все м²' },
  { key: 'tolArea', label: 'Допуск сверки площадей, м²', def: 0.5,
    note: 'Со счётчиками + СПЧ + без счётчиков = итого' }
];

// =====================================================================
// Меню
// =====================================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('КОІН')
    .addSubMenu(ui.createMenu('Отопление')
      .addItem('1. Создать / обновить листы', 'menuCreateSheets')
      .addItem('2. Пересчитать отчёт', 'recalcReport')
      .addItem('3. Проверить настройки', 'checkSettings')
      .addSeparator()
      .addItem('4. Пересоздать листы заново', 'menuRebuildSheets'))
    .addToUi();
}

function menuCreateSheets() {
  var log = ensureAllSheets_(false);
  SpreadsheetApp.getUi().alert('Листы отопления (версия ' + KOIN_HEAT_VERSION + ')\n\n' + log.join('\n'));
}

function menuRebuildSheets() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Пересоздать листы заново?',
    'Текущие листы ' + SHEET_SETTINGS + ', ' + SHEET_INPUT + ', ' + SHEET_REPORT + ', ' + SHEET_DETAILS +
    ' будут переименованы в «…' + ARCHIVE_SUFFIX + '» и созданы заново. ' +
    'Параметры настроек переносятся по названию, введённые данные ВВОДа — по названию колонок ' +
    '(только если лист создан этой версией скрипта).', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  var log = ensureAllSheets_(true);
  ui.alert('Готово\n\n' + log.join('\n'));
}

// =====================================================================
// Создание и миграция листов
// =====================================================================

function ensureAllSheets_(force) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = [];
  ensureSettingsSheet_(ss, force, log);
  ensureInputSheet_(ss, force, log);
  ensureOutputSheet_(ss, SHEET_REPORT, REPORT_HEADER_ROW, REPORT_HEADERS, force, log);
  ensureOutputSheet_(ss, SHEET_DETAILS, DETAILS_HEADER_ROW, DETAILS_HEADERS, force, log);
  return log;
}

function getSheetVersion_(sheet) {
  var meta = sheet.getDeveloperMetadata();
  for (var i = 0; i < meta.length; i++) {
    if (meta[i].getKey() === KOIN_META_KEY) return Number(meta[i].getValue()) || 0;
  }
  return 0;
}

function setSheetVersion_(sheet) {
  var meta = sheet.getDeveloperMetadata();
  for (var i = 0; i < meta.length; i++) {
    if (meta[i].getKey() === KOIN_META_KEY) meta[i].remove();
  }
  sheet.addDeveloperMetadata(KOIN_META_KEY, String(KOIN_HEAT_VERSION));
}

function headerMatches_(sheet, headerRow, headers) {
  if (sheet.getLastColumn() < headers.length || sheet.getLastRow() < headerRow) return false;
  var actual = sheet.getRange(headerRow, 1, 1, headers.length).getDisplayValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(actual[i]).trim() !== headers[i]) return false;
  }
  return true;
}

/** Переименовывает лист в «…_старые» (или «…_старые 2» и т.д.). Возвращает позицию листа. */
function archiveSheet_(ss, sheet, log) {
  var base = sheet.getName() + ARCHIVE_SUFFIX;
  var name = base;
  var n = 2;
  while (ss.getSheetByName(name)) {
    name = base + ' ' + n;
    n++;
  }
  var index = sheet.getIndex();
  sheet.setName(name);
  log.push('«' + base.replace(ARCHIVE_SUFFIX, '') + '»: старая версия сохранена как «' + name + '»');
  return index;
}

function createSheetAt_(ss, name, index) {
  if (index) return ss.insertSheet(name, index - 1);
  return ss.insertSheet(name);
}

// ---------- НАСТРОЙКИ ----------

function settingsIsCurrent_(sheet) {
  if (getSheetVersion_(sheet) !== KOIN_HEAT_VERSION) return false;
  var values = sheet.getDataRange().getValues();
  var parsed = parseSettingsValues_(values);
  if (!parsed.objectsHeaderFound || !parsed.weightsFound || !parsed.sumsFound) return false;
  for (var i = 0; i < PARAMS.length; i++) {
    if (!parsed.paramsFound[PARAMS[i].key]) return false;
  }
  return true;
}

function ensureSettingsSheet_(ss, force, log) {
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (sheet && !force && settingsIsCurrent_(sheet)) {
    log.push(SHEET_SETTINGS + ': актуален');
    return sheet;
  }
  var old = null;
  var index = null;
  if (sheet) {
    old = parseSettingsValues_(sheet.getDataRange().getValues());
    index = archiveSheet_(ss, sheet, log);
  }
  sheet = createSheetAt_(ss, SHEET_SETTINGS, index);
  writeSettingsSheet_(sheet, old);
  setSheetVersion_(sheet);
  log.push(SHEET_SETTINGS + ': создан' + (old ? ' (параметры перенесены по названию)' : ''));
  return sheet;
}

function writeSettingsSheet_(sheet, old) {
  var W = SETTINGS_WIDTH;
  var rows = [];
  var i;
  rows.push(fitRow_(['НАСТРОЙКИ ОТЧЁТА ПО ОТОПЛЕНИЮ (v' + KOIN_HEAT_VERSION + ')'], W));
  rows.push(fitRow_([SECTION_OBJECTS], W));
  rows.push(fitRow_(OBJ_HEADERS, W));
  var objectsFirstRow = rows.length + 1;
  var objects = old && old.objects.length ? old.objects.map(function (o) { return o.raw; }) : DEFAULT_OBJECTS;
  for (i = 0; i < Math.max(OBJ_SLOTS, objects.length); i++) {
    rows.push(fitRow_(objects[i] || [], W));
  }
  var objectsLastRow = rows.length;
  rows.push(fitRow_([], W));
  rows.push(fitRow_([SECTION_PROFILE], W));
  rows.push(fitRow_(['Строка'].concat(SEASON_MONTHS), W));
  var weightsRow = rows.length + 1;
  rows.push(fitRow_([PROFILE_WEIGHTS_LABEL].concat(old && old.weightsFound ? old.weights : DEFAULT_WEIGHTS), W));
  rows.push(fitRow_([PROFILE_SUMS_LABEL].concat(old && old.sumsFound ? old.sums : DEFAULT_SUMS), W));
  rows.push(fitRow_(['Профиль: во сколько раз квитанция месяца тяжелее ноябрьской. Скрипт подбирает доли ' +
    'сверхлимита так, чтобы итоговые базы месяцев легли по этому профилю. Месяцу, база которого уже выше ' +
    'целевой, добавка не начисляется.'], W));
  rows.push(fitRow_([], W));
  rows.push(fitRow_([SECTION_PARAMS], W));
  rows.push(fitRow_(['Параметр', 'Значение', 'Пояснение'], W));
  var paramsFirstRow = rows.length + 1;
  for (i = 0; i < PARAMS.length; i++) {
    var p = PARAMS[i];
    var value = old && old.paramsFound[p.key] ? old.paramsRaw[p.key] : p.def;
    rows.push(fitRow_([p.label, value, p.note], W));
  }

  sheet.getRange(1, 1, rows.length, W).setValues(rows);

  // Оформление
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  [2, weightsRow - 2, paramsFirstRow - 2].forEach(function (r) {
    sheet.getRange(r, 1).setFontWeight('bold').setFontSize(11);
  });
  [3, weightsRow - 1, paramsFirstRow - 1].forEach(function (r) {
    sheet.getRange(r, 1, 1, W).setFontWeight('bold').setBackground(COLOR_HEADER_BG).setWrap(true);
  });
  styleInput_(sheet.getRange(objectsFirstRow, 1, objectsLastRow - objectsFirstRow + 1, W));
  styleInput_(sheet.getRange(weightsRow, 2, 2, SEASON_MONTHS.length));
  styleInput_(sheet.getRange(paramsFirstRow, 2, PARAMS.length, 1));
  sheet.getRange(weightsRow + 2, 1, 1, W).merge().setWrap(true).setFontStyle('italic');
  sheet.setRowHeight(weightsRow + 2, 48);
  sheet.setColumnWidth(1, 330);
  sheet.setColumnWidths(2, W - 1, 140);
  sheet.setColumnWidth(3, 160);

  var objRows = objectsLastRow - objectsFirstRow + 1;
  sheet.getRange(objectsFirstRow, 5, objRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([TYPE_MIXED, TYPE_AREA], true).build());
  sheet.getRange(objectsFirstRow, 7, objRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Да', 'Нет'], true).build());
  sheet.getRange(objectsFirstRow, 6, objRows, 1).setNumberFormat('#,##0.00');
  for (i = 0; i < PARAMS.length; i++) {
    if (PARAMS[i].list) {
      sheet.getRange(paramsFirstRow + i, 2).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(PARAMS[i].list, true).build());
    }
  }
  sheet.setFrozenRows(1);
}

/**
 * Разбирает лист настроек (любой версии) в объект. Ищет блоки по подписям, а не по номерам строк,
 * поэтому годится и для миграции со старых листов.
 */
function parseSettingsValues_(values) {
  var res = {
    objects: [], objectsHeaderFound: false,
    weights: DEFAULT_WEIGHTS.slice(), weightsFound: false,
    sums: DEFAULT_SUMS.slice(), sumsFound: false,
    params: {}, paramsRaw: {}, paramsFound: {}
  };
  var labelToParam = {};
  PARAMS.forEach(function (p) { labelToParam[normLabel_(p.label)] = p; });

  var inObjects = false;
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var a = String(row[0] === null || row[0] === undefined ? '' : row[0]).trim();
    var b = String(row[1] === null || row[1] === undefined ? '' : row[1]).trim();

    if (a === OBJ_HEADERS[0] && b === OBJ_HEADERS[1]) {
      res.objectsHeaderFound = true;
      inObjects = true;
      continue;
    }
    if (inObjects) {
      if (/^\d+\.\s/.test(a)) {
        inObjects = false;
      } else {
        if (a !== '') {
          var raw = [];
          for (var c = 0; c < OBJ_HEADERS.length; c++) raw.push(row[c] === undefined ? '' : row[c]);
          res.objects.push(makeObject_(raw));
        }
        continue;
      }
    }
    var la = normLabel_(a);
    if (la.indexOf(normLabel_(PROFILE_WEIGHTS_LABEL)) === 0) {
      res.weights = SEASON_MONTHS.map(function (m, i) { return row[i + 1]; });
      res.weightsFound = true;
      continue;
    }
    if (la.indexOf('суммы сверхлимита') === 0) {
      res.sums = SEASON_MONTHS.map(function (m, i) { return row[i + 1]; });
      res.sumsFound = true;
      continue;
    }
    if (labelToParam[la]) {
      var p = labelToParam[la];
      res.paramsFound[p.key] = true;
      res.paramsRaw[p.key] = row[1];
      res.params[p.key] = row[1];
    }
  }
  return res;
}

function makeObject_(raw) {
  return {
    raw: raw,
    name: String(raw[0]).trim(),
    sheetName: String(raw[1]).trim(),
    row: raw[2],
    novCol: String(raw[3]).trim().toUpperCase(),
    type: String(raw[4]).trim(),
    plan: raw[5],
    active: String(raw[6]).trim().toLowerCase() !== 'нет'
  };
}

function normLabel_(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е').trim();
}

/** Читает НАСТРОЙКИ и проверяет значения. Бросает ошибку со списком проблем. */
function readSettings_(sheet) {
  var parsed = parseSettingsValues_(sheet.getDataRange().getValues());
  return validateSettings_(parsed);
}

function validateSettings_(parsed) {
  var errors = [];
  var cfg = { objects: [], objectByName: {}, weights: [], sums: [], params: {} };

  PARAMS.forEach(function (p) {
    var v = parsed.paramsFound[p.key] ? parsed.params[p.key] : p.def;
    if (p.list) {
      v = String(v).trim();
      var ok = false;
      for (var i = 0; i < p.list.length; i++) {
        if (normLabel_(p.list[i]) === normLabel_(v)) { v = p.list[i]; ok = true; }
      }
      if (!ok) errors.push('«' + p.label + '»: значение «' + v + '» не из списка (' + p.list.join(' / ') + ')');
    } else {
      var n = parseNum_(v);
      if (!n.ok || n.value === null) {
        errors.push('«' + p.label + '»: нужно число');
        v = p.def;
      } else {
        v = n.value;
      }
    }
    cfg.params[p.key] = v;
  });
  var P = cfg.params;
  if (P.fso < 0 || P.mzk < 0 || P.fso + P.mzk >= 1) errors.push('ФСО + МЗК должны быть от 0 до 1');
  if (P.kSpch < 0) errors.push('Коэффициент СПЧ не может быть отрицательным');

  cfg.weights = parsed.weights.map(function (w, i) {
    var n = parseNum_(w);
    if (!n.ok || (n.value !== null && n.value < 0)) errors.push('Вес профиля за ' + SEASON_MONTHS[i] + ': нужно число ≥ 0');
    return n.ok && n.value !== null ? n.value : 0;
  });
  cfg.sums = parsed.sums.map(function (s, i) {
    var n = parseNum_(s);
    if (!n.ok) errors.push('Сумма сверхлимита за ' + SEASON_MONTHS[i] + ': нужно число');
    return n.ok && n.value !== null ? n.value : 0;
  });

  parsed.objects.forEach(function (o) {
    if (cfg.objectByName[o.name]) {
      errors.push('ЖК «' + o.name + '» указан в настройках дважды');
      return;
    }
    var planN = parseNum_(o.plan);
    o.planValue = planN.ok && planN.value !== null ? planN.value : 0;
    if (!planN.ok) errors.push('ЖК «' + o.name + '»: план сверхлимита — не число');
    if (o.type !== TYPE_MIXED && o.type !== TYPE_AREA) {
      if (o.active) errors.push('ЖК «' + o.name + '»: тип учёта должен быть «' + TYPE_MIXED + '» или «' + TYPE_AREA + '»');
    }
    var rowN = parseNum_(o.row);
    o.rowValue = rowN.ok && rowN.value !== null && rowN.value >= 1 ? Math.round(rowN.value) : null;
    o.novColIndex = colToIndex_(o.novCol);
    o.order = cfg.objects.length;
    cfg.objects.push(o);
    cfg.objectByName[o.name] = o;
  });
  if (!parsed.objectsHeaderFound) errors.push('Не найдена таблица объектов (строка с заголовками «ЖК | Лист-источник …»)');

  if (errors.length) throw new Error('Ошибки на листе ' + SHEET_SETTINGS + ':\n• ' + errors.join('\n• '));
  return cfg;
}

// ---------- ВВОД ----------

function ensureInputSheet_(ss, force, log) {
  var sheet = ss.getSheetByName(SHEET_INPUT);
  var headerOk = sheet && headerMatches_(sheet, INPUT_HEADER_ROW, INPUT_HEADERS);
  var version = sheet ? getSheetVersion_(sheet) : 0;
  if (headerOk && !force && version === 0 && sheet.getRange(1, 1).getDisplayValue().indexOf('(v' + KOIN_HEAT_VERSION + ')') >= 0) {
    // Лист создан этой версией, но создание прервалось до метки версии — достраиваем, данные не трогаем
    formatInputSheet_(sheet);
    applyInputValidation_(ss, sheet);
    setSheetVersion_(sheet);
    log.push(SHEET_INPUT + ': достроен (данные сохранены)');
    return sheet;
  }
  if (headerOk && version === KOIN_HEAT_VERSION && !force) {
    applyInputValidation_(ss, sheet);
    log.push(SHEET_INPUT + ': актуален');
    return sheet;
  }
  var migrated = null;
  var index = null;
  if (sheet) {
    // Данные переносим только с листа, созданного этой же структурой (есть метка версии).
    // Со старых листов не переносим: у них шапка могла не совпадать с данными.
    if (getSheetVersion_(sheet) >= KOIN_HEAT_VERSION) migrated = readRowsByHeader_(sheet, INPUT_HEADER_ROW, INPUT_HEADERS);
    index = archiveSheet_(ss, sheet, log);
  }
  sheet = createSheetAt_(ss, SHEET_INPUT, index);
  var W = INPUT_HEADERS.length;
  var top = [
    fitRow_(['ВВОД ФАКТА ЗА МЕСЯЦ (v' + KOIN_HEAT_VERSION + ')'], W),
    fitRow_(['Жёлтые ячейки заполняем вручную, одна строка = ЖК × месяц. Площади: со счётчиками + СПЧ + ' +
      'без счётчиков = итого. Для Гавайев вместо объёма газа вносим Гкал по общедомовому счётчику. ' +
      'Для ЛП колонки «Площадь со счётчиками» и «Гкал по квартирным счётчикам» оставляем пустыми.'], W),
    fitRow_(INPUT_HEADERS, W)
  ];
  sheet.getRange(1, 1, top.length, W).setValues(top);

  var data = [];
  if (migrated && migrated.length) {
    data = migrated;
    log.push(SHEET_INPUT + ': перенесено строк — ' + migrated.length);
  } else {
    var cfgObjects = [];
    try {
      cfgObjects = readSettings_(ss.getSheetByName(SHEET_SETTINGS)).objects;
    } catch (e) {
      cfgObjects = DEFAULT_OBJECTS.map(makeObject_);
    }
    SEASON_MONTHS.forEach(function (m) {
      cfgObjects.forEach(function (o) {
        if (o.active) data.push(fitRow_([m, o.name], W));
      });
    });
  }
  if (data.length) sheet.getRange(INPUT_HEADER_ROW + 1, 1, data.length, W).setValues(data.map(function (r) { return fitRow_(r, W); }));

  formatInputSheet_(sheet);
  applyInputValidation_(ss, sheet);
  setSheetVersion_(sheet);
  log.push(SHEET_INPUT + ': создан');
  return sheet;
}

function formatInputSheet_(sheet) {
  var W = INPUT_HEADERS.length;
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  // Без объединения ячеек: объединённая строка не даёт закрепить первые две колонки
  sheet.getRange(2, 1, 1, W).breakApart();
  sheet.getRange(2, 1).setWrap(false).setFontStyle('italic');
  sheet.getRange(INPUT_HEADER_ROW, 1, 1, W).setFontWeight('bold').setBackground(COLOR_HEADER_BG)
    .setWrap(true).setVerticalAlignment('middle');
  sheet.setRowHeight(INPUT_HEADER_ROW, 48);
  styleInput_(sheet.getRange(INPUT_HEADER_ROW + 1, 1, INPUT_ROWS, W));
  sheet.getRange(INPUT_HEADER_ROW + 1, IN.BILL + 1, INPUT_ROWS, 2).setNumberFormat('#,##0.00');
  sheet.getRange(INPUT_HEADER_ROW + 1, IN.GAS + 1, INPUT_ROWS, 1).setNumberFormat('#,##0.00');
  sheet.getRange(INPUT_HEADER_ROW + 1, IN.GKAL_HOUSE + 1, INPUT_ROWS, 1).setNumberFormat('#,##0.0000');
  sheet.getRange(INPUT_HEADER_ROW + 1, IN.AREA_TOTAL + 1, INPUT_ROWS, 4).setNumberFormat('#,##0.00');
  sheet.getRange(INPUT_HEADER_ROW + 1, IN.GKAL_METER + 1, INPUT_ROWS, 1).setNumberFormat('#,##0.0000');
  sheet.setColumnWidths(1, 2, 110);
  sheet.setColumnWidths(3, W - 3, 125);
  sheet.setColumnWidth(W, 220);
  sheet.setFrozenRows(INPUT_HEADER_ROW);
  sheet.setFrozenColumns(2);
}

function applyInputValidation_(ss, sheet) {
  var first = INPUT_HEADER_ROW + 1;
  sheet.getRange(first, IN.MONTH + 1, INPUT_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SEASON_MONTHS, true).build());
  var names = [];
  try {
    names = readSettings_(ss.getSheetByName(SHEET_SETTINGS)).objects.map(function (o) { return o.name; });
  } catch (e) {
    names = DEFAULT_OBJECTS.map(function (o) { return o[0]; });
  }
  if (names.length) {
    sheet.getRange(first, IN.OBJ + 1, INPUT_ROWS, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(names, true).build());
  }
}

/** Читает строки листа, раскладывая значения по нужным заголовкам (по названию колонки). */
function readRowsByHeader_(sheet, headerRow, headers) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= headerRow || lastCol < 1) return [];
  var head = sheet.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var map = headers.map(function (h) { return head.indexOf(h); });
  var values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
  var out = [];
  values.forEach(function (row) {
    var r = map.map(function (idx) { return idx >= 0 ? row[idx] : ''; });
    if (r.some(function (v) { return v !== '' && v !== null; })) out.push(r);
  });
  return out;
}

// ---------- ОТЧЁТ и ДЕТАЛИ ----------

function ensureOutputSheet_(ss, name, headerRow, headers, force, log) {
  var sheet = ss.getSheetByName(name);
  var current = sheet && getSheetVersion_(sheet) === KOIN_HEAT_VERSION && headerMatches_(sheet, headerRow, headers);
  if (current && !force) {
    log.push(name + ': актуален');
    return sheet;
  }
  var index = null;
  if (sheet) index = archiveSheet_(ss, sheet, log);
  sheet = createSheetAt_(ss, name, index);
  var W = headers.length;
  sheet.getRange(1, 1, headerRow, W).setValues([
    fitRow_([name], W),
    fitRow_(['Ещё не пересчитано. Меню КОІН → Отопление → Пересчитать отчёт.'], W),
    fitRow_(headers, W)
  ]);
  formatOutputHeader_(sheet, headerRow, W);
  setSheetVersion_(sheet);
  log.push(name + ': создан');
  return sheet;
}

function formatOutputHeader_(sheet, headerRow, W) {
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  sheet.getRange(headerRow, 1, 1, W).setFontWeight('bold').setBackground(COLOR_HEADER_BG)
    .setWrap(true).setVerticalAlignment('middle');
  sheet.setRowHeight(headerRow, 48);
  sheet.setFrozenRows(headerRow);
}

// =====================================================================
// Пересчёт
// =====================================================================

function recalcReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  ensureAllSheets_(false);
  var cfg;
  try {
    cfg = readSettings_(ss.getSheetByName(SHEET_SETTINGS));
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  var inputs = readInputRows_(ss.getSheetByName(SHEET_INPUT));
  var boilerFn = makeBoilerLookup_(ss);
  var result = computeAll_(cfg, inputs, boilerFn);
  writeReport_(ss.getSheetByName(SHEET_REPORT), cfg, result);
  writeDetails_(ss.getSheetByName(SHEET_DETAILS), cfg, result);
  var bad = result.rows.filter(function (c) { return c.errors.length; }).length;
  ss.toast('Строк: ' + result.rows.length + ', с ошибками: ' + bad, 'Отчёт пересчитан', 8);
}

function readInputRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var W = INPUT_HEADERS.length;
  if (lastRow <= INPUT_HEADER_ROW) return [];
  var values = sheet.getRange(INPUT_HEADER_ROW + 1, 1, lastRow - INPUT_HEADER_ROW, W).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var numericFilled = false;
    for (var c = IN.BILL; c <= IN.GKAL_METER; c++) {
      if (row[c] !== '' && row[c] !== null) numericFilled = true;
    }
    if (!numericFilled) continue; // пустая или заготовка «месяц + ЖК» без данных
    out.push({ rowNum: INPUT_HEADER_ROW + 1 + i, values: row });
  }
  return out;
}

function makeBoilerLookup_(ss) {
  var cache = {};
  return function (obj, monthIdx) {
    if (!obj.sheetName) return { error: 'не указан лист-источник' };
    if (!obj.rowValue) return { error: 'не задана строка «Содержание котельной» в настройках' };
    if (!obj.novColIndex) return { error: 'неверная колонка ноября «' + obj.novCol + '»' };
    var key = obj.name;
    if (!cache[key]) {
      var src = ss.getSheetByName(obj.sheetName);
      if (!src) {
        cache[key] = { error: 'нет листа «' + obj.sheetName + '»' };
      } else {
        cache[key] = { values: src.getRange(obj.rowValue, obj.novColIndex, 1, SEASON_MONTHS.length).getValues()[0] };
      }
    }
    if (cache[key].error) return { error: cache[key].error };
    var n = parseNum_(cache[key].values[monthIdx]);
    if (!n.ok || n.value === null) {
      return { error: 'в смете «' + obj.sheetName + '» нет содержания котельной за ' + SEASON_MONTHS[monthIdx] +
        ' (' + indexToCol_(obj.novColIndex + monthIdx) + obj.rowValue + ')' };
    }
    return { value: n.value };
  };
}

/**
 * Весь расчёт без обращения к таблице (чистая функция — удобно проверять).
 * inputs: [{rowNum, values:[12 колонок ВВОДа]}]
 * boilerFn(obj, monthIdx) -> {value} | {error}
 */
function computeAll_(cfg, inputs, boilerFn) {
  var rows = [];
  var groups = {};

  inputs.forEach(function (inp) {
    var v = inp.values;
    var c = newCalc_(inp.rowNum);
    c.month = String(v[IN.MONTH] === null ? '' : v[IN.MONTH]).trim();
    c.objName = String(v[IN.OBJ] === null ? '' : v[IN.OBJ]).trim();
    c.monthIdx = monthIndex_(c.month);
    if (c.monthIdx < 0) c.errors.push('месяц «' + c.month + '» не из списка Ноябрь…Март');
    var obj = cfg.objectByName[c.objName];
    if (!obj) {
      c.errors.push('ЖК «' + c.objName + '» нет в настройках');
    } else if (!obj.active) {
      return; // неактивные ЖК в отчёт не выводим
    }
    c.obj = obj || null;
    c.order = obj ? obj.order : 9999;
    if (c.monthIdx >= 0) c.receipt = receiptMonth_(c.month, cfg.params.lag);

    var fields = [
      ['bill', IN.BILL], ['olFact', IN.OL], ['gas', IN.GAS], ['gkalHouse', IN.GKAL_HOUSE],
      ['areaTotal', IN.AREA_TOTAL], ['areaMeter', IN.AREA_METER], ['areaSpch', IN.AREA_SPCH],
      ['areaNo', IN.AREA_NO], ['gkalMeter', IN.GKAL_METER]
    ];
    fields.forEach(function (f) {
      var n = parseNum_(v[f[1]]);
      if (!n.ok) c.errors.push('не число в колонке «' + INPUT_HEADERS[f[1]] + '»');
      c[f[0]] = n.ok ? n.value : null;
    });
    if (c.bill === null) c.errors.push('не указан счёт поставщика');
    if (c.olFact === null) c.olFact = 0;
    if (c.olFact < 0) c.errors.push('сверхлимит не может быть отрицательным');
    if (c.bill !== null && c.olFact > c.bill) c.errors.push('сверхлимит больше суммы счёта');

    rows.push(c);
    if (!c.errors.length) {
      if (!groups[obj.name]) groups[obj.name] = [];
      groups[obj.name].push(c);
    }
  });

  // Повторы «ЖК + месяц» исключаем из расчёта
  Object.keys(groups).forEach(function (name) {
    var byMonth = {};
    groups[name].forEach(function (c) {
      if (!byMonth[c.monthIdx]) byMonth[c.monthIdx] = [];
      byMonth[c.monthIdx].push(c);
    });
    var keep = [];
    Object.keys(byMonth).forEach(function (m) {
      var list = byMonth[m];
      if (list.length > 1) {
        var nums = list.map(function (c) { return c.rowNum; }).join(', ');
        list.forEach(function (c) { c.errors.push('повтор ЖК + месяц в строках ВВОДа ' + nums); });
      } else {
        keep.push(list[0]);
      }
    });
    groups[name] = keep;
  });

  // Сглаживание сверхлимита по каждому ЖК
  var overlimit = [];
  cfg.objects.forEach(function (obj) {
    if (!obj.active) return;
    var list = groups[obj.name] || [];
    var alloc = allocateOverlimit_(list.map(function (c) {
      return { monthIdx: c.monthIdx, bill: c.bill, ol: c.olFact };
    }), obj.planValue, cfg);
    list.forEach(function (c) { c.olAdd = alloc.adds[c.monthIdx]; });
    alloc.obj = obj;
    overlimit.push(alloc);
  });

  // Тарифы
  rows.forEach(function (c) {
    if (!c.errors.length) calcTariffs_(c, c.obj, cfg, boilerFn);
    c.status = c.errors.length ? '⚠ ' + c.errors.join('; ') : STATUS_OK;
  });

  rows.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    if (a.objName !== b.objName) return a.objName < b.objName ? -1 : 1;
    if (a.monthIdx !== b.monthIdx) return a.monthIdx - b.monthIdx;
    return a.rowNum - b.rowNum;
  });
  return { rows: rows, overlimit: overlimit };
}

function newCalc_(rowNum) {
  return {
    rowNum: rowNum, errors: [], month: '', monthIdx: -1, receipt: '', objName: '', obj: null, order: 9999,
    bill: null, olFact: null, olAdd: null, gas: null, gkalHouse: null, areaTotal: null, areaMeter: null,
    areaSpch: null, areaNo: null, gkalMeter: null,
    base: null, norm: null, normSrc: '', fsoMzk: null, tCommon: null, boiler: null, boilerTotal: null,
    price: null, restGkal: null, tNo: null, tSpch: null, charged: null, diff: null, tol: null, status: ''
  };
}

/**
 * Разнесение сверхлимита по месяцам одного ЖК.
 * entries: [{monthIdx, bill, ol}] — только введённые месяцы.
 * Возвращает adds[5] (null для невведённых месяцев) и сводку для сверки.
 */
function allocateOverlimit_(entries, plan, cfg) {
  var n = SEASON_MONTHS.length;
  var P = cfg.params;
  var base0 = [];
  var fact = [];
  var i;
  for (i = 0; i < n; i++) { base0.push(null); fact.push(0); }
  var factTotal = 0;
  entries.forEach(function (e) {
    base0[e.monthIdx] = e.bill - e.ol;
    fact[e.monthIdx] = e.ol;
    factTotal += e.ol;
  });
  var entered = [];
  for (i = 0; i < n; i++) if (base0[i] !== null) entered.push(i);
  var complete = base0[n - 1] !== null; // март введён — сезон закрыт
  var seasonAmount = complete ? factTotal : Math.max(plan || 0, factTotal);
  var estimated = false;

  var full = [];
  for (i = 0; i < n; i++) full.push(0);

  if (P.mode === MODE_PROFILE) {
    var b = base0.slice();
    if (!complete && entered.length) {
      // Будущие месяцы ещё не введены: оцениваем их базы по профилю введённых
      var sb = 0;
      var sw = 0;
      entered.forEach(function (k) { sb += base0[k]; sw += cfg.weights[k]; });
      var unit = sw > 0 ? sb / sw : 0;
      for (i = 0; i < n; i++) {
        if (b[i] === null) { b[i] = cfg.weights[i] * unit; estimated = true; }
      }
    }
    for (i = 0; i < n; i++) if (b[i] === null) b[i] = 0;
    full = profileAdditions_(b, cfg.weights, seasonAmount);
  } else if (P.mode === MODE_WEIGHTS) {
    var swAll = 0;
    for (i = 0; i < n; i++) swAll += cfg.weights[i];
    for (i = 0; i < n; i++) full[i] = swAll > 0 ? seasonAmount * cfg.weights[i] / swAll : 0;
  } else {
    for (i = 0; i < n; i++) full[i] = cfg.sums[i] || 0;
  }

  var adds = [];
  for (i = 0; i < n; i++) adds.push(base0[i] === null ? null : full[i]);

  var trueUp = false;
  if (P.trueUp === 'Да' && complete) {
    var before = 0;
    for (i = 0; i < n - 1; i++) if (adds[i] !== null) before += adds[i];
    adds[n - 1] = factTotal - before;
    trueUp = true;
  }
  var allocated = 0;
  for (i = 0; i < n; i++) if (adds[i] !== null) allocated += adds[i];

  return {
    adds: adds, fact: fact, factTotal: factTotal, plan: plan || 0, seasonAmount: seasonAmount,
    allocated: allocated, complete: complete, estimated: estimated, trueUp: trueUp, entered: entered.length
  };
}

/**
 * Добавки сверхлимита, при которых итоговые базы пропорциональны весам.
 * Месяцы, база которых уже выше целевой, получают 0 и исключаются; повторяем, пока все добавки ≥ 0.
 */
function profileAdditions_(base0, weights, amount) {
  var n = base0.length;
  var adds = [];
  var active = [];
  var i;
  for (i = 0; i < n; i++) { adds.push(0); active.push(weights[i] > 0); }
  for (var iter = 0; iter <= n; iter++) {
    var sw = 0;
    var sb = 0;
    for (i = 0; i < n; i++) if (active[i]) { sw += weights[i]; sb += base0[i]; }
    if (sw <= 0) break;
    var unit = (sb + amount) / sw;
    var excluded = false;
    for (i = 0; i < n; i++) {
      if (active[i] && weights[i] * unit - base0[i] < 0) { active[i] = false; excluded = true; }
    }
    if (!excluded) {
      for (i = 0; i < n; i++) adds[i] = active[i] ? weights[i] * unit - base0[i] : 0;
      break;
    }
  }
  return adds;
}

/** Тарифы одной строки ЖК × месяц. Ошибки складываются в c.errors. */
function calcTariffs_(c, obj, cfg, boilerFn) {
  var P = cfg.params;
  var dA = P.digitsArea;
  var dP = P.digitsPrice;
  var share = 1 - P.fso - P.mzk;

  c.base = c.bill - c.olFact + (c.olAdd || 0);
  if (!(c.base > 0)) c.errors.push('база распределения ≤ 0');

  var total = c.areaTotal;
  var meter = c.areaMeter || 0;
  var spch = c.areaSpch || 0;
  var no = c.areaNo || 0;
  var gkalMeter = c.gkalMeter || 0;
  if (!(total > 0)) {
    c.errors.push('не указана площадь отапливаемая итого');
  } else if (Math.abs(meter + spch + no - total) > P.tolArea) {
    c.errors.push('площади не сходятся: со счётчиками + СПЧ + без счётчиков = ' + fmt_(meter + spch + no, 2) +
      ', итого = ' + fmt_(total, 2));
  }
  if (meter < 0 || spch < 0 || no < 0 || gkalMeter < 0) c.errors.push('отрицательные площади или Гкал');

  if (c.gas > 0) {
    c.norm = c.gas * P.kcal;
    c.normSrc = 'газ × ' + P.kcal;
  } else if (c.gkalHouse > 0) {
    c.norm = c.gkalHouse;
    c.normSrc = 'Гкал общедомовой';
  }

  var b = boilerFn(obj, c.monthIdx);
  if (b.error) c.errors.push(b.error);
  else c.boiler = b.value;

  if (c.errors.length) return;

  // ФСО+МЗК либо идёт на все м² вместе с содержанием котельной,
  // либо входит в газовые тарифы в той же пропорции, что и газ (тогда распределяется вся база)
  var common = P.fsoMode === FSO_COMMON;
  c.fsoMzk = c.base * (P.fso + P.mzk);
  c.tCommon = common ? round_(c.fsoMzk / total, dA) : null;
  c.boilerTotal = round_(c.boiler + (c.tCommon || 0), dA);
  var gasAmount = common ? c.base - c.fsoMzk : c.base;

  var denom = no + P.kSpch * spch;
  var priceExact = 0;

  if (obj.type === TYPE_AREA) {
    if (gkalMeter > 0 || meter > 0) {
      c.errors.push('учёт по м²: «Площадь со счётчиками» и «Гкал по квартирным счётчикам» должны быть пустыми');
      return;
    }
    if (!(denom > 0)) {
      c.errors.push('нет площади без счётчиков / СПЧ для распределения');
      return;
    }
    c.tNo = round_(gasAmount / denom, dA);
  } else {
    if (!(c.norm > 0)) {
      c.errors.push('нет объёма газа (или Гкал по общедомовому счётчику) для норматива');
      return;
    }
    if (gkalMeter > 0 && !(meter > 0)) {
      c.errors.push('есть Гкал по квартирным счётчикам, но площадь со счётчиками пустая');
      return;
    }
    priceExact = gasAmount / (c.norm * share);
    c.price = round_(priceExact, dP);
    var indiv = c.norm * share;
    c.restGkal = indiv - gkalMeter;
    if (c.restGkal < 0) {
      c.errors.push('Гкал по квартирным счётчикам (' + fmt_(gkalMeter, 2) + ') больше индивидуальной части норматива (' +
        fmt_(indiv, 2) + ')');
      return;
    }
    if (denom > 0) {
      c.tNo = round_(c.restGkal * priceExact / denom, dA);
    } else if (c.restGkal * priceExact > P.tol) {
      c.errors.push('остаток Гкал некому распределить: нет площади без счётчиков и СПЧ');
      return;
    } else {
      c.tNo = 0;
    }
  }
  c.tSpch = round_(c.tNo * P.kSpch, dA);

  c.charged = (c.price || 0) * gkalMeter + c.tNo * no + c.tSpch * spch + (c.tCommon || 0) * total;
  c.diff = c.charged - c.base;
  c.tol = P.tol + 0.5 * Math.pow(10, -dA) * ((common ? total : 0) + no + spch) + 0.5 * Math.pow(10, -dP) * gkalMeter;
  if (Math.abs(c.diff) > c.tol) {
    c.errors.push('расхождение ' + fmt_(c.diff, 2) + ' грн больше допуска ' + fmt_(c.tol, 2) + ' грн');
  }
}

// ---------- Запись результатов ----------

function writeReport_(sheet, cfg, result) {
  var W = REPORT_HEADERS.length;
  var P = cfg.params;
  resetOutput_(sheet);
  var info = 'Пересчитано ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') +
    '. ФСО ' + fmt_(P.fso * 100, 1) + '% + МЗК ' + fmt_(P.mzk * 100, 1) + '% ' +
    (P.fsoMode === FSO_COMMON ? 'включены в «Содержание котельной» (на все м²)' :
      'включены в газовые тарифы пропорционально газу; «Содержание котельной» = смета') + '. Коэф. СПЧ ' + P.kSpch + '; сглаживание сверхлимита — «' + P.mode + '».';
  var rows = [fitRow_([SHEET_REPORT + ': ТАРИФЫ НА ОТОПЛЕНИЕ'], W), fitRow_([info], W), fitRow_(REPORT_HEADERS, W)];
  sheet.getRange(1, 1, rows.length, W).setValues(rows);
  formatOutputHeader_(sheet, REPORT_HEADER_ROW, W);

  var data = result.rows.map(function (c) {
    return fitRow_([
      c.month, c.receipt, c.objName, blank_(c.bill), blank_(c.boilerTotal), blank_(c.price),
      blank_(c.tNo), blank_(c.tSpch), blank_(c.charged), blank_(c.diff), c.status
    ], W);
  });
  if (!data.length) return;
  var first = REPORT_HEADER_ROW + 1;
  var range = sheet.getRange(first, 1, data.length, W);
  range.setValues(data);
  sheet.getRange(first, 4, data.length, 1).setNumberFormat('#,##0.00');
  sheet.getRange(first, 5, data.length, 4).setNumberFormat('0.00');
  sheet.getRange(first, 9, data.length, 2).setNumberFormat('#,##0.00');
  paintStatus_(sheet, first, result.rows, W);
  sheet.setColumnWidths(1, 3, 110);
  sheet.setColumnWidths(4, W - 4, 130);
  sheet.setColumnWidth(W, 360);
  sheet.getRange(first, W, data.length, 1).setWrap(true);
}

function writeDetails_(sheet, cfg, result) {
  var W = DETAILS_HEADERS.length;
  resetOutput_(sheet);
  var rows = [
    fitRow_([SHEET_DETAILS], W),
    fitRow_(['Техника расчёта для проверки. Режим сглаживания сверхлимита: «' + cfg.params.mode + '».'], W),
    fitRow_(DETAILS_HEADERS, W)
  ];
  result.rows.forEach(function (c) {
    rows.push(fitRow_([
      c.month, c.objName, blank_(c.olFact), blank_(c.olAdd), blank_(c.base), blank_(c.norm), c.normSrc,
      blank_(c.fsoMzk), blank_(c.tCommon), blank_(c.boiler), blank_(c.price), blank_(c.restGkal),
      blank_(c.tNo), blank_(c.tSpch), blank_(c.charged), blank_(c.diff), blank_(c.tol), c.status
    ], W));
  });
  var detailCount = result.rows.length;
  rows.push(fitRow_([], W));
  var olTitleRow = rows.length + 1;
  rows.push(fitRow_(['СВЕРКА СВЕРХЛИМИТА ЗА СЕЗОН'], W));
  var olHeaderRow = rows.length + 1;
  rows.push(fitRow_(['ЖК', 'План на сезон, грн', 'Факт в счетах, грн', 'Сумма к разнесению, грн', 'Разнесено всего, грн']
    .concat(SEASON_MONTHS).concat(['Март введён (сезон закрыт)', 'Примечание']), W));
  result.overlimit.forEach(function (a) {
    var note = [];
    if (a.estimated) note.push('базы невведённых месяцев оценены по профилю — добавки уточнятся с новыми счетами');
    if (a.trueUp) note.push('март доведён до факта сезона');
    if (!a.entered) note.push('нет введённых месяцев');
    rows.push(fitRow_([a.obj.name, a.plan, a.factTotal, a.seasonAmount, a.allocated]
      .concat(a.adds.map(blank_)).concat([a.complete ? 'Да' : 'Нет', note.join('; ')]), W));
  });
  sheet.getRange(1, 1, rows.length, W).setValues(rows);
  formatOutputHeader_(sheet, DETAILS_HEADER_ROW, W);

  var first = DETAILS_HEADER_ROW + 1;
  if (detailCount) {
    sheet.getRange(first, 3, detailCount, 3).setNumberFormat('#,##0.00');
    sheet.getRange(first, 6, detailCount, 1).setNumberFormat('#,##0.0000');
    sheet.getRange(first, 8, detailCount, 1).setNumberFormat('#,##0.00');
    sheet.getRange(first, 9, detailCount, 2).setNumberFormat('0.0000');
    sheet.getRange(first, 11, detailCount, 1).setNumberFormat('#,##0.00');
    sheet.getRange(first, 12, detailCount, 1).setNumberFormat('#,##0.0000');
    sheet.getRange(first, 13, detailCount, 2).setNumberFormat('0.00');
    sheet.getRange(first, 15, detailCount, 3).setNumberFormat('#,##0.00');
    paintStatus_(sheet, first, result.rows, W);
  }
  sheet.getRange(olTitleRow, 1).setFontWeight('bold').setFontSize(11);
  sheet.getRange(olHeaderRow, 1, 1, 12).setFontWeight('bold').setBackground(COLOR_HEADER_BG).setWrap(true);
  if (result.overlimit.length) {
    sheet.getRange(olHeaderRow + 1, 2, result.overlimit.length, 9).setNumberFormat('#,##0.00');
  }
  sheet.setColumnWidths(1, W, 115);
  sheet.setColumnWidth(W, 360);
}

function resetOutput_(sheet) {
  sheet.clear();
  sheet.clearConditionalFormatRules();
  var dv = sheet.getDataRange();
  dv.clearDataValidations();
}

function paintStatus_(sheet, firstRow, calcRows, W) {
  var bgs = [];
  var fonts = [];
  calcRows.forEach(function (c) {
    var bad = c.errors.length > 0;
    var bgRow = [];
    var fontRow = [];
    for (var i = 0; i < W; i++) {
      bgRow.push(bad ? COLOR_ERROR_BG : '#ffffff');
      fontRow.push(bad && i === W - 1 ? COLOR_ERROR_FONT : (i === W - 1 ? '#38761d' : '#000000'));
    }
    bgs.push(bgRow);
    fonts.push(fontRow);
  });
  var range = sheet.getRange(firstRow, 1, calcRows.length, W);
  range.setBackgrounds(bgs);
  range.setFontColors(fonts);
}

// =====================================================================
// Проверка настроек
// =====================================================================

function checkSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var lines = ['Версия скрипта: ' + KOIN_HEAT_VERSION, ''];
  [SHEET_SETTINGS, SHEET_INPUT, SHEET_REPORT, SHEET_DETAILS].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      lines.push(name + ': нет листа — выполните «Создать / обновить листы»');
      return;
    }
    var ver = getSheetVersion_(sh);
    lines.push(name + ': версия ' + (ver || 'без метки') +
      (ver === KOIN_HEAT_VERSION ? ' ✓' : ' — устарела, выполните «Создать / обновить листы»'));
  });
  var settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!settingsSheet) {
    ui.alert(lines.join('\n'));
    return;
  }
  var cfg;
  try {
    cfg = readSettings_(settingsSheet);
  } catch (e) {
    lines.push('');
    lines.push(e.message);
    ui.alert(lines.join('\n'));
    return;
  }
  var P = cfg.params;
  lines.push('');
  lines.push('Режим сглаживания: «' + P.mode + '», веса ' + cfg.weights.join(' / ') +
    '; доводить в марте: ' + P.trueUp);
  lines.push('ФСО ' + P.fso + ', МЗК ' + P.mzk + ', коэф. СПЧ ' + P.kSpch + ', калорийность ' + P.kcal +
    ', лаг ' + P.lag + ' мес.');

  cfg.objects.forEach(function (o) {
    lines.push('');
    var head = o.name + (o.active ? '' : ' (не активен)') + ' — лист «' + o.sheetName + '», тип «' + o.type + '»';
    if (!o.rowValue || !o.novColIndex) {
      lines.push(head);
      lines.push('   ⚠ строка или колонка не заданы');
      return;
    }
    var colFrom = indexToCol_(o.novColIndex);
    var colTo = indexToCol_(o.novColIndex + SEASON_MONTHS.length - 1);
    lines.push(head + ', строка ' + o.rowValue + ', колонки ' + colFrom + '–' + colTo);
    var src = ss.getSheetByName(o.sheetName);
    if (!src) {
      lines.push('   ⚠ лист «' + o.sheetName + '» не найден');
      return;
    }
    var label = '';
    if (o.novColIndex > 1) {
      var left = src.getRange(o.rowValue, 1, 1, o.novColIndex - 1).getDisplayValues()[0];
      for (var i = 0; i < left.length; i++) {
        var t = String(left[i]).trim();
        if (t && isNaN(Number(t.replace(',', '.').replace(/\s/g, '')))) { label = t; break; }
      }
    }
    lines.push('   Подпись: «' + (label ? cut_(label, 90) : '— пусто —') + '»');
    var vals = src.getRange(o.rowValue, o.novColIndex, 1, SEASON_MONTHS.length).getValues()[0];
    var parts = [];
    var bad = false;
    vals.forEach(function (v, k) {
      var n = parseNum_(v);
      if (!n.ok || n.value === null) bad = true;
      parts.push(SEASON_MONTHS[k].substring(0, 3) + ' ' + (n.ok && n.value !== null ? fmt_(n.value, 2) : '«' + v + '»'));
    });
    lines.push('   ' + parts.join(' · ') + (bad ? '   ⚠ не все значения — числа' : ''));
  });
  ui.alert('Проверка настроек отопления', lines.join('\n'), ui.ButtonSet.OK);
}

// =====================================================================
// Самопроверка сглаживания на данных Лимноса (запускать из редактора, результат — в журнале)
// =====================================================================

function testSmoothingLimnos() {
  var cfg = {
    params: { mode: MODE_PROFILE, trueUp: 'Да' },
    weights: DEFAULT_WEIGHTS.slice(),
    sums: DEFAULT_SUMS.slice()
  };
  var bills = [134902.91, 331260.63, 435515.99, 377670.79, 612625.70];
  var ol = [0, 0, 0, 300000, 394634];
  var entries = bills.map(function (b, i) { return { monthIdx: i, bill: b, ol: ol[i] }; });
  var a = allocateOverlimit_(entries, 694634, cfg);
  var bases = bills.map(function (b, i) { return b - ol[i] + a.adds[i]; });
  var sumBases = bases.reduce(function (s, x) { return s + x; }, 0);
  var sumBills = bills.reduce(function (s, x) { return s + x; }, 0);
  Logger.log('Добавки: ' + a.adds.map(function (x) { return Math.round(x); }).join(' · '));
  Logger.log('Итоговые базы: ' + bases.map(function (x) { return Math.round(x); }).join(' · '));
  Logger.log('Сумма баз ' + fmt_(sumBases, 2) + ' = сумма счетов ' + fmt_(sumBills, 2));
}

// =====================================================================
// Помощники
// =====================================================================

/** Строка ровно заданной длины — иначе setValues() падает с «Incorrect range width». */
function fitRow_(arr, width) {
  var out = [];
  for (var i = 0; i < width; i++) {
    var v = arr && i < arr.length ? arr[i] : '';
    out.push(v === null || v === undefined ? '' : v);
  }
  return out;
}

function styleInput_(range) {
  range.setBackground(COLOR_INPUT_BG).setFontColor(COLOR_INPUT_FONT);
}

function blank_(v) {
  return v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? '' : v;
}

function parseNum_(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v === 'number') return isFinite(v) ? { ok: true, value: v } : { ok: false, value: null };
  var s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return { ok: true, value: null };
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return { ok: false, value: null };
  return { ok: true, value: parseFloat(s) };
}

function round_(x, digits) {
  var p = Math.pow(10, digits);
  var y = Math.abs(x) * p;
  var r = Math.round(y + 1e-9 * Math.max(1, y)) / p;
  return x < 0 ? -r : r;
}

function fmt_(x, digits) {
  return round_(x, digits).toFixed(digits);
}

function cut_(s, n) {
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

function monthIndex_(name) {
  var k = normLabel_(name);
  for (var i = 0; i < SEASON_MONTHS.length; i++) {
    if (normLabel_(SEASON_MONTHS[i]) === k) return i;
  }
  return -1;
}

function receiptMonth_(month, lag) {
  var k = normLabel_(month);
  for (var i = 0; i < YEAR_MONTHS.length; i++) {
    if (normLabel_(YEAR_MONTHS[i]) === k) return YEAR_MONTHS[(i + Math.round(lag || 0)) % 12];
  }
  return '';
}

function colToIndex_(letters) {
  var s = String(letters || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 0;
  var n = 0;
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function indexToCol_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
