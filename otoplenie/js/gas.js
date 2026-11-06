/**
 * Газ по сезонному лимиту: счёт поставщика и сверхлимит из объёма газа.
 * Правило (ответ 1а): лимит сезонный; пока накопленный с ноября объём не превысил лимит — газ по льготной цене,
 * в месяце перехода — частично, дальше — по коммерческой цене. Прочие суммы (например, потери) — к сверхлимиту месяца.
 *
 * План: счёт и сверхлимит считаются из объёма. Рабочие данные: месяцы с фактом берутся из счёта (с проверкой),
 * месяцы без факта — прогноз от фактического накопленного объёма. Движок тарифов (engine.js) не меняется.
 */

function gasDefaultTariffs() {
  return {
    'Лимнос': { mode: 'gas', limit: 163.70933, priceLimit: 8082.6, priceOver: 27785.36,
      extras: [{ month: 'Март', amount: 7631.83, note: 'потери' }] },
    'Атлант': { mode: 'gas', limit: 0, priceLimit: 8082.6, priceOver: 27785.36, extras: [] },
    'Лузановский Парк': { mode: 'gas', limit: 82.40647, priceLimit: 8082.6, priceOver: 27785.36, extras: [] },
    'Гавайи': { mode: 'heat', limit: 0, priceLimit: 0, priceOver: 0, extras: [] }
  };
}

/**
 * Цена сверх лимита месяца i: фактическая цена этого месяца (priceOverByMonth), если введена;
 * иначе последняя введённая цена предыдущих месяцев (прогноз по свежей цене); иначе базовая priceOver.
 */
function gasPriceOver(t, i) {
  var by = t.priceOverByMonth || [];
  for (var j = i; j >= 0; j--) {
    if (engineNum(by[j]) > 0) return engineNum(by[j]);
  }
  return engineNum(t.priceOver);
}

/** Копия тарифов с ценой сверх лимита, проставленной в каждый месяц (для фиксации плана). */
function gasResolvePrices(tariffs) {
  var out = {};
  Object.keys(tariffs || {}).forEach(function (zk) {
    var t = JSON.parse(JSON.stringify(tariffs[zk]));
    t.priceOverByMonth = ENGINE_MONTHS.map(function (m, i) { return gasPriceOver(tariffs[zk], i); });
    out[zk] = t;
  });
  return out;
}

/** Тарифы применимы к ЖК: газовая котельная с заданной ценой. */
function gasApplies(t) {
  return !!t && t.mode !== 'heat' && (engineNum(t.priceOver) > 0 || (t.priceOverByMonth || []).some(function (x) { return engineNum(x) > 0; }));
}

function gasExtras(t, month) {
  return (t.extras || []).reduce(function (s, e) { return s + (e.month === month ? engineNum(e.amount) : 0); }, 0);
}

/**
 * Разбивка сезона одного ЖК по месяцам. volumes: [тыс. м³ ноя…мар].
 * Возвращает по месяцам { cumBefore, cum, inLimit, over, limitLeft, bill, ol }.
 */
function gasSeason(t, volumes) {
  var limit = engineNum(t.limit), pl = engineNum(t.priceLimit);
  var cum = 0;
  return ENGINE_MONTHS.map(function (m, i) {
    var po = gasPriceOver(t, i);
    var v = Math.max(0, engineNum(volumes[i]));
    var inLimit = Math.max(0, Math.min(v, limit - cum));
    var over = v - inLimit;
    var before = cum;
    cum += v;
    var extra = gasExtras(t, m);
    return {
      month: m, volume: v, cumBefore: before, cum: cum, inLimit: inLimit, over: over, priceOver: po,
      limitLeft: Math.max(0, limit - cum), extra: extra,
      bill: engineRound(inLimit * pl + over * po + extra, 2),
      ol: engineRound(over * po + extra, 2)
    };
  });
}

function gasRowsByZk(rows, zk) {
  var out = [null, null, null, null, null];
  rows.forEach(function (r) {
    var i = ENGINE_MONTHS.indexOf(r.month);
    if (r.zk === zk && i >= 0) out[i] = r;
  });
  return out;
}

function gasCopy(r) {
  var c = {};
  Object.keys(r).forEach(function (k) { c[k] = r[k]; });
  return c;
}

/** План: счёт и сверхлимит каждого месяца — из объёма газа и цен ЖК. */
function gasApplyPlan(planRows, tariffs) {
  var out = planRows.map(gasCopy);
  Object.keys(tariffs || {}).forEach(function (zk) {
    var t = tariffs[zk];
    if (!gasApplies(t)) return;
    var rows = gasRowsByZk(out, zk);
    var season = gasSeason(t, rows.map(function (r) { return r ? r.gas : 0; }));
    rows.forEach(function (r, i) {
      if (!r || !(engineNum(r.gas) > 0)) return;
      r.bill = season[i].bill;
      r.ol = season[i].ol;
      r.gasInfo = season[i];
    });
  });
  return out;
}

/**
 * Рабочие данные (после repMerge): объёмы — факт, где он есть, иначе план; месяцы-план получают счёт и сверхлимит
 * по накопленному фактическому объёму; месяцы-факт сверяются с расчётом (предупреждение, если счёт не сходится).
 */
function gasApplyWork(workRows, tariffs) {
  var out = workRows.map(gasCopy);
  Object.keys(tariffs || {}).forEach(function (zk) {
    var t = tariffs[zk];
    if (!gasApplies(t)) return;
    var rows = gasRowsByZk(out, zk);
    var season = gasSeason(t, rows.map(function (r) { return r ? r.gas : 0; }));
    rows.forEach(function (r, i) {
      if (!r) return;
      var s = season[i];
      r.gasInfo = s;
      if (!(engineNum(r.gas) > 0)) return;
      if (r.source === 'факт') {
        var tolBill = Math.max(100, 0.01 * s.bill);
        var bill = engineNum(r.bill), ol = engineNum(r.ol);
        if (Math.abs(bill - s.bill) > tolBill || Math.abs(ol - s.ol) > Math.max(100, 0.01 * s.ol)) {
          r.warn = 'счёт по объёму и ценам: ' + engineFmt(s.bill, 2) + ' грн, в т.ч. сверхлимит ' + engineFmt(s.ol, 2) +
            ' (льгота ' + engineFmt(s.inLimit, 4) + ' × ' + engineFmt(t.priceLimit, 2) + ' + сверх ' + engineFmt(s.over, 4) +
            ' × ' + engineFmt(s.priceOver, 2) + (s.extra ? ' + прочие ' + engineFmt(s.extra, 2) : '') +
            ') — введено ' + engineFmt(bill, 2) + ' / ' + engineFmt(ol, 2) + '; проверьте счёт или цены';
        }
      } else {
        r.bill = s.bill;
        r.ol = s.ol;
      }
    });
  });
  return out;
}
