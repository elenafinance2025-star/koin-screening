/* КОІН · Отопление — интерфейс страницы (GitHub Pages). Данные — через Apps Script API (config.js). */
(function () {
  'use strict';

  var LS_API = 'koin_api_url', SS_TOKEN = 'koin_token';
  var app = {
    token: null, data: null, view: 'input', dataset: 'fact', zk: ZK_ORDER[0], filterZk: 'Все',
    calc: null, ctx: null, busy: false
  };

  // ---------- Хранилище браузера (без падений в приватном режиме) ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* нет доступа */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* нет */ } }

  function apiUrl() { return lsGet(LS_API) || window.KOIN_API_URL || ''; }

  // ---------- API ----------
  function api(action, payload) {
    var url = apiUrl();
    if (!url) return Promise.reject(new Error('Не указан адрес сервера (Настройки → Адрес API)'));
    var body = Object.assign({ action: action, token: app.token }, payload || {});
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          if (res.error === 'AUTH') { logout(); throw new Error('Сессия истекла — войдите снова'); }
          throw new Error(res.error || 'Ошибка сервера');
        }
        return res.data;
      });
  }

  // ---------- Утилиты ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.substring(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var NF = {
    money: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    tariff: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    num3: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    num4: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    pct: new Intl.NumberFormat('uk-UA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
  };
  function fmt(v, f) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v !== 'number') return String(v);
    return NF[f] ? NF[f].format(v) : String(engineRound(v, 4)).replace('.', ',');
  }
  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, bad ? 7000 : 3500);
  }
  function busy(on, label) {
    app.busy = on;
    $('#busy').textContent = on ? (label || 'Сохраняю…') : '';
  }
  function run(label, promise) {
    busy(true, label);
    return promise.then(function (x) { busy(false); return x; }, function (e) { busy(false); toast(e.message, true); throw e; });
  }
  function download(blob, name) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- Данные и расчёт ----------
  function store(key, def) { var s = app.data && app.data.store; return s && s[key] !== undefined ? s[key] : def; }

  function buildCtx() {
    var settings = store('engine', engineDefaultSettings());
    var mapping = store('mapping', koshtDefaultMapping());
    var manual = store('manual', {});
    var journal = {}, closed = {};
    (app.data.journal || []).forEach(function (j) {
      journal[j.zk] = (journal[j.zk] || 0) + engineNum(j.charged);
      closed[j.zk + '|' + j.month] = { price: engineNum(j.price), tNo: engineNum(j.tNo), tSpch: engineNum(j.tSpch) };
    });
    var koshtFact = {};
    Object.keys(mapping).forEach(function (zk) {
      var sm = store('smeta_' + zk, null);
      if (!sm) return;
      var area = engineNum(mapping[zk].area) || engineNum(sm.area);
      koshtFact[zk] = koshtCompute(sm.rows, mapping[zk], area, manual[zk] || {});
    });
    var snap = store('koshtPlan', null);
    return {
      plan: app.data.plan, fact: app.data.fact, settings: settings, mapping: mapping, manual: manual,
      requisites: store('requisites', seedRequisites()), sourceFileId: store('sourceFileId', DEFAULT_SOURCE_FILE_ID),
      journal: journal, closed: closed, koshtFact: koshtFact, koshtPlan: snap ? snap.kosht : koshtFact,
      planFixedAt: snap ? snap.fixedAt : ''
    };
  }

  function recompute() {
    app.ctx = buildCtx();
    app.calc = repBuildAll(app.ctx);
  }

  function load() {
    return run('Загружаю данные…', api('load')).then(function (d) {
      if (!d.initialized) {
        return run('Первая настройка: заполняю план из Excel v4…', api('init', {
          plan: seedPlanRows(), fact: seedFactRows(),
          store: { engine: engineDefaultSettings(), mapping: koshtDefaultMapping(), manual: {},
            requisites: seedRequisites(), sourceFileId: DEFAULT_SOURCE_FILE_ID }
        }));
      }
      return d;
    }).then(function (d) {
      app.data = d;
      recompute();
      render();
    });
  }

  function saveStore(key, value) {
    return run('Сохраняю…', api('saveStore', { key: key, value: value })).then(function () {
      app.data.store[key] = value;
      recompute();
      render();
      toast('Сохранено');
    });
  }

  // ---------- Вход ----------
  function logout() {
    app.token = null;
    ssSet(SS_TOKEN, null);
    renderLogin();
  }

  function renderLogin() {
    var main = $('#main');
    main.innerHTML = '';
    $('#tabs').innerHTML = '';
    var pw = h('input', { type: 'password', id: 'pw', placeholder: 'Пароль оператора', autocomplete: 'current-password' });
    var url = h('input', { type: 'url', id: 'apiurl', placeholder: 'https://script.google.com/macros/s/…/exec', value: apiUrl() });
    var form = h('form', { class: 'card login', onsubmit: function (e) {
      e.preventDefault();
      if (url.value.trim()) lsSet(LS_API, url.value.trim());
      run('Вхожу…', api('login', { password: pw.value })).then(function (d) {
        app.token = d.token;
        ssSet(SS_TOKEN, d.token);
        return load();
      });
    } }, [
      h('h2', { text: 'Вход' }),
      h('label', { text: 'Пароль' }), pw,
      h('details', { open: apiUrl() ? null : 'open' }, [h('summary', { text: 'Адрес сервера (Apps Script)' }), url,
        h('p', { class: 'hint', text: 'Ссылка веб-приложения из Apps Script, заканчивается на /exec. Указывается один раз на этом компьютере.' })]),
      h('button', { type: 'submit', class: 'primary', text: 'Войти' })
    ]);
    main.appendChild(form);
    pw.focus();
  }

  // ---------- Вкладки ----------
  var TABS = [
    ['input', 'Ввод'], ['tariffs', 'Тарифы'], ['accrual', 'Начисление'], ['overlimit', 'Сверхлимит'],
    ['planfact', 'План-факт'], ['details', 'Детали'], ['kosht', 'Кошторис'], ['docs', 'Приказ и Excel'], ['settings', 'Настройки']
  ];

  function render() {
    var tabs = $('#tabs');
    tabs.innerHTML = '';
    TABS.forEach(function (t) {
      tabs.appendChild(h('button', { class: 'tab' + (app.view === t[0] ? ' active' : ''), text: t[1],
        onclick: function () { app.view = t[0]; render(); } }));
    });
    tabs.appendChild(h('button', { class: 'tab logout', text: 'Выйти', onclick: logout }));
    var main = $('#main');
    main.innerHTML = '';
    var fn = { input: renderInput, kosht: renderKosht, docs: renderDocs, settings: renderSettings }[app.view];
    if (fn) fn(main); else renderReport(main, app.view);
  }

  function zkSelect(value, onChange, withAll) {
    var s = h('select', { onchange: function () { onChange(s.value); } });
    (withAll ? ['Все'] : []).concat(ZK_ORDER).forEach(function (z) { s.appendChild(h('option', { value: z, text: z, selected: z === value ? 'selected' : null })); });
    return s;
  }

  // ---------- Ввод ----------
  var INPUT_COLS = [
    ['bill', 'Счёт поставщика, грн', 'money'], ['ol', 'в т.ч. сверхлимит, грн', 'money'], ['gas', 'Газ, тыс. м³', 'num4'],
    ['gkalHouse', 'Гкал ОДПУ (Гавайи)', 'num3'], ['areaTotal', 'Площадь итого, м²', 'money'], ['areaSpch', 'Площадь СПЧ, м²', 'money'],
    ['areaNo', 'Площадь без сч., м²', 'money'], ['gkMeter', 'Гкал кв. счётчиков', 'num4']
  ];

  function renderInput(main) {
    var rows = (app.dataset === 'plan' ? app.data.plan : app.data.fact).filter(function (r) { return r.zk === app.zk; });
    var byMonth = {};
    rows.forEach(function (r) { byMonth[r.month] = r; });
    var bar = h('div', { class: 'bar' }, [
      h('div', { class: 'seg' }, [['fact', 'Факт'], ['plan', 'План']].map(function (d) {
        return h('button', { class: app.dataset === d[0] ? 'on' : '', text: d[1], onclick: function () { app.dataset = d[0]; render(); } });
      })),
      zkSelect(app.zk, function (v) { app.zk = v; render(); }),
      h('span', { class: 'hint', text: app.dataset === 'fact' ? 'Факт — по счетам поставщика. Пустой месяц считается по плану.' :
        'План — данные, по которым утверждается приказ.' })
    ]);
    main.appendChild(bar);
    var thead = h('tr', {}, [h('th', { text: 'Месяц' })].concat(INPUT_COLS.map(function (c) { return h('th', { text: c[1] }); }))
      .concat([h('th', { text: 'Со счётчиками, м²' }), h('th', { text: 'Примечание' }), h('th', { text: 'Статус' })]));
    var tbody = h('tbody');
    ENGINE_MONTHS.forEach(function (m) {
      var r = byMonth[m] || { month: m, zk: app.zk, status: 'план' };
      var closedRow = r.status === 'закрыт';
      var tr = h('tr', { 'data-month': m });
      tr.appendChild(h('td', { class: 'lbl', text: m }));
      INPUT_COLS.forEach(function (c) {
        tr.appendChild(h('td', {}, [h('input', { class: 'num', 'data-f': c[0], value: r[c[0]] === '' || r[c[0]] === undefined ? '' : String(r[c[0]]).replace('.', ','),
          disabled: closedRow ? 'disabled' : null, inputmode: 'decimal', oninput: updateMeterArea })]));
      });
      tr.appendChild(h('td', { class: 'calc', 'data-meter': '1' }));
      tr.appendChild(h('td', {}, [h('input', { 'data-f': 'note', value: r.note || '', disabled: closedRow ? 'disabled' : null })]));
      var st = h('td', { class: 'st' });
      if (app.dataset === 'fact') {
        if (closedRow) st.appendChild(h('button', { class: 'small', text: '🔒 Открыть', onclick: function () { reopenMonth(app.zk, m); } }));
        else st.appendChild(h('button', { class: 'small', text: 'Закрыть месяц', onclick: function () { closeMonth(app.zk, m); } }));
      } else st.textContent = 'план';
      tr.appendChild(st);
      tbody.appendChild(tr);
    });
    // Итого за сезон по суммируемым колонкам (счёт, сверхлимит, газ) — пересчитывается при вводе
    var TOTAL_COLS = ['bill', 'ol', 'gas'];
    var totalCells = {};
    var tfootRow = h('tr', { class: 'total' }, [h('td', { class: 'lbl', text: 'Итого' })].concat(INPUT_COLS.map(function (c) {
      var td = h('td', { class: 'n' });
      if (TOTAL_COLS.indexOf(c[0]) >= 0) totalCells[c[0]] = td;
      return td;
    })).concat([h('td'), h('td'), h('td')]));
    var table = h('table', { class: 'grid input' }, [h('thead', {}, [thead]), tbody, h('tfoot', {}, [tfootRow])]);
    main.appendChild(h('div', { class: 'scroll' }, [table]));
    function updateMeterArea() {
      var sums = { bill: 0, ol: 0, gas: 0 };
      Array.prototype.forEach.call(tbody.children, function (tr) {
        var g = function (f) { return engineNum($('input[data-f="' + f + '"]', tr).value); };
        var v = g('areaTotal') - g('areaSpch') - g('areaNo');
        var cell = $('[data-meter]', tr);
        cell.textContent = g('areaTotal') ? fmt(v, 'money') : '';
        cell.className = 'calc' + (v < -0.5 ? ' err' : '');
        TOTAL_COLS.forEach(function (f) { sums[f] += g(f); });
      });
      totalCells.bill.textContent = fmt(sums.bill, 'money');
      totalCells.ol.textContent = fmt(sums.ol, 'money');
      totalCells.gas.textContent = fmt(sums.gas, 'num4');
    }
    updateMeterArea();
    main.appendChild(h('div', { class: 'bar' }, [
      h('button', { class: 'primary', text: 'Сохранить ' + (app.dataset === 'fact' ? 'факт' : 'план') + ' · ' + app.zk, onclick: function () {
        var list = app.dataset === 'plan' ? app.data.plan : app.data.fact;
        Array.prototype.forEach.call(tbody.children, function (tr) {
          var m = tr.getAttribute('data-month');
          var row = list.filter(function (r) { return r.zk === app.zk && r.month === m; })[0];
          if (!row) { row = { month: m, zk: app.zk, status: 'план' }; list.push(row); }
          if (row.status === 'закрыт') return;
          INPUT_COLS.forEach(function (c) {
            var v = $('input[data-f="' + c[0] + '"]', tr).value.trim();
            row[c[0]] = v === '' ? '' : engineNum(v);
          });
          row.note = $('input[data-f="note"]', tr).value;
        });
        run('Сохраняю…', api('saveRows', { dataset: app.dataset, rows: list })).then(function () {
          recompute(); render(); toast('Сохранено');
        });
      } }),
      h('span', { class: 'hint', text: 'Газ — в тыс. м³, как в счетах Одесагаза. «Со счётчиками» = итого − СПЧ − без счётчиков.' })
    ]));
    // мини-итог по ЖК
    var calc = app.calc.workCalc.filter(function (r) { return r.zk === app.zk; });
    main.appendChild(tableEl({
      title: 'Результат по ' + app.zk + ' (рабочие данные)', headers: ['Месяц', 'Данные', 'Цена Гкал', 'Без сч., грн/м²', 'СПЧ, грн/м²', 'Начислено газ, грн', 'Статус'],
      formats: ['text', 'text', 'tariff', 'tariff', 'tariff', 'money', 'text'],
      rows: calc.map(function (r) { return [r.month, r.source, r.price, r.tNo, r.tSpch, r.charged, r.status2]; })
    }));
  }

  function closeMonth(zk, month) {
    var r = app.calc.workCalc.filter(function (x) { return x.zk === zk && x.month === month; })[0];
    if (!r || r.source !== 'факт') { toast('Закрыть можно только месяц с введённым фактом', true); return; }
    if (r.isError) { toast('В месяце ошибка: ' + r.status2, true); return; }
    if (!confirm('Закрыть ' + zk + ' · ' + month + '? Тарифы месяца зафиксируются в журнале.')) return;
    var entries = (app.data.journal || []).filter(function (j) { return !(j.zk === zk && j.month === month); });
    entries.push({ zk: zk, month: month, price: r.price, tNo: r.tNo, tSpch: r.tSpch,
      charged: r.tNo * r.areaNo + r.tSpch * r.areaSpch, date: new Date().toISOString() });
    setStatus(zk, month, 'закрыт');
    run('Закрываю месяц…', api('saveJournal', { entries: entries }).then(function () {
      return api('saveRows', { dataset: 'fact', rows: app.data.fact });
    })).then(function () { app.data.journal = entries; recompute(); render(); toast('Месяц закрыт'); });
  }

  function reopenMonth(zk, month) {
    if (!confirm('Открыть ' + zk + ' · ' + month + '? Тарифы будут пересчитаны.')) return;
    var entries = (app.data.journal || []).filter(function (j) { return !(j.zk === zk && j.month === month); });
    setStatus(zk, month, 'план');
    run('Открываю месяц…', api('saveJournal', { entries: entries }).then(function () {
      return api('saveRows', { dataset: 'fact', rows: app.data.fact });
    })).then(function () { app.data.journal = entries; recompute(); render(); toast('Месяц открыт'); });
  }

  function setStatus(zk, month, status) {
    app.data.fact.forEach(function (r) { if (r.zk === zk && r.month === month) r.status = status; });
  }

  // ---------- Таблицы отчётов ----------
  function tableEl(t, filterRow) {
    var wrap = h('section', { class: 'card' });
    wrap.appendChild(h('h3', { text: t.title }));
    if (t.note) wrap.appendChild(h('p', { class: 'hint', text: t.note }));
    var thead = h('tr', {}, t.headers.map(function (x) { return h('th', { text: x }); }));
    var tbody = h('tbody');
    t.rows.forEach(function (r, i) {
      var tr = h('tr');
      r.forEach(function (v, c) {
        var f = t.formats[c] === 'x' && t.rowFormats ? t.rowFormats[i] : t.formats[c];
        var cls = typeof v === 'number' ? 'n' : '';
        if (typeof v === 'string' && v.indexOf('ОШИБКА') === 0) cls = 'err';
        else if (typeof v === 'string' && v.indexOf('проверьте') >= 0) cls = 'warn';
        else if (typeof v === 'string' && v.indexOf('✓') === 0) cls = 'ok';
        tr.appendChild(h('td', { class: cls, text: fmt(v, f) }));
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(h('div', { class: 'scroll' }, [h('table', { class: 'grid' }, [h('thead', {}, filterRow ? [thead, filterRow] : [thead]), tbody])]));
    return wrap;
  }

  // Фильтры отчётов: { 'id таблицы': { 'номер колонки': значение } }; текстовые колонки фильтруются
  // выбором из списка (Месяц, ЖК, Данные, Показатель…) или поиском по тексту (Статус)
  function filterSpec(t) {
    return t.headers.map(function (hd, c) {
      if (t.formats[c] !== 'text') return null;
      var vals = [];
      t.rows.forEach(function (r) {
        var v = r[c] === null || r[c] === undefined ? '' : String(r[c]);
        if (vals.indexOf(v) < 0) vals.push(v);
      });
      if (c === 0 && t.headers[0].indexOf('Месяц') === 0) {
        vals.sort(function (a, b) { return ENGINE_MONTHS.indexOf(a) - ENGINE_MONTHS.indexOf(b); });
      }
      return vals.length <= 30 && hd !== 'Статус' ? { type: 'select', values: vals } : { type: 'text' };
    });
  }

  function applyFilters(t, f) {
    var keep = [];
    var rows = t.rows.filter(function (r, i) {
      var ok = Object.keys(f).every(function (c) {
        var want = f[c];
        if (want === '' || want === undefined) return true;
        var v = r[c] === null || r[c] === undefined ? '' : String(r[c]);
        return want.charAt(0) === '~' ? v.toLowerCase().indexOf(want.substring(1).toLowerCase()) >= 0 : v === want;
      });
      if (ok) keep.push(i);
      return ok;
    });
    var copy = Object.assign({}, t, { rows: rows });
    if (t.rowFormats) copy.rowFormats = keep.map(function (i) { return t.rowFormats[i]; });
    return copy;
  }

  function renderReport(main, id) {
    var t = app.calc.tables.filter(function (x) { return x.id === id; })[0];
    app.filters = app.filters || {};
    var f = app.filters[id] = app.filters[id] || {};
    var spec = filterSpec(t);
    var shown = applyFilters(t, f);
    var active = Object.keys(f).filter(function (c) { return f[c]; }).length;
    main.appendChild(h('div', { class: 'bar' }, [
      h('span', { class: 'hint', text: 'Показано строк: ' + shown.rows.length + ' из ' + t.rows.length +
        (active ? ' · фильтров: ' + active : ' · фильтры — в строке под заголовками') }),
      active ? h('button', { text: 'Сбросить фильтры', onclick: function () { app.filters[id] = {}; render(); } }) : null,
      h('button', { text: 'Эта таблица в Excel', onclick: function () {
        window.XLSX.writeFile(exportWorkbook([shown], window.XLSX), 'КОІН_' + t.title.substring(0, 40).replace(/[^\wА-Яа-яІіЇїЄєҐґ]+/g, '_') + '.xlsx');
      } }),
      h('button', { text: 'Скачать всё в Excel', onclick: downloadExcel })
    ]));
    var filterRow = h('tr', { class: 'filters' }, spec.map(function (sp, c) {
      if (!sp) return h('th');
      if (sp.type === 'select') {
        var s = h('select', { 'aria-label': 'Фильтр: ' + t.headers[c], onchange: function () { f[c] = s.value; render(); } },
          [h('option', { value: '', text: 'Все' })].concat(sp.values.map(function (v) {
            return h('option', { value: v, text: v || '(пусто)', selected: f[c] === v ? 'selected' : null });
          })));
        return h('th', {}, [s]);
      }
      var inp = h('input', { type: 'search', placeholder: 'поиск…', 'aria-label': 'Поиск: ' + t.headers[c],
        value: f[c] ? f[c].substring(1) : '', onchange: function () { f[c] = inp.value ? '~' + inp.value : ''; render(); } });
      return h('th', {}, [inp]);
    }));
    main.appendChild(tableEl(shown, filterRow));
    if (TABLE_LEGENDS[id]) {
      main.appendChild(h('section', { class: 'card' }, [h('h3', { text: 'Что в колонках' }),
        h('dl', { class: 'legend' }, TABLE_LEGENDS[id].reduce(function (acc, x) {
          return acc.concat([h('dt', { text: x[0] }), h('dd', { text: x[1] })]);
        }, []))]));
    }
  }

  var TABLE_LEGENDS = {
    overlimit: [
      ['План: в счёте', 'Сверхлимит, который по плану сидит в счёте поставщика этого месяца (обычно весь — в марте).'],
      ['План: начислено в тарифах', 'Сколько сверхлимита по плану включено в тарифы этого месяца: надбавка μ × Гкал по квартирным счётчикам + добавка сглаживания на квартиры без счётчиков и СПЧ.'],
      ['План: в счетах нараст.', 'Сверхлимит в счетах нарастающим итогом с ноября.'],
      ['План: начислено нараст.', 'Начисленный в тарифах сверхлимит нарастающим итогом с ноября. К марту равен сверхлимиту сезона.'],
      ['Рабочие: …', 'То же по рабочим данным: факт там, где счёт уже введён, иначе план (см. колонку «Данные»).'],
      ['Осталось разнести', 'Сверхлимит сезона минус уже начисленный нарастающим итогом: сколько ещё войдёт в тарифы следующих месяцев. В марте — 0.'],
      ['Данные', '«факт» — месяц посчитан по введённому счёту, «план» — по плановым данным.']
    ],
    tariffs: [
      ['Содержание котельной', 'Тариф кошториса, грн/м²; в ноябре — 50 %.'],
      ['Газ по счётчику', 'Цена 1 Гкал для квартир с распределительными счётчиками (с надбавкой сверхлимита).'],
      ['Газ без счётчика / СПЧ', 'Тариф за 1 м² для квартир без счётчиков и для отключённых (СПЧ, коэффициент из Настроек).'],
      ['Расчётно начислено', 'Цена Гкал × Гкал счётчиков + тариф без счётчика × площадь без счётчиков + тариф СПЧ × площадь СПЧ.'],
      ['Расхождение', 'Начислено минус база месяца (счёт без сверхлимита + сверхлимит, отнесённый на месяц); только округление.']
    ],
    accrual: [
      ['Котельная', 'Тариф кошториса × площадь × доля месяца (ноябрь 50 %). План — зафиксированный кошторис, факт — последняя загрузка смет.'],
      ['Газ, норматив, счёт', 'Объём газа (тыс. м³), норматив тепла (Гкал), счёт поставщика: план, факт и отклонение.'],
      ['Начислено газ', 'Сумма начислений жильцам по газовым тарифам месяца.'],
      ['Δ', 'Факт минус план; показывается только для месяцев с введённым фактом.']
    ]
  };

  // ---------- Кошторис ----------
  function renderKosht(main) {
    var ctx = app.ctx;
    var info = h('section', { class: 'card' }, [
      h('h3', { text: 'Кошторис содержания котельной' }),
      h('p', { class: 'hint', text: 'Статьи берутся из помесячных колонок «факт» сметы каждого ЖК (файл «Отопление сезон 2026/27.xlsx» на Диске). Строки налогов (ЕН, НДС) и газ не входят; услуги с НДС × 5/6; НДС 20 % сверху. Тариф = смета с НДС за сезон ÷ площадь ÷ 4,5; ноябрь — 50 %.' }),
      h('div', { class: 'bar' }, [
        h('button', { class: 'primary', text: 'Загрузить сметы из файла', onclick: importSmeta }),
        h('button', { text: 'Зафиксировать кошторис как план', onclick: function () { fixPlan(false); } }),
        h('span', { class: 'hint', text: ctx.planFixedAt ? 'План зафиксирован ' + new Date(ctx.planFixedAt).toLocaleString('uk-UA') : 'План кошториса ещё не зафиксирован — план = факт.' })
      ])
    ]);
    main.appendChild(info);
    var sum = { title: 'Тарифы содержания котельной', headers: ['ЖК', 'Площадь, м²', 'Смета з ПДВ за сезон, грн', 'Тариф факт, грн/м²', 'Тариф план, грн/м²', 'Смета загружена'],
      formats: ['text', 'money', 'money', 'tariff', 'tariff', 'text'],
      rows: ZK_ORDER.map(function (zk) {
        var k = ctx.koshtFact[zk], p = ctx.koshtPlan[zk], sm = store('smeta_' + zk, null);
        return [zk, k ? k.area : '', k ? k.season.gross : '', k ? k.tariff : '', p ? p.tariff : '',
          sm ? new Date(sm.importedAt).toLocaleString('uk-UA') + ' · лист ' + sm.sheet : 'не загружена'];
      }) };
    main.appendChild(tableEl(sum));
    main.appendChild(h('div', { class: 'bar' }, [zkSelect(app.zk, function (v) { app.zk = v; render(); })]));
    var k = ctx.koshtFact[app.zk];
    if (k) main.appendChild(tableEl(repKoshtTable(app.zk, k)));
    // Ручные добавки
    var manual = JSON.parse(JSON.stringify(ctx.manual || {}));
    var mz = manual[app.zk] = manual[app.zk] || {};
    var tb = h('tbody');
    KOSHT_ARTICLES.filter(function (a) { return !a.group; }).forEach(function (a) {
      var tr = h('tr', {}, [h('td', { class: 'lbl', text: a.num + ' ' + a.title })]);
      for (var i = 0; i < 5; i++) {
        (function (i) {
          var v = (mz[a.key] || [])[i];
          tr.appendChild(h('td', {}, [h('input', { class: 'num', value: v ? String(v).replace('.', ',') : '', inputmode: 'decimal',
            onchange: function (e) { mz[a.key] = mz[a.key] || [0, 0, 0, 0, 0]; mz[a.key][i] = engineNum(e.target.value); } })]));
        })(i);
      }
      tb.appendChild(tr);
    });
    main.appendChild(h('section', { class: 'card' }, [
      h('h3', { text: 'Ручные добавки к кошторису — ' + app.zk + ' (грн без ПДВ)' }),
      h('p', { class: 'hint', text: 'Например, «добавка на фонарь» в накладные. Прибавляется к сумме из сметы.' }),
      h('div', { class: 'scroll' }, [h('table', { class: 'grid input' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Статья' })].concat(ENGINE_MONTHS.map(function (m) { return h('th', { text: m }); })))]), tb])]),
      h('button', { class: 'primary', text: 'Сохранить добавки', onclick: function () { saveStore('manual', manual); } })
    ]));
  }

  function importSmeta() {
    var ctx = app.ctx;
    if (!ctx.sourceFileId) {
      toast('Укажите ID файла со сметами: «Настройки» → «Сметы: файл и соответствие строк»', true);
      return;
    }
    var sheets = Object.keys(ctx.mapping).map(function (zk) {
      var m = ctx.mapping[zk];
      return { zk: zk, sheet: m.sheet, novCol: m.novCol, areaCell: m.areaCell };
    });
    run('Читаю сметы из файла на Диске…', api('importSmeta', { fileId: ctx.sourceFileId, sheets: sheets })).then(function (d) {
      Object.keys(d.smeta).forEach(function (zk) { app.data.store['smeta_' + zk] = d.smeta[zk]; });
      recompute(); render();
      toast(d.log.join(' · '));
    });
  }

  function fixPlan(withRows) {
    var msg = withRows ? 'Рабочие данные (факт, где есть, иначе план) и текущий кошторис станут планом. Продолжить?' :
      'Текущий кошторис станет плановым. Продолжить?';
    if (!confirm(msg)) return;
    var p = Promise.resolve();
    if (withRows) {
      var merged = repMerge(app.data.plan, app.data.fact).map(function (r) {
        var c = Object.assign({}, r); delete c.source; c.status = 'план'; return c;
      });
      p = api('saveRows', { dataset: 'plan', rows: merged }).then(function () { app.data.plan = merged; });
    }
    var snap = { fixedAt: new Date().toISOString(), kosht: app.ctx.koshtFact };
    run('Фиксирую план…', p.then(function () { return api('saveStore', { key: 'koshtPlan', value: snap }); })).then(function () {
      app.data.store.koshtPlan = snap; recompute(); render(); toast('План зафиксирован');
    });
  }

  // ---------- Приказ и Excel ----------
  function downloadExcel() {
    var tables = app.calc.tables.concat(Object.keys(app.ctx.koshtFact).map(function (zk) { return repKoshtTable(zk, app.ctx.koshtFact[zk]); }));
    var wb = exportWorkbook(tables, window.XLSX);
    var d = new Date();
    var stamp = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    window.XLSX.writeFile(wb, 'КОІН_Опалення_' + stamp + '.xlsx');
  }

  function renderDocs(main) {
    var zkSel = zkSelect(app.zk, function (v) { app.zk = v; });
    var monthSel = h('select', {}, ORDER_MONTHS.map(function (m, i) { return h('option', { value: i, text: m.label }); }));
    var num = h('input', { placeholder: '___', size: 6 });
    var day = h('input', { placeholder: '___', size: 4 });
    var start = h('input', { placeholder: 'напр. 15.11.2026' });
    main.appendChild(h('section', { class: 'card' }, [
      h('h3', { text: 'Приказ с кошторисом (Word)' }),
      h('p', { class: 'hint', text: 'Тарифы — по рабочим данным: факт там, где он введён, иначе план (в Додатку 2 помечено). П. 1.3 «аванс» — только в приказе за листопад, «перерахунок» — только за квітень; суммы вписываются вручную.' }),
      h('div', { class: 'form' }, [
        h('label', { text: 'ЖК' }), zkSel,
        h('label', { text: 'Місяць наказу' }), monthSel,
        h('label', { text: 'Номер наказу' }), num,
        h('label', { text: 'Число' }), day,
        h('label', { text: 'Початок опалювального сезону' }), start
      ]),
      h('button', { class: 'primary', text: 'Скачать приказ .docx', onclick: function () {
        var zk = app.zk = zkSel.value;
        var k = app.ctx.koshtFact[zk];
        if (!k) { toast('Для ' + zk + ' не загружена смета — вкладка «Кошторис» → «Загрузить сметы из файла»', true); return; }
        var rows = app.calc.workCalc.filter(function (r) { return r.zk === zk; });
        var doc = orderDocument({ req: app.ctx.requisites[zk], k: k, rows: rows, settings: app.ctx.settings,
          opts: { orderMonth: Number(monthSel.value), number: num.value.trim(), day: day.value.trim(), startDate: start.value.trim() } }, window.docx);
        window.docx.Packer.toBlob(doc).then(function (blob) { download(blob, orderFileName(zk, Number(monthSel.value))); });
      } })
    ]));
    main.appendChild(h('section', { class: 'card' }, [
      h('h3', { text: 'Excel' }),
      h('p', { class: 'hint', text: 'Все отчёты (тарифы, начисление, сверхлимит, план-факт, детали) и кошторисы по ЖК — отдельными листами.' }),
      h('button', { class: 'primary', text: 'Скачать отчёт .xlsx', onclick: downloadExcel })
    ]));
    main.appendChild(h('section', { class: 'card' }, [
      h('h3', { text: 'План' }),
      h('p', { class: 'hint', text: 'При утверждении приказа зафиксируйте план: текущие данные и кошторис станут базой для план-факта.' }),
      h('button', { text: 'Зафиксировать план (данные + кошторис)', onclick: function () { fixPlan(true); } })
    ]));
  }

  // ---------- Настройки ----------
  function renderSettings(main) {
    var S = JSON.parse(JSON.stringify(app.ctx.settings));
    var fields = [
      ['kcal', 'Коэффициент калорийности, Гкал/м³'], ['fso', 'ФСО, доля'], ['mzk', 'МЗК, доля'], ['kSpch', 'Коэффициент СПЧ'],
      ['digitsArea', 'Округление тарифов за м², знаков'], ['digitsPrice', 'Округление цены Гкал, знаков'],
      ['tol', 'Допустимое расхождение, грн'], ['tolArea', 'Допуск площадей, м²'], ['lag', 'Лаг начисления, мес.'],
      ['lowBound', 'Коридор: нижняя граница (доля)'], ['highBound', 'Коридор: верхняя граница (кратно)'],
      ['gasMult', 'Множитель газа (м³ в единице ввода)'], ['fixedPrice', 'Цена Гкал покупного тепла (Гавайи)'],
      ['smoothingOn', 'Сглаживание включено (1/0)']
    ];
    var form = h('div', { class: 'form' });
    fields.forEach(function (f) {
      form.appendChild(h('label', { text: f[1] }));
      form.appendChild(h('input', { value: String(S[f[0]]).replace('.', ','), onchange: function (e) { S[f[0]] = engineNum(e.target.value); } }));
    });
    ENGINE_MONTHS.forEach(function (m, i) {
      form.appendChild(h('label', { text: 'Вес профиля: ' + m }));
      form.appendChild(h('input', { value: String(S.weights[i]).replace('.', ','), onchange: function (e) { S.weights[i] = engineNum(e.target.value); } }));
    });
    var modes = h('tbody');
    ZK_ORDER.forEach(function (zk) {
      var z = S.zk[zk] = S.zk[zk] || { smoothRest: 'нет', olProfile: 'по профилю' };
      var sel = function (key, opts) {
        var s = h('select', { onchange: function () { z[key] = s.value; } }, opts.map(function (o) { return h('option', { value: o, text: o, selected: z[key] === o ? 'selected' : null }); }));
        return s;
      };
      modes.appendChild(h('tr', {}, [h('td', { class: 'lbl', text: zk }), h('td', {}, [sel('smoothRest', ['нет', 'по профилю'])]),
        h('td', {}, [sel('olProfile', ['по профилю', 'пропорционально'])])]));
    });
    main.appendChild(h('section', { class: 'card' }, [h('h3', { text: 'Параметры методики' }), form,
      h('h4', { text: 'Режимы сглаживания по ЖК' }),
      h('table', { class: 'grid' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'ЖК' }), h('th', { text: 'Сглаживание остатка по сезону' }), h('th', { text: 'Распределение сверхлимита' })])]), modes]),
      h('button', { class: 'primary', text: 'Сохранить параметры', onclick: function () { saveStore('engine', S); } })]));

    // Реквизиты
    var R = JSON.parse(JSON.stringify(app.ctx.requisites));
    var rq = h('div');
    ZK_ORDER.forEach(function (zk) {
      var r = R[zk] = R[zk] || {};
      var f = h('div', { class: 'form' });
      [['name', 'Назва в наказі'], ['address', 'Адреса'], ['company', 'Юридична особа'], ['edrpou', 'ЄДРПОУ'], ['director', 'Директор'], ['source', 'Джерело теплопостачання']]
        .forEach(function (x) {
          f.appendChild(h('label', { text: x[1] }));
          f.appendChild(h('input', { value: r[x[0]] || '', onchange: function (e) { r[x[0]] = e.target.value; } }));
        });
      rq.appendChild(h('h4', { text: zk }));
      rq.appendChild(f);
    });
    main.appendChild(h('section', { class: 'card' }, [h('h3', { text: 'Реквизиты для приказа' }), rq,
      h('button', { class: 'primary', text: 'Сохранить реквизиты', onclick: function () { saveStore('requisites', R); } })]));

    // Сметы
    var src = h('input', { value: app.ctx.sourceFileId, size: 50 });
    var mapArea = h('textarea', { rows: 14, spellcheck: 'false' });
    mapArea.value = JSON.stringify(app.ctx.mapping, null, 1);
    main.appendChild(h('section', { class: 'card' }, [h('h3', { text: 'Сметы: файл и соответствие строк' }),
      h('div', { class: 'form' }, [h('label', { text: 'ID файла «Отопление сезон 2026/27.xlsx»' }), src]),
      h('p', { class: 'hint', text: 'ID — часть ссылки на файл между /d/ и /edit (docs.google.com/spreadsheets/d/<ID>/edit).' }),
      h('button', { text: 'Сохранить ID файла', onclick: function () { saveStore('sourceFileId', src.value.trim()); } }),
      h('p', { class: 'hint', text: 'Соответствие: для каждого ЖК — лист сметы, колонка ноября, ячейка площади, и для каждой статьи список [номер строки, множитель]. 0,8333 = 5/6 (убрать НДС), 0,01 = налог на прибыль 1 %. Можно задать "area" — площадь вручную.' }),
      mapArea,
      h('button', { text: 'Сохранить соответствие', onclick: function () {
        try { saveStore('mapping', JSON.parse(mapArea.value)); } catch (e) { toast('Ошибка в JSON: ' + e.message, true); }
      } }),
      h('button', { text: 'Вернуть соответствие по умолчанию', onclick: function () { saveStore('mapping', koshtDefaultMapping()); } })]));

    // Доступ
    var oldPw = h('input', { type: 'password', autocomplete: 'current-password' });
    var newPw = h('input', { type: 'password', autocomplete: 'new-password' });
    var url = h('input', { value: apiUrl(), size: 60 });
    main.appendChild(h('section', { class: 'card' }, [h('h3', { text: 'Доступ' }),
      h('div', { class: 'form' }, [h('label', { text: 'Текущий пароль' }), oldPw, h('label', { text: 'Новый пароль' }), newPw]),
      h('button', { text: 'Сменить пароль', onclick: function () {
        run('Меняю пароль…', api('changePassword', { oldPassword: oldPw.value, newPassword: newPw.value })).then(function () { toast('Пароль изменён'); oldPw.value = newPw.value = ''; });
      } }),
      h('div', { class: 'form' }, [h('label', { text: 'Адрес API (Apps Script, на этом компьютере)' }), url]),
      h('button', { text: 'Сохранить адрес', onclick: function () { lsSet(LS_API, url.value.trim()); toast('Адрес сохранён'); } }),
      app.data.dbUrl ? h('p', { class: 'hint' }, ['Данные хранятся в Google-таблице: ', h('a', { href: app.data.dbUrl, target: '_blank', rel: 'noopener', text: 'открыть' })]) : null]));
  }

  // ---------- Старт ----------
  document.addEventListener('DOMContentLoaded', function () {
    app.token = ssGet(SS_TOKEN);
    if (app.token && apiUrl()) load().catch(function () { renderLogin(); });
    else renderLogin();
  });
})();
