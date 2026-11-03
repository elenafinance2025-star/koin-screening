/**
 * КОІН · Отопление — серверная часть (Google Apps Script) для страницы на GitHub Pages.
 * Задачи: проверка пароля, хранение данных в Google-таблице, чтение смет из Excel-файла на Диске.
 * Расчёт, отчёты, Excel и приказ формирует страница в браузере.
 *
 * Установка: см. heating-web/README.md (вставить этот файл и appsscript.json, «Развернуть → Веб-приложение»).
 */

var TOKEN_TTL_SEC = 8 * 60 * 60;
var DB_TITLE = 'КОІН · Отопление — данные';
var ROW_FIELDS = ['month', 'zk', 'bill', 'ol', 'gas', 'gkalHouse', 'areaTotal', 'areaSpch', 'areaNo', 'gkMeter', 'note', 'status'];
var ROW_HEADERS = ['Месяц потребления', 'ЖК', 'Счёт поставщика, грн', 'в т.ч. сверхлимит, грн', 'Объём газа, тыс. м³',
  'Гкал по общедомовому счётчику', 'Площадь итого, м²', 'Площадь СПЧ, м²', 'Площадь без счётчиков, м²',
  'Гкал по кв. счётчикам', 'Примечание', 'Статус месяца'];
var JOURNAL_FIELDS = ['zk', 'month', 'price', 'tNo', 'tSpch', 'charged', 'date'];
var JOURNAL_HEADERS = ['ЖК', 'Месяц', 'Цена Гкал', 'Тариф без сч.', 'Тариф СПЧ', 'Начислено по тарифам, грн', 'Дата закрытия'];

function doGet() {
  return json_({ ok: true, service: 'КОІН · Отопление API' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var res = handle_(req);
    return json_({ ok: true, data: res });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (req.action === 'login') return { token: login_(req.password) };
  auth_(req.token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (req.action) {
      case 'load': return load_();
      case 'init': return init_(req);
      case 'saveRows': return saveRows_(req.dataset, req.rows);
      case 'saveStore': storeSet_(db_(), req.key, req.value); return { saved: req.key };
      case 'saveJournal': return saveJournal_(req.entries);
      case 'importSmeta': return importSmeta_(req.fileId, req.sheets);
      case 'changePassword': return changePassword_(req.oldPassword, req.newPassword);
      default: throw new Error('Неизвестное действие: ' + req.action);
    }
  } finally {
    lock.releaseLock();
  }
}

// ---------- Пароль и сессии ----------

/**
 * Пароль оператора хранится только в свойствах скрипта (⚙ Настройки проекта → Свойства скрипта → PASSWORD),
 * в коде его нет: репозиторий публичный.
 */
function password_() {
  var pw = PropertiesService.getScriptProperties().getProperty('PASSWORD');
  if (!pw) throw new Error('Пароль не задан: в Apps Script откройте «Настройки проекта» → «Свойства скрипта» и добавьте PASSWORD');
  return pw;
}

function login_(password) {
  Utilities.sleep(300); // замедляем подбор пароля
  if (String(password || '') !== password_()) throw new Error('Неверный пароль');
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, '1', TOKEN_TTL_SEC);
  return token;
}

function auth_(token) {
  if (!token || !CacheService.getScriptCache().get('tok_' + token)) throw new Error('AUTH');
}

function changePassword_(oldPw, newPw) {
  if (String(oldPw || '') !== password_()) throw new Error('Текущий пароль неверный');
  if (!newPw || String(newPw).length < 6) throw new Error('Новый пароль — не короче 6 символов');
  PropertiesService.getScriptProperties().setProperty('PASSWORD', String(newPw));
  return { changed: true };
}

// ---------- Таблица данных ----------

function db_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* таблицу удалили — создадим заново */ }
  }
  var ss = SpreadsheetApp.create(DB_TITLE);
  props.setProperty('DB_ID', ss.getId());
  var first = ss.getSheets()[0];
  first.setName('План');
  writeTable_(first, ROW_HEADERS, []);
  writeTable_(ss.insertSheet('Факт'), ROW_HEADERS, []);
  writeTable_(ss.insertSheet('Журнал'), JOURNAL_HEADERS, []);
  writeTable_(ss.insertSheet('Хранилище'), ['Ключ', 'JSON', 'Изменено'], []);
  return ss;
}

/** Первая настройка из редактора (необязательно): создаёт таблицу и выводит ссылку. */
function setup() {
  Logger.log('Таблица данных: ' + db_().getUrl());
}

function writeTable_(sheet, headers, rows) {
  sheet.clearContents();
  var data = [headers].concat(rows);
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function readObjects_(sheet, fields) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, fields.length).getValues()
    .filter(function (v) { return v[0] !== '' && v[1] !== ''; })
    .map(function (v) {
      var o = {};
      fields.forEach(function (f, i) { o[f] = v[i] instanceof Date ? v[i].toISOString() : v[i]; });
      return o;
    });
}

function toRow_(o, fields) {
  return fields.map(function (f) { return o[f] === undefined || o[f] === null ? '' : o[f]; });
}

function load_() {
  var ss = db_();
  var store = {};
  var sh = ss.getSheetByName('Хранилище');
  var last = sh.getLastRow();
  if (last >= 2) {
    var parts = {};
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (v) {
      var k = String(v[0]);
      if (!k) return;
      var base = k.split('#')[0];
      (parts[base] = parts[base] || []).push([k, v[1]]);
    });
    Object.keys(parts).forEach(function (base) {
      var p = parts[base].sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      try { store[base] = JSON.parse(p.map(function (x) { return x[1]; }).join('')); } catch (e) { /* пропускаем */ }
    });
  }
  return {
    initialized: !!store.initialized,
    plan: readObjects_(ss.getSheetByName('План'), ROW_FIELDS),
    fact: readObjects_(ss.getSheetByName('Факт'), ROW_FIELDS),
    journal: readObjects_(ss.getSheetByName('Журнал'), JOURNAL_FIELDS),
    store: store,
    dbUrl: ss.getUrl()
  };
}

/** Первичное заполнение (только если таблица пустая): страница присылает план, факт и настройки. */
function init_(req) {
  var ss = db_();
  var cur = load_();
  if (cur.initialized) return cur;
  writeTable_(ss.getSheetByName('План'), ROW_HEADERS, (req.plan || []).map(function (r) { return toRow_(r, ROW_FIELDS); }));
  writeTable_(ss.getSheetByName('Факт'), ROW_HEADERS, (req.fact || []).map(function (r) { return toRow_(r, ROW_FIELDS); }));
  Object.keys(req.store || {}).forEach(function (k) { storeSet_(ss, k, req.store[k]); });
  storeSet_(ss, 'initialized', true);
  return load_();
}

function saveRows_(dataset, rows) {
  var name = dataset === 'plan' ? 'План' : (dataset === 'fact' ? 'Факт' : null);
  if (!name) throw new Error('Неизвестный набор данных');
  writeTable_(db_().getSheetByName(name), ROW_HEADERS, (rows || []).map(function (r) { return toRow_(r, ROW_FIELDS); }));
  return { saved: dataset, count: (rows || []).length };
}

function saveJournal_(entries) {
  writeTable_(db_().getSheetByName('Журнал'), JOURNAL_HEADERS,
    (entries || []).map(function (r) { return toRow_(r, JOURNAL_FIELDS); }));
  return { saved: 'journal', count: (entries || []).length };
}

/** Значение режется на части по 45 000 знаков: лимит ячейки — 50 000. */
function storeSet_(ss, key, value) {
  var sh = ss.getSheetByName('Хранилище');
  var jsonText = JSON.stringify(value);
  var chunks = [];
  for (var i = 0; i < jsonText.length; i += 45000) chunks.push(jsonText.substring(i, i + 45000));
  if (!chunks.length) chunks.push('');
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var r = keys.length - 1; r >= 0; r--) {
      var k = String(keys[r][0]);
      if (k === key || k.indexOf(key + '#') === 0) sh.deleteRow(r + 2);
    }
  }
  var now = new Date();
  var rows = chunks.map(function (c, n) { return [chunks.length === 1 ? key : key + '#' + ('00' + n).slice(-3), c, now]; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
}

// ---------- Сметы из Excel на Диске ----------

/**
 * Делает временную копию Excel-файла в формате Google Таблиц (расширенная служба Drive),
 * снимает значения нужных строк (1–70, пять колонок с ноября) и площадь, удаляет копию.
 * sheets: [{ zk, sheet, novCol, areaCell }]
 */
function importSmeta_(fileId, sheets) {
  if (!fileId) throw new Error('Не указан файл со сметами');
  var tmp = Drive.Files.copy({ name: 'tmp_smeta_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, fileId);
  var out = {}, log = [];
  try {
    var src = SpreadsheetApp.openById(tmp.id);
    var ss = db_();
    (sheets || []).forEach(function (m) {
      var sh = src.getSheetByName(m.sheet);
      if (!sh) { log.push(m.zk + ': нет листа «' + m.sheet + '»'); return; }
      var col = colToIndex_(m.novCol);
      var values = sh.getRange(1, col, 70, 5).getValues();
      var rows = {};
      values.forEach(function (v, i) {
        rows[String(i + 1)] = v.map(function (x) { return typeof x === 'number' ? x : 0; });
      });
      var area = sh.getRange(m.areaCell).getValue();
      var item = { rows: rows, area: typeof area === 'number' ? area : 0, sheet: m.sheet, importedAt: new Date().toISOString() };
      storeSet_(ss, 'smeta_' + m.zk, item);
      out[m.zk] = item;
      log.push(m.zk + ': загружено (лист «' + m.sheet + '», площадь ' + item.area + ')');
    });
  } finally {
    Drive.Files.remove(tmp.id);
  }
  return { smeta: out, log: log };
}

function colToIndex_(letters) {
  var s = String(letters || '').trim().toUpperCase(), n = 0;
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}
