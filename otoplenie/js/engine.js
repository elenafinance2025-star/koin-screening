/**
 * КОІН — движок расчёта тарифов на отопление (методика v4, Методика № 315).
 * Чистые функции без обращения к Google: тот же файл проверяется в Node тестом против Excel v4.
 *
 * Строка ввода (ЖК × месяц):
 *   month, zk, bill (счёт, грн), ol (в т.ч. сверхлимит, грн), gas (тыс. м³), gkalHouse (Гкал ОДПУ),
 *   areaTotal, areaSpch, areaNo (м²; со счётчиками = итого − СПЧ − без счётчиков), gkMeter (Гкал кв. счётчиков),
 *   note, status ('план' | 'закрыт')
 */

var ENGINE_MONTHS = ['Ноябрь', 'Декабрь', 'Январь', 'Февраль', 'Март'];
var ENGINE_YEAR = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь',
  'Ноябрь', 'Декабрь'];

/** Параметры по умолчанию — как на листе НАСТРОЙКИ Excel v4. */
function engineDefaultSettings() {
  return {
    kcal: 0.008364,          // Гкал/м³
    fso: 0.05,
    mzk: 0.10,
    kSpch: 0.5,
    digitsArea: 2,
    digitsPrice: 2,
    tol: 5,
    tolArea: 0.5,
    lag: 1,
    lowBound: 0.5,           // коридор удельного объёма без счётчиков, доля от среднего со счётчиками
    highBound: 3,
    gasMult: 1000,           // газ вводится в тыс. м³
    fixedPrice: 1813.94,     // цена Гкал покупного тепла (Гавайи)
    weights: [0.6, 1, 1, 1, 0.9],
    smoothingOn: 1,          // главный выключатель сглаживания
    zk: {                    // режимы по ЖК
      'Лимнос': { smoothRest: 'нет', olProfile: 'по профилю' },
      'Атлант': { smoothRest: 'по профилю', olProfile: 'по профилю' },
      'Лузановский Парк': { smoothRest: 'нет', olProfile: 'по профилю' },
      'Гавайи': { smoothRest: 'нет', olProfile: 'по профилю' }
    }
  };
}

function engineRound(x, digits) {
  var p = Math.pow(10, digits);
  var y = Math.abs(x) * p;
  var r = Math.round(y + 1e-9 * Math.max(1, y)) / p;
  return x < 0 ? -r : r;
}

function engineNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function engineFmt(x, d) {
  var s = engineRound(x, d).toFixed(d);
  var parts = s.split('.');
  var neg = parts[0].charAt(0) === '-';
  var int = neg ? parts[0].substring(1) : parts[0];
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + int + (d > 0 ? ',' + parts[1] : '');
}

function engineReceiptMonth(month, lag) {
  var i = ENGINE_YEAR.indexOf(month);
  return i < 0 ? '' : ENGINE_YEAR[(i + Math.round(lag || 0)) % 12];
}

/**
 * Расчёт всех строк.
 * journal: { 'ЖК': сумма «Начислено по тарифам» закрытых месяцев } — как ЖУРНАЛ!J в Excel.
 * closed: { 'ЖК|Месяц': {price, tNo, tSpch} } — зафиксированные тарифы закрытых месяцев.
 */
function engineCompute(inputRows, settings, journal, closed) {
  var S = settings || engineDefaultSettings();
  journal = journal || {};
  closed = closed || {};
  var dA = S.digitsArea;
  var dP = S.digitsPrice;
  var rows = inputRows.map(function (src) {
    var r = {
      month: src.month, zk: src.zk, note: src.note || '', status: src.status || 'план', source: src.source || '',
      bill: engineNum(src.bill), ol: engineNum(src.ol), gas: engineNum(src.gas), gkalHouse: engineNum(src.gkalHouse),
      areaTotal: engineNum(src.areaTotal), areaSpch: engineNum(src.areaSpch), areaNo: engineNum(src.areaNo),
      gkMeter: engineNum(src.gkMeter)
    };
    r.areaMeter = r.areaTotal - r.areaSpch - r.areaNo;
    r.monthIdx = ENGINE_MONTHS.indexOf(r.month);
    r.receipt = engineReceiptMonth(r.month, S.lag);
    return r;
  });

  // Поштучные величины (колонки E…V Excel)
  rows.forEach(function (r) {
    r.norm = r.gas > 0 ? r.gas * S.gasMult * S.kcal : (r.gkalHouse > 0 ? r.gkalHouse : 0);         // E
    r.normSrc = r.gas > 0 ? 'газ × коэф.' : (r.gkalHouse > 0 ? 'общедомовой счётчик Гкал' : 'нет');  // F
    r.valid = r.norm > 0 && r.bill > 0;
    r.fsoMzkNorm = (S.fso + S.mzk) * r.norm;                                                         // L
    r.reduced = r.areaNo + S.kSpch * r.areaSpch;                                                     // N
    r.perM2Meter = r.areaMeter > 0 ? r.gkMeter / r.areaMeter : 0;                                    // O
    r.rest = r.norm - r.fsoMzkNorm - r.gkMeter;                                                      // P
    r.volNo = r.valid ? (r.areaMeter === 0 ? r.norm - r.fsoMzkNorm :
      (r.rest < 0 ? r.perM2Meter * r.reduced : r.rest)) : 0;                                        // Q
    r.fsoMzkVol = r.valid ? (r.areaMeter > 0 && r.rest < 0 ? Math.max(0, r.norm - r.gkMeter - r.volNo) :
      r.fsoMzkNorm) : 0;                                                                             // R
    r.fixed = r.valid && !(r.gas > 0) && r.gkalHouse > 0 && S.fixedPrice > 0 ? 1 : 0;                // U
    r.volMonth = r.valid ? r.gkMeter + r.volNo : 0;                                                  // T
    var z = S.zk[r.zk] || {};
    r.smoothRest = S.smoothingOn === 1 && z.smoothRest === 'по профилю' ? 1 : 0;                     // AL
    r.olProfile = S.smoothingOn === 1 && (z.olProfile || 'по профилю') === 'по профилю' ? 1 : 0;     // AM
    r.smoothPrice = S.smoothingOn === 1 && z.smoothPrice === 'одна на сезон' ? 1 : 0;              // доп. режим
    r.weight = r.valid && r.monthIdx >= 0 ? S.weights[r.monthIdx] : 0;                              // W
  });

  // По ЖК: сверхлимит сезона, μ, пул (G…J)
  var groups = {};
  rows.forEach(function (r) { (groups[r.zk] = groups[r.zk] || []).push(r); });
  Object.keys(groups).forEach(function (zk) {
    var g = groups[zk];
    var olSeason = 0, volSeason = 0, fixedSum = 0, areaMeterSum = 0, meterGk = 0;
    g.forEach(function (r) {
      olSeason += r.ol; volSeason += r.volMonth; fixedSum += r.fixed; areaMeterSum += r.areaMeter;
      if (r.volMonth > 0) meterGk += r.gkMeter;
    });
    var mu = fixedSum === 0 && areaMeterSum > 0 && volSeason > 0 ? olSeason / volSeason : 0;        // I
    var pool = olSeason - mu * meterGk;                                                             // J
    g.forEach(function (r) {
      r.olSeason = olSeason; r.volSeason = volSeason; r.mu = mu; r.pool = pool;
      r.costNo = r.valid ? (r.fixed ? r.bill - r.ol - S.fixedPrice * r.gkMeter :
        (r.areaMeter > 0 ? (r.bill - r.ol) / (r.gkMeter + r.volNo) * r.volNo : r.bill - r.ol)) : 0; // K
      r.priceRaw = r.valid ? (r.fixed ? S.fixedPrice :
        (r.areaMeter > 0 ? (r.bill - r.ol) / (r.gkMeter + r.volNo) + mu : 0)) : 0;               // S
      r.t0 = r.valid && r.reduced > 0 ? r.costNo / r.reduced : 0;                                   // V
      r.kink = r.weight > 0 && r.reduced > 0 ? r.t0 / r.weight : null;                              // X
    });
    // Y: сумма добавок в точке перегиба
    g.forEach(function (r) {
      if (r.kink === null) { r.kinkSum = null; return; }
      var s = 0;
      g.forEach(function (q) {
        if (q.weight > 0 && r.kink * q.weight > q.t0) s += q.reduced * (r.kink * q.weight - q.t0);
      });
      r.kinkSum = s;
    });
    // Z: уровень Λ
    var lambda = 0;
    if (pool > 0) {
      var xmax = 0, found = false;
      g.forEach(function (q) {
        if (q.kink !== null && q.kinkSum !== null && q.kinkSum <= pool) {
          if (!found || q.kink > xmax) { xmax = q.kink; found = true; }
        }
      });
      if (!found) xmax = 0;
      var num = pool, den = 0;
      g.forEach(function (q) {
        if (q.weight > 0 && xmax * q.weight >= q.t0 - 1e-9) {
          num += q.reduced * q.t0;
          den += q.reduced * q.weight;
        }
      });
      lambda = den > 0 ? num / den : 0;
    }
    var costNoSum = 0;
    g.forEach(function (q) { costNoSum += q.costNo; });
    g.forEach(function (r) {
      r.lambda = lambda;
      r.addSmooth = (pool <= 0 || r.reduced === 0 || r.weight === 0) ? 0 :
        (r.olProfile === 1 ? r.reduced * Math.max(0, lambda * r.weight - r.t0) :
          (costNoSum !== 0 ? pool * r.costNo / costNoSum : 0));                                      // AA
    });
    // Сглаживание тарифа без счётчика по сезону (AC/AD, ветка AL=1)
    var totalNo = 0, denOpen = 0;
    g.forEach(function (q) {
      totalNo += q.costNo + q.addSmooth;
      if (q.status !== 'закрыт') denOpen += q.reduced * q.weight;
    });
    var restAfterJournal = totalNo - (journal[zk] || 0);
    // Одна цена Гкал на сезон для квартир со счётчиками (режим «одна на сезон»; не для покупного тепла):
    // P = (стоимость Гкал счётчиков за сезон − уже начисленное в закрытых месяцах) ÷ Гкал счётчиков открытых месяцев
    var flatPrice = null;
    if (g.some(function (q) { return q.smoothPrice === 1; }) && !g.some(function (q) { return q.fixed === 1; })) {
      var meterCost = 0, closedMeter = 0, openGk = 0;
      g.forEach(function (q) {
        if (!(q.valid && q.areaMeter > 0)) return;
        meterCost += q.priceRaw * q.gkMeter;
        var c = closed[q.zk + '|' + q.month];
        if (q.status === 'закрыт' && c) closedMeter += c.price * q.gkMeter;
        else openGk += q.gkMeter;
      });
      if (openGk > 0) flatPrice = engineRound((meterCost - closedMeter) / openGk, dP);
    }
    g.forEach(function (r) {
      var key = r.zk + '|' + r.month;
      r.price = r.valid && r.areaMeter > 0 ? (flatPrice !== null ? flatPrice : engineRound(r.priceRaw, dP)) : 0; // AB
      if (r.smoothRest === 1 && r.status !== 'закрыт' && r.weight > 0 && r.reduced > 0 && denOpen > 0) {
        var unit = restAfterJournal / denOpen;
        r.tNo = engineRound(unit * r.weight, dA);                                                   // AC
        r.tSpch = r.areaSpch > 0 ? engineRound(unit * r.weight * S.kSpch, dA) : 0;                  // AD
      } else {
        r.tNo = r.valid && r.reduced > 0 ? engineRound(r.t0 + r.addSmooth / r.reduced, dA) : 0;
        r.tSpch = r.valid && r.areaSpch > 0 && r.reduced > 0 ?
          engineRound((r.t0 + r.addSmooth / r.reduced) * S.kSpch, dA) : 0;
      }
      if (r.status === 'закрыт' && closed[key]) {
        r.price = closed[key].price; r.tNo = closed[key].tNo; r.tSpch = closed[key].tSpch;
      }
      r.charged = r.price * r.gkMeter + r.tNo * r.areaNo + r.tSpch * r.areaSpch;                    // AE
      r.base = r.bill - r.ol + r.mu * r.gkMeter + r.addSmooth;
      r.olCharged = r.mu * r.gkMeter + r.addSmooth;   // сверхлимит, начисленный в тарифах этого месяца
      r.diff = r.valid ? r.charged - r.base : 0;                                                    // AF
      r.tol = S.tol + 0.5 * Math.pow(10, -dA) * (r.areaNo + r.areaSpch) + 0.5 * Math.pow(10, -dP) * r.gkMeter; // AG
      r.ratio = r.valid && r.perM2Meter > 0 && r.reduced > 0 ?
        (r.fixed ? (r.costNo + r.addSmooth) / S.fixedPrice / r.reduced / r.perM2Meter :
          r.volNo / r.reduced / r.perM2Meter) : null;                                               // AH
    });
    // Сезонная сверка (режимы сглаживания по сезону): без счётчиков — как в Excel (AJ),
    // плюс счётчики при единой цене Гкал: начислено по цене P − стоимость Гкал счётчиков за сезон
    var seasonCharged = 0, seasonTol = 0, meterDiff = 0;
    g.forEach(function (q) {
      if (q.status !== 'закрыт') seasonCharged += q.tNo * q.areaNo + q.tSpch * q.areaSpch;
      seasonTol += q.tol;
      if (flatPrice !== null && q.valid && q.areaMeter > 0) meterDiff += (q.price - q.priceRaw) * q.gkMeter;
    });
    var smoothNo = g.some(function (q) { return q.smoothRest === 1; });
    g.forEach(function (r) {
      r.seasonal = smoothNo || flatPrice !== null;
      r.flatPrice = flatPrice !== null;
      r.seasonDiff = (smoothNo ? seasonCharged - restAfterJournal : 0) + meterDiff;
      if (!smoothNo && flatPrice !== null) {
        r.seasonDiff = g.reduce(function (s2, q) { return s2 + q.diff; }, 0);
      }
      r.seasonTol = seasonTol;
    });
  });

  rows.forEach(function (r) {
    r.warnings = engineWarnings(r, S);
    r.status2 = engineStatus(r, S);
    r.isError = r.status2.indexOf('ОШИБКА') === 0;
  });
  return rows;
}

function engineWarnings(r, S) {
  var w = [];
  if (r.areaMeter > 0 && r.rest < 0) {
    w.push(r.fsoMzkVol === 0 ? 'кв. счётчики выше норматива дома — ФСО+МЗК = 0, объёмы приведены к нормативу' :
      'кв. счётчики выше индивидуальной части норматива — без счётчиков по среднему со счётчиками, ФСО+МЗК снижены');
  }
  if (r.ratio !== null && r.ratio < S.lowBound) {
    w.push('удельный объём без счётчиков ниже ' + Math.round(S.lowBound * 100) + '% среднего со счётчиками');
  }
  if (r.ratio !== null && r.ratio > S.highBound) {
    w.push('удельный объём без счётчиков выше ' + S.highBound + '× среднего со счётчиками');
  }
  if (r.note) w.push(r.note);
  return w;
}

function engineStatus(r, S) {
  if (r.status === 'закрыт') return '🔒 закрыт';
  if (r.bill === 0 && r.norm === 0) return '✓ сходится · проверьте: ' + (r.note || 'месяц без газа');
  if (!r.valid) return 'ОШИБКА: есть счёт, но нет норматива';
  var areas = r.areaMeter + r.areaSpch + r.areaNo;
  if (r.areaSpch + r.areaNo + Math.max(r.areaMeter, 0) === 0 && r.areaTotal > 0) return 'ОШИБКА: не заполнены площади';
  if (r.areaMeter < -S.tolArea || Math.abs(areas - r.areaTotal) > S.tolArea) return 'ОШИБКА: сумма площадей не равна итого';
  var tail = r.warnings.length ? '; ' + r.warnings.join('; ') : '';
  if (r.seasonal) {
    if (Math.abs(r.seasonDiff) > r.seasonTol) {
      return 'ОШИБКА: расхождение за сезон ' + engineFmt(r.seasonDiff, 2) + ' больше допуска ' + engineFmt(r.seasonTol, 2);
    }
    var what = r.smoothRest === 1 && r.flatPrice ? 'м², СПЧ и цена Гкал сглажены по сезону' :
      (r.flatPrice ? 'цена Гкал одна на сезон' : 'сглажено по профилю');
    return '✓ сходится по сезону · ' + what + ' (расхождение месяца ' + engineFmt(r.diff, 2) + ' грн)' + tail;
  }
  if (Math.abs(r.diff) > r.tol) {
    return 'ОШИБКА: расхождение ' + engineFmt(r.diff, 2) + ' больше допуска ' + engineFmt(r.tol, 2);
  }
  return r.warnings.length ? '✓ сходится · проверьте: ' + r.warnings.join('; ') : '✓ сходится';
}
