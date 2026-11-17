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
      limitMonths: [15.70933, 36, 43, 36, 33], extras: [{ month: 'Март', amount: 7631.83, note: 'потери' }] },
    'Атлант': { mode: 'gas', limit: 0, priceLimit: 8082.6, priceOver: 27785.36, extras: [] },
    'Лузановский Парк': { mode: 'gas', limit: 82.40647, priceLimit: 8082.6, priceOver: 27785.36,
      limitMonths: [7.40647, 18, 23, 18, 16], extras: [] },
    'Гавайи': { mode: 'heat', limit: 0, priceLimit: 0, priceOver: 0, extras: [] }
  };
}

/** Месячные доли лимита поставщика (тыс. м³, ноя…мар); пусто — нет. */
var GAS_DEFAULT_LIMIT_MONTHS = { 'Лимнос': [15.70933, 36, 43, 36, 33], 'Лузановский Парк': [7.40647, 18, 23, 18, 16] };

/**
 * Режим «сверхлимит по месячной доле лимита» (limitRule = 'month'): всё, что сожгли сверх накопленной доли лимита
 * (неиспользованная доля переносится на следующие месяцы), начисляется жильцам сразу по цене сверх лимита.
 * Поставщик выставляет сверхлимит позже (по сезонному лимиту) — разница копится в резерве; в конце сезона перерасчёт.
 */
function gasMonthRule(t) {
  if (!t || t.limitRule !== 'month') return false;
  return (t.limitMonths || []).some(function (x) { return engineNum(x) > 0; });
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
  var cum = 0, monthRule = gasMonthRule(t), cumShare = 0, collected = 0;
  return ENGINE_MONTHS.map(function (m, i) {
    var po = gasPriceOver(t, i);
    var v = Math.max(0, engineNum(volumes[i]));
    var inLimit = Math.max(0, Math.min(v, limit - cum));
    var over = v - inLimit;
    var before = cum;
    cum += v;
    var extra = gasExtras(t, m);
    var out = {
      month: m, volume: v, cumBefore: before, cum: cum, inLimit: inLimit, over: over, priceOver: po,
      limitLeft: Math.max(0, limit - cum), extra: extra,
      bill: engineRound(inLimit * pl + over * po + extra, 2),
      ol: engineRound(over * po + extra, 2)
    };
    if (monthRule) {
      // начисление жильцам: сверх накопленной доли лимита — сразу по цене сверх лимита (собранное не уменьшается)
      cumShare += engineNum((t.limitMonths || [])[i]);
      var need = Math.max(0, cum - cumShare);
      var auto = Math.max(0, need - collected);
      // досбор месяца можно задать вручную (overManual[i], тыс. м³); недобранное перейдёт на следующие месяцы
      var man = (t.overManual || [])[i];
      var manual = man !== '' && man !== undefined && man !== null && !isNaN(Number(man));
      var overV = manual ? Math.max(0, Math.min(engineNum(man), v)) : auto;
      collected += overV;
      out.overAuto = auto;
      out.overIsManual = manual;
      out.collected = collected;
      out.need = need;
      out.share = engineNum((t.limitMonths || [])[i]);
      out.cumShare = cumShare;
      out.overMonth = overV;
      out.vBill = engineRound((v - overV) * pl + overV * po + extra, 2);
      out.vOl = engineRound(overV * po + extra, 2);
    }
    return out;
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

/**
 * Режим месячной доли: тарифы считаются от «начисляемого счёта» (сверх доли — по цене сверх лимита, сразу в месяце),
 * а счёт поставщика сохраняется в billReal/olReal для отчётов (расход, запас, сверхлимит в счетах).
 */
function gasToVirtual(r, s, t) {
  if (!gasMonthRule(t) || s.vBill === undefined) return;
  r.billReal = engineNum(r.bill);
  r.olReal = engineNum(r.ol);
  r.bill = engineRound(r.billReal - s.bill + s.vBill, 2);   // факт: введённый счёт + досбор сверх доли
  r.ol = 0;                                                    // сверхлимит не размазывается — начислен в месяце
  r.olVirtual = s.vOl;
}

/**
 * Режим «в ноль по счёту месяца» (limitRule = 'bill'): сверхлимит и прочие суммы не размазываются по сезону —
 * каждый месяц жильцам начисляется ровно счёт этого месяца. Работает и для газа, и для покупного тепла.
 */
function gasApplyBillRule(rows, tariffs) {
  return rows.map(function (r) {
    var t = (tariffs || {})[r.zk];
    if (!t || t.limitRule !== 'bill') return r;
    var c = gasCopy(r);
    c.billReal = engineNum(c.bill);
    c.olReal = engineNum(c.ol);
    c.olVirtual = c.olReal;     // сверхлимит начислен в своём месяце
    c.ol = 0;
    return c;
  });
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
      gasToVirtual(r, season[i], t);
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
      gasToVirtual(r, s, t);
    });
  });
  return out;
}
