/* Olympus Dashboard - SHOWCASE build.
   Everything you see is simulated in this browser: prices, candles, accounts, trades and orders. There is no server, no broker and no real account behind it.
   (c) Patcharapon Khongmod. All rights reserved. Not licensed for copying, redistribution or use. Not investment advice.
   This file replaces the dashboard's /api/* calls with a small data generator (window.fetch is intercepted). */
(function () {
  'use strict';
  var DAY = 86400, M15 = 900, REAL_STRATS = {"1888012": ["hermes BTC H4", "BTC", "H4", "trend"], "1888013": ["hermes XAU H4", "ทองคำ", "H4", "trend"], "1888021": ["hermes ETH D1", "ETH", "D1", "trend"], "1888022": ["hermes XAU D1", "ทองคำ", "D1", "trend"], "1999001": ["apollo US500 D1", "S&P 500", "D1", "dip"], "1999002": ["apollo USTEC D1", "Nasdaq 100", "D1", "dip"], "1999003": ["apollo BTC D1", "BTC", "D1", "dip"]};
  try { if (!localStorage.getItem('dash-lang')) localStorage.setItem('dash-lang', 'en'); } catch (e) {}
  function mulberry(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  function rnd2(v) { return Math.round(v * 100) / 100; }
  function rd(v, dg) { var k = Math.pow(10, dg); return Math.round(v * k) / k; }

  // ------------------------------------------------------------------ market: REAL candles (a snapshot taken from a broker price feed), everything else is built on them
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var SELF = (document.currentScript && document.currentScript.src) || location.href, BASEURL = SELF.replace(/[^\/]*(\?.*)?$/, '');
  var SYM = { BTCUSDm: { unit: 1, min: 0.01, max: 200, step: 0.01, vol: 0.024 }, ETHUSDm: { unit: 1, min: 0.1, max: 2000, step: 0.01, vol: 0.03 }, XAUUSDm: { unit: 100, min: 0.01, max: 200, step: 0.01, vol: 0.011 },
    US500m: { unit: 1, min: 0.1, max: 1000, step: 0.01, vol: 0.008 }, USTECm: { unit: 1, min: 0.05, max: 500, step: 0.01, vol: 0.011 }, GBPJPYm: { unit: 650, min: 0.01, max: 200, step: 0.01, vol: 0.006 } };
  var NAMES = Object.keys(SYM), MKT = {}, DATA = {}, META = null, TICKR = mulberry(Date.now() & 0xffff), T0 = 0, END = 0, LOADED = Date.now() / 1000, PRE = ['M15', 'H1', 'H4', 'D1'];
  // the demo clock starts at the moment of the snapshot and never leaves its last M15 bar, so charts, ranges and trades stay consistent with the real candles
  function nowS() { return Math.floor(Math.min(T0 + (Date.now() / 1000 - LOADED), END)); }
  function wall() { return Math.floor(Date.now() / 1000); }
  function isOpen(sym, t) { if (sym === 'BTCUSDm' || sym === 'ETHUSDm') return true; var d = new Date(t * 1000).getUTCDay(); return d !== 0 && d !== 6; }
  function series(sym, tf) {
    var k = sym + '_' + tf; if (DATA[k]) return Promise.resolve(DATA[k]);
    return realFetch(BASEURL + 'data/' + k + '.json').then(function (r) { return r.json(); }).then(function (rows) { DATA[k] = rows; return rows; });
  }
  function loadAll() {
    return realFetch(BASEURL + 'data/meta.json').then(function (r) { return r.json(); }).then(function (m) {
      META = m; T0 = m.server_now; var jobs = [];
      NAMES.forEach(function (s) { PRE.forEach(function (tf) { jobs.push(series(s, tf)); }); });
      return Promise.all(jobs);
    }).then(function () {
      NAMES.forEach(function (sym) {
        var rows = DATA[sym + '_M15'], M = { t: [], o: [], h: [], l: [], c: [], v: [] }, mt = META.symbols[sym];
        rows.forEach(function (b) { M.t.push(b[0]); M.o.push(b[1]); M.h.push(b[2]); M.l.push(b[3]); M.c.push(b[4]); M.v.push(b[5]); });
        M.anchor = (mt.bid + mt.ask) / 2; M.price = M.anchor; M.half = (mt.ask - mt.bid) / 2; M.dg = mt.digits; M.point = Math.pow(10, -mt.digits); M.spread = mt.spread; M.day_open = mt.day_open; MKT[sym] = M; setQuote(M);
        SYM[sym].dg = mt.digits; SYM[sym].point = M.point; SYM[sym].spread = mt.spread;
      });
      END = Math.max.apply(null, NAMES.map(function (s) { var M = MKT[s]; return M.t[M.t.length - 1]; })) + M15 - 3;
      var el = document.getElementById('demo-ribbon-date'); var w = function () { var e = document.getElementById('demo-ribbon-date'); if (e) e.textContent = new Date(META.exported_at * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; };
      w(); document.addEventListener('DOMContentLoaded', w);
    });
  }
  function setQuote(M) { M.bid = M.price - M.half; M.ask = M.price + M.half; }
  function touchLast(rows, price) { var b = rows[rows.length - 1]; b[4] = price; if (price > b[2]) b[2] = price; if (price < b[3]) b[3] = price; }
  function tickMarket() {
    var t = nowS();
    NAMES.forEach(function (sym) {
      if (!isOpen(sym, t)) return;
      var M = MKT[sym], S = SYM[sym], last = M.t.length - 1;
      M.price += (M.anchor - M.price) * 0.03 + M.anchor * S.vol / Math.sqrt(86400) * 1.9 * gauss(TICKR);     // jitters around the last real price (never walks away from the real candles)
      M.c[last] = M.price; if (M.price > M.h[last]) M.h[last] = M.price; if (M.price < M.l[last]) M.l[last] = M.price; setQuote(M);
      PRE.forEach(function (tf) { touchLast(DATA[sym + '_' + tf], M.price); });
    });
  }
  function candles(sym, tf, count) {
    var rows = DATA[sym + '_' + tf]; if (!rows) return [];
    if (PRE.indexOf(tf) < 0) touchLast(rows, MKT[sym].price);
    var dg = SYM[sym].dg;
    return rows.slice(-count).map(function (b) { return [b[0], rd(b[1], dg), rd(b[2], dg), rd(b[3], dg), rd(b[4], dg), b[5]]; });
  }
  var TFSEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H2: 7200, H4: 14400, H8: 28800, D1: 86400, W1: 604800, MN1: 2592000 };
  function indexAt(sym, t) { var M = MKT[sym], lo = 0, hi = M.t.length - 1; while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (M.t[mid] <= t) lo = mid; else hi = mid - 1; } return lo; }
  function atr(bars, n) { var s = 0, k = 0; for (var i = Math.max(1, bars.length - n); i < bars.length; i++) { s += Math.max(bars[i][2] - bars[i][3], Math.abs(bars[i][2] - bars[i - 1][4]), Math.abs(bars[i][3] - bars[i - 1][4])); k++; } return k ? s / k : 0; }
  function ema(vals, n) { var k = 2 / (n + 1), e = null; vals.forEach(function (v) { e = e == null ? v : e + k * (v - e); }); return e; }
  function adx(bars, n) {
    if (bars.length < 3 * n) return null;
    var a = 1 / n, sp = null, sn = null, st = null, ax = null;
    for (var i = 1; i < bars.length; i++) {
      var up = bars[i][2] - bars[i - 1][2], dn = bars[i - 1][3] - bars[i][3], pd = up > dn && up > 0 ? up : 0, nd = dn > up && dn > 0 ? dn : 0;
      var tr = Math.max(bars[i][2] - bars[i][3], Math.abs(bars[i][2] - bars[i - 1][4]), Math.abs(bars[i][3] - bars[i - 1][4]));
      sp = sp == null ? pd : sp + a * (pd - sp); sn = sn == null ? nd : sn + a * (nd - sn); st = st == null ? tr : st + a * (tr - st);
      if (st) { var pi = 100 * sp / st, ni = 100 * sn / st, dx = pi + ni ? 100 * Math.abs(pi - ni) / (pi + ni) : 0; ax = ax == null ? dx : ax + a * (dx - ax); }
    }
    return ax;
  }

  // ------------------------------------------------------------------ simulated accounts
  var STRATS = [
    { name: 'hermes BTC H4', magic: 1888012, sym: 'BTCUSDm', tf: 14400, kind: 'h' }, { name: 'hermes XAU H4', magic: 1888013, sym: 'XAUUSDm', tf: 14400, kind: 'h' },
    { name: 'hermes ETH D1', magic: 1888021, sym: 'ETHUSDm', tf: 86400, kind: 'h' }, { name: 'hermes XAU D1', magic: 1888022, sym: 'XAUUSDm', tf: 86400, kind: 'h' },
    { name: 'apollo US500 D1', magic: 1999001, sym: 'US500m', tf: 86400, kind: 'dip' }, { name: 'apollo USTEC D1', magic: 1999002, sym: 'USTECm', tf: 86400, kind: 'dip' },
    { name: 'apollo BTC D1', magic: 1999003, sym: 'BTCUSDm', tf: 86400, kind: 'dip' }];
  var ARES_STRATS = [{ name: 'ares XAU', magic: 1777001, sym: 'XAUUSDm', tf: 900, kind: 'a', hold: [4, 28] }, { name: 'ares GBPJPY', magic: 1777003, sym: 'GBPJPYm', tf: 900, kind: 'a', hold: [4, 28] }];
  var ACCTS = [
    { key: 'demoA', label: 'Demo A · olympus', kind: 'Demo', login: 100200301, server: 'Demo-Server', deposit: 3000, scale: 1.4, since: '2026-08-01', portable: true, autostart: true, seed: 101 },
    { key: 'demoB', label: 'Demo B · ares', kind: 'Demo', login: 100200302, server: 'Demo-Server', deposit: 300, scale: 1, since: '2026-08-01', portable: true, autostart: true, manual: true, bot_name: 'ares', seed: 102 },
    { key: 'demoC', label: 'Demo C · manual desk', kind: 'Demo', login: 100200303, server: 'Demo-Server', deposit: 1500, scale: 1, since: '2026-08-01', portable: true, autostart: true, manual: true, order_entry: true, seed: 103 }];
  var TICKET = 7000000000;
  function pubCfg(a) { var o = {}; ['key', 'label', 'kind', 'login', 'server', 'since', 'deposit', 'scale', 'portable', 'autostart', 'manual', 'bot_name', 'order_entry'].forEach(function (k) { if (a[k] !== undefined) o[k] = a[k]; }); return o; }
  function floating(p) { var M = MKT[p.symbol]; return (p.side === 'BUY' ? M.bid - p.open_price : p.open_price - M.ask) * p.lot * SYM[p.symbol].unit; }
  function slmoney(p, px) { return rnd2((p.side === 'BUY' ? px - p.open_price : p.open_price - px) * p.lot * SYM[p.symbol].unit); }

  function genTrades(a, strats, n, windowDays, riskPct, bias, holdMul) {
    var r = mulberry(a.seed), out = [], tries = 0, id = 5000000000 + Math.floor(r() * 90000000), N;
    while (out.length < n && tries++ < n * 60) {
      var st = strats[Math.floor(r() * strats.length)], M = MKT[st.sym], S = SYM[st.sym]; N = M.t.length;
      var hold = st.hold ? st.hold[0] + Math.floor(r() * (st.hold[1] - st.hold[0])) : Math.ceil(st.tf / M15 * (1 + Math.floor(r() * 3) * holdMul));
      var back = Math.min(windowDays * 96, N - hold - 12); if (back < 1) continue; var i0 = N - 1 - hold - Math.floor(r() * back);
      if (st.tf > M15 && M.t[i0] % st.tf !== 0) continue;
      var hr = new Date(M.t[i0] * 1000).getUTCHours(); if (st.kind === 'a' && !((st.sym === 'GBPJPYm' && (hr === 8 || hr === 9)) || (st.sym === 'XAUUSDm' && (hr === 13 || hr === 14)))) continue;
      var entry = M.o[i0], iEnd = Math.min(N - 2, i0 + hold), natural = M.c[iEnd] >= entry ? 1 : -1, d = r() < bias ? natural : -natural;
      var atrTf = entry * S.vol * Math.sqrt(st.tf / DAY) * 0.7, slDist = (st.kind === 'a' ? 1.0 : 2) * atrTf, sl = entry - d * slDist, ex = M.c[iEnd], et = M.t[iEnd] + M15, reason = st.kind === 'a' ? 'TP' : 'EA';
      for (var i = i0; i <= iEnd; i++) if ((d > 0 && M.l[i] <= sl) || (d < 0 && M.h[i] >= sl)) { ex = sl; et = M.t[i] + 450; reason = 'SL'; break; }
      var riskUsd = a.deposit * riskPct / 100 * (a.scale || 1), lot = Math.floor(riskUsd / (slDist * S.unit) / S.step) * S.step; lot = rd(lot, 2);
      if (lot < S.min) continue;
      var net = rnd2((ex - entry) * d * lot * S.unit), risk = rnd2(slDist * lot * S.unit);
      out.push({ id: id++, symbol: st.sym, side: d > 0 ? 'BUY' : 'SELL', lot: lot, open: M.t[i0], close: Math.floor(et), open_price: rd(entry, S.dg), close_price: rd(ex, S.dg), sl: rd(sl, S.dg),
        points: Math.round((ex - entry) * d / S.point), comm: 0, gross: net, net: net, risk: risk, r: risk ? rnd2(net / risk) : 0, magic: st.magic, strategy: st.name, reason: reason });
    }
    out.sort(function (x, y) { return x.close - y.close; });
    return out;
  }
  function genCurve(a, trades, positions) {
    var t0 = (trades.length ? trades[0].open : nowS() - 30 * DAY) - DAY, t1 = nowS(), step = Math.max(1800, Math.ceil((t1 - t0) / 3000)), out = [], bal = a.deposit, k = 0;
    for (var t = t0; t <= t1; t += step) {
      while (k < trades.length && trades[k].close <= t) { bal += trades[k].net; k++; }
      var fl = 0;
      trades.forEach(function (tr) { if (tr.open <= t && tr.close > t) { var M = MKT[tr.symbol], i = indexAt(tr.symbol, t); fl += (tr.side === 'BUY' ? 1 : -1) * (M.c[i] - tr.open_price) * tr.lot * SYM[tr.symbol].unit; } });
      out.push({ t: t, balance: rnd2(bal), equity: rnd2(bal + fl), margin: 0 });
    }
    return out;
  }
  function mkPos(a, st, side, lot, daysAgo, slAtr, tpAtr) {
    var M = MKT[st.sym], S = SYM[st.sym], N = M.t.length, i = Math.max(1, N - 1 - Math.floor(daysAgo * 96)), ep = M.c[i], atrTf = ep * S.vol * Math.sqrt(st.tf / DAY) * 0.7;
    var d = side === 'BUY' ? 1 : side === 'SELL' ? -1 : (M.c[N - 1] >= ep ? 1 : -1), sl = ep - d * slAtr * atrTf, k;
    for (k = i; k < N; k++) {                                    // keep the stop outside everything the real price did since the entry
      if (d > 0 && M.l[k] < sl + 0.3 * atrTf) sl = M.l[k] - 0.3 * atrTf;
      if (d < 0 && M.h[k] > sl - 0.3 * atrTf) sl = M.h[k] + 0.3 * atrTf;
    }
    return { ticket: TICKET++, symbol: st.sym, side: d > 0 ? 'BUY' : 'SELL', lot: lot, open: M.t[i], open_price: rd(ep, S.dg), sl: rd(sl, S.dg), tp: tpAtr ? rd(ep + d * tpAtr * atrTf, S.dg) : 0, magic: st.magic, strategy: st.name, comment: st.name };
  }
  function build() {
    ACCTS.forEach(function (a) {
      if (a.key === 'demoA') { a.trades = genTrades(a, STRATS, 26, 30, 1.0, 0.57, 1); a.positions = [mkPos(a, STRATS[2], 'auto', 0.31, 3.2, 2, 0), mkPos(a, STRATS[0], 'auto', 0.02, 2.1, 2, 0), mkPos(a, STRATS[1], 'auto', 0.01, 1.4, 2, 0)]; }
      if (a.key === 'demoB') { a.trades = genTrades(a, ARES_STRATS, 30, 30, 3.0, 0.62, 1); a.positions = []; }
      if (a.key === 'demoC') { a.trades = genTrades(a, [{ name: 'Manual', magic: 0, sym: 'BTCUSDm', tf: 3600 }, { name: 'Manual', magic: 0, sym: 'XAUUSDm', tf: 3600 }], 8, 20, 0.8, 0.55, 1); a.positions = [mkPos(a, { name: 'Manual', magic: 0, sym: 'BTCUSDm', tf: 14400 }, 'auto', 0.05, 1.2, 2, 3)]; }
      a.since = new Date((T0 - 40 * DAY) * 1000).toISOString().slice(0, 10); a.orders = []; a.balDeals = [{ t: nowS() - 45 * DAY, amt: a.deposit, type: 'balance', comment: 'Demo deposit' }];
      a.balance = a.deposit + a.trades.reduce(function (s, t) { return s + t.net; }, 0); a.curve = genCurve(a, a.trades, a.positions); a.peak = a.curve.reduce(function (m, c) { return Math.max(m, c.equity); }, a.deposit);
    });
  }

  function posOut(p) {
    var M = MKT[p.symbol]; return { ticket: p.ticket, symbol: p.symbol, side: p.side, lot: p.lot, open: p.open, open_price: p.open_price, price: rd(p.side === 'BUY' ? M.bid : M.ask, SYM[p.symbol].dg), sl: p.sl, tp: p.tp,
      profit: rnd2(floating(p)), risk: p.sl ? Math.abs(slmoney(p, p.sl)) : 0, magic: p.magic, strategy: p.strategy, comment: p.comment || '', tp_money: p.tp ? slmoney(p, p.tp) : null, sl_money: p.sl ? slmoney(p, p.sl) : null };
  }
  function marginOf(p) { return p.lot * MKT[p.symbol].price * SYM[p.symbol].unit / 2000; }
  function accountOf(a) {
    var fl = 0, mg = 0; a.positions.forEach(function (p) { fl += floating(p); mg += marginOf(p); }); var eq = a.balance + fl;
    return { balance: rnd2(a.balance), equity: rnd2(eq), margin: rnd2(mg), margin_level: mg ? eq / mg * 100 : 0, credit: 0, profit: rnd2(fl), leverage: 2000, currency: 'USD', server: a.server, name_ok: true };
  }
  function stateOf(a) {
    var pos = a.positions.map(posOut), acc = accountOf(a), t = nowS();
    var o = { key: a.key, label: a.label, kind: a.kind, login: a.login, ts: wall(), ok: true, account: acc, terminal: { connected: true, algo: true, build: 6249 }, trades: a.trades, balance_deals: a.balDeals,
      reconcile: { deposits: a.deposit, credit: 0, other: 0, trades: rnd2(a.balance - a.deposit) }, positions: pos, orders: a.orders, vps: null, quick_t: wall(), server_time: t, cfg: pubCfg(a),
      verify: { file: '', verdict: 'WAIT', note: 'Demo data', mtime: t },
      curve: a.curve.concat([{ t: t, balance: acc.balance, equity: acc.equity, margin: acc.margin }]) };
    if (a.manual) o.manual = true;
    if (a.key === 'demoA') o.log = { init: { text: 'olympus: 7 strategies loaded | peak ' + rnd2(Math.max(a.peak, acc.equity)), date: '2026-11-01', time: '08:00:00' }, events: [], skips: {}, missed: 0, errors: [], source: 'this PC', vps_synced: null,
      recent: STRATS.map(function (s) { return { date: '2026-11-01', time: '08:00:00', text: s.name + '  ' + s.sym + ' ' + (s.tf === 14400 ? 'H4' : 'D1') }; }) };
    else o.log = { init: null, events: [], skips: {}, missed: 0, errors: [], source: 'manual', vps_synced: null, recent: [] };
    return o;
  }
  function quickOf(a) { var s = stateOf(a); return { ok: true, account: s.account, terminal: s.terminal, positions: s.positions, orders: s.orders, t: wall() }; }

  // ------------------------------------------------------------------ trade engine (SL / TP / pending orders / manual desk)
  function closePos(a, p, vol, px, reason) {
    var S = SYM[p.symbol], v = vol && vol < p.lot ? vol : p.lot, d = p.side === 'BUY' ? 1 : -1, net = rnd2((px - p.open_price) * d * v * S.unit);
    var risk = p.sl ? Math.abs(slmoney({ side: p.side, lot: v, open_price: p.open_price, symbol: p.symbol }, p.sl)) : 0;
    a.trades.push({ id: 5100000000 + Math.floor(Math.random() * 90000000), symbol: p.symbol, side: p.side, lot: rd(v, 2), open: p.open, close: nowS(), open_price: p.open_price, close_price: rd(px, S.dg), sl: p.sl || 0,
      points: Math.round((px - p.open_price) * d / S.point), comm: 0, gross: net, net: net, risk: rnd2(risk), r: risk ? rnd2(net / risk) : 0, magic: p.magic, strategy: p.strategy, reason: reason });
    a.balance += net; if (v >= p.lot - 1e-9) a.positions.splice(a.positions.indexOf(p), 1); else p.lot = rd(p.lot - v, 2);
  }
  function engineTick() {
    ACCTS.forEach(function (a) {
      a.positions.slice().forEach(function (p) {
        var M = MKT[p.symbol], buy = p.side === 'BUY', px = buy ? M.bid : M.ask;
        if (p.sl && ((buy && px <= p.sl) || (!buy && px >= p.sl))) closePos(a, p, 0, p.sl, 'SL');
        else if (p.tp && ((buy && px >= p.tp) || (!buy && px <= p.tp))) closePos(a, p, 0, p.tp, 'TP');
      });
      a.orders.slice().forEach(function (o) {
        var M = MKT[o.symbol], hit = (o.type === 2 && M.ask <= o.price) || (o.type === 4 && M.ask >= o.price) || (o.type === 3 && M.bid >= o.price) || (o.type === 5 && M.bid <= o.price);
        if (hit) { a.orders.splice(a.orders.indexOf(o), 1); a.positions.push({ ticket: TICKET++, symbol: o.symbol, side: o.type === 2 || o.type === 4 ? 'BUY' : 'SELL', lot: o.lot, open: nowS(), open_price: o.price, sl: o.sl, tp: o.tp, magic: 999001, strategy: 'Manual', comment: 'dashboard' }); }
      });
    });
  }
  function err(msg, extra) { var o = { ok: false, error: msg }; for (var k in extra || {}) o[k] = extra[k]; return o; }
  function orderApi(a, body, tail) {
    if (!a.order_entry) return err('The order desk is only enabled on "Demo C · manual desk" in this demo.');
    var act = body.action || '';
    if (tail === '/symbols') return { ok: true, algo: true, symbols: NAMES.map(function (s) { var S = SYM[s]; return { symbol: s, digits: S.dg, min: S.min, max: S.max, step: S.step, point: S.point, stops: 0 }; }) };
    if (act === 'suggest') {
      var sym = body.symbol; if (!SYM[sym]) return err('Unknown symbol'); var h1 = candles(sym, 'H1', 40).slice(0, -1), v = atr(h1, 14);
      return { ok: true, tf: 'H1', atr: v, sl: rd(1.5 * v, SYM[sym].dg), tp: rd(3 * v, SYM[sym].dg), digits: SYM[sym].dg };
    }
    if (act === 'open') return openOrder(a, body);
    if (act === 'close' || act === 'closeall' || act === 'modify' || act === 'cancel') return manage(a, body, act);
    return err('Unknown action ' + act);
  }
  function openOrder(a, b) {
    var sym = b.symbol, S = SYM[sym], side = String(b.side || '').toUpperCase(), kind = b.kind || 'market';
    if (!S) return err('Unknown symbol ' + sym); if (side !== 'BUY' && side !== 'SELL') return err('Pick BUY or SELL');
    var M = MKT[sym], lot = parseFloat(b.lot) || 0, buy = side === 'BUY', ask = M.ask, bid = M.bid, sl = parseFloat(b.sl) || 0, tp = parseFloat(b.tp) || 0, pin = parseFloat(b.price) || 0;
    if (!isOpen(sym, nowS())) return err(sym + ' is closed right now (weekend).');
    if (lot < S.min - 1e-9 || lot > S.max) return err('Lot must be between ' + S.min + ' and ' + S.max);
    if (Math.abs(Math.round(lot / S.step) * S.step - lot) > 1e-7) return err('Lot must be a multiple of ' + S.step);
    var price = kind === 'market' ? (buy ? ask : bid) : pin, type;
    if (kind !== 'market') {
      if (!(pin > 0)) return err('Enter the order price');
      if (kind === 'limit') { if ((buy && pin >= ask) || (!buy && pin <= bid)) return err('Limit: BUY must be below the market, SELL above it'); type = buy ? 2 : 3; }
      else { if ((buy && pin <= ask) || (!buy && pin >= bid)) return err('Stop: BUY must be above the market, SELL below it'); type = buy ? 4 : 5; }
    }
    var warn = [];
    if (sl) { if ((buy && sl >= price) || (!buy && sl <= price)) return err('SL must be below the entry (BUY) or above it (SELL)'); }
    else if (!b.no_sl) return err('A stop loss is required (or confirm that you want none)', { need_sl: true }); else warn.push('No SL set: the loss is unlimited');
    if (tp && ((buy && tp <= price) || (!buy && tp >= price))) return err('TP must be above the entry (BUY) or below it (SELL)');
    var acc = accountOf(a), margin = lot * price * S.unit / 2000, free = acc.equity - acc.margin;
    if (margin > free) return err('Not enough margin');
    var d = buy ? 1 : -1, slm = sl ? rnd2((sl - price) * d * lot * S.unit) : null, tpm = tp ? rnd2((tp - price) * d * lot * S.unit) : null, rp = slm != null ? -slm / acc.equity * 100 : null;
    if (rp != null && rp >= 10) warn.push('Loss if the SL is hit = ' + rp.toFixed(1) + '% of equity');
    var info = { symbol: sym, side: side, kind: kind, lot: lot, price: rd(price, S.dg), sl: sl || null, tp: tp || null, bid: M.bid, ask: M.ask, spread: M.ask - M.bid, digits: S.dg, margin: rnd2(margin),
      margin_free_after: rnd2(free - margin), sl_money: slm, tp_money: tpm, risk_pct: rp != null ? rnd2(rp) : null, rr: slm && tpm && slm < 0 ? rnd2(tpm / -slm) : null, warnings: warn, algo: true };
    if (b.dry) return { ok: true, dry: true, info: info };
    if (kind === 'market') a.positions.push({ ticket: TICKET++, symbol: sym, side: side, lot: lot, open: nowS(), open_price: rd(price, S.dg), sl: sl, tp: tp, magic: 999001, strategy: 'Manual', comment: 'dashboard' });
    else a.orders.push({ ticket: TICKET++, symbol: sym, type: type, lot: lot, price: rd(pin, S.dg), sl: sl, tp: tp, magic: 999001, comment: 'dashboard', time: nowS() });
    return { ok: true, retcode: 10009, comment: 'ok (simulated)', order: TICKET, deal: TICKET, price: rd(price, S.dg), volume: lot, info: info };
  }
  function manage(a, b, act) {
    var t = parseInt(b.ticket, 10), p = a.positions.filter(function (x) { return x.ticket === t; })[0];
    if (act === 'closeall') { var n = a.positions.length; a.positions.slice().forEach(function (q) { closePos(a, q, 0, q.side === 'BUY' ? MKT[q.symbol].bid : MKT[q.symbol].ask, 'MANUAL'); }); return { ok: true, count: n, done: n }; }
    if (act === 'cancel') { var o = a.orders.filter(function (x) { return x.ticket === t; })[0]; if (!o) return err('Pending order not found'); a.orders.splice(a.orders.indexOf(o), 1); return { ok: true, retcode: 10009, comment: 'ok (simulated)' }; }
    if (!p) return err('Trade not found (it may be closed already)');
    var M = MKT[p.symbol], S = SYM[p.symbol], buy = p.side === 'BUY', cur = buy ? M.bid : M.ask;
    if (act === 'close') {
      var vol = parseFloat(b.volume) || 0;
      if (vol) { if (vol > p.lot + 1e-9 || vol < S.min - 1e-9 || p.lot - vol < S.min - 1e-9 && vol < p.lot - 1e-9) return err('Invalid volume to close'); }
      if (b.dry) return { ok: true, dry: true }; closePos(a, p, vol || 0, cur, 'MANUAL'); return { ok: true, retcode: 10009, comment: 'ok (simulated)', price: rd(cur, S.dg), ticket: t };
    }
    var sl = b.sl === '' || b.sl == null ? p.sl : parseFloat(b.sl) || 0, tp = b.tp === '' || b.tp == null ? p.tp : parseFloat(b.tp) || 0;
    if (sl && ((buy && sl >= cur) || (!buy && sl <= cur))) return err('SL must be on the opposite side of the current price');
    if (tp && ((buy && tp <= cur) || (!buy && tp >= cur))) return err('TP must be on the profit side of the current price');
    p.sl = sl; p.tp = tp; return { ok: true, retcode: 10009, comment: 'ok (simulated)' };
  }

  // ------------------------------------------------------------------ levels (olympus radar), ares card
  function levelsFor(a) {
    var out = [], t = nowS();
    STRATS.forEach(function (st) {
      var M = MKT[st.sym], S = SYM[st.sym], bars = candles(st.sym, st.tf === 14400 ? 'H4' : 'D1', 400), closed = bars.slice(0, -1), price = M.price, av = atr(closed, 14), hi = -1e18, lo = 1e18;
      closed.slice(-20).forEach(function (b) { if (b[2] > hi) hi = b[2]; if (b[3] < lo) lo = b[3]; });
      var sma = closed.slice(-200).reduce(function (s, b) { return s + b[4]; }, 0) / Math.min(200, closed.length);
      var tg = [];
      if (st.kind === 'h') {
        tg.push({ side: 'BUY', text: 'Close above ' + rd(hi, S.dg), level: hi, met: price > hi, parts: [['Breakout high']], dist_pct: (hi / price - 1) * 100, dist_atr: (hi - price) / av });
        tg.push({ side: 'SELL', text: 'Close below ' + rd(lo, S.dg), level: lo, met: price < lo, parts: [['Breakout low']], dist_pct: (price / lo - 1) * 100, dist_atr: (price - lo) / av });
      } else {
        var z = [price * 0.955, price * 0.975];
        tg.push({ side: 'BUY', text: 'Pullback zone ' + rd(z[0], S.dg) + ' - ' + rd(z[1], S.dg), level: z[1], zone: z, possible: price > sma, met: price > z[0] && price < z[1] && price > sma, parts: [['Pullback in an uptrend']], dist_pct: (price / z[1] - 1) * 100, dist_atr: (price - z[1]) / av });
      }
      var pos = a.positions.filter(function (p) { return p.magic === st.magic; })[0], tf = st.tf, bo = Math.floor(t / tf) * tf;
      out.push({ name: st.name, magic: st.magic, symbol: st.sym, tf: st.tf === 14400 ? 'H4' : 'D1', kind: st.kind === 'h' ? 'h' : 'a', price: price, atr: av, bar_open: bo, bar_close: bo + tf, server_now: t, digits: S.dg, triggers: tg,
        exits: [{ side: 'BUY', text: 'Exit a BUY below ' + rd(lo, S.dg), level: lo }, { side: 'SELL', text: 'Exit a SELL above ' + rd(hi, S.dg), level: hi }], info: ['Demo levels from simulated prices'], eligible: true, min_risk_pct: 0.7,
        lot: 0.02, risk_target: 2.1, sl_note: 'Initial stop = a multiple of ATR', last_signal: null, last_bar: bo - tf,
        position: pos ? (function () { var po = posOut(pos); return { side: po.side, lot: po.lot, open: po.open, price: po.open_price, sl: po.sl, profit: po.profit }; })() : null });
    });
    return { ok: true, strategies: out, equity: accountOf(a).equity, ts: t };
  }
  var ARES_P = { risk_pct: 5, range_bars: 4, window_hours: 2, ema: 200, adx_min: 20, atr: 14, sl_atr: 1.5, min_sl_atr: 0.5, trail_atr: 2, max_trades_day: 3, max_open: 2, day_stop_r: 3, loss_streak: 2, flat_hour: 20 };
  function aresFor(a) {
    var t = nowS(), day = t - t % DAY, wd = new Date(t * 1000).getUTCDay(), eq = accountOf(a).equity, legs = [];
    [{ sym: 'GBPJPYm', name: 'GBPJPY', session: 'London', start: 420 }, { sym: 'XAUUSDm', name: 'Gold', session: 'New York', start: 750 }].forEach(function (L) {
      var S = SYM[L.sym], M = MKT[L.sym], m15 = candles(L.sym, 'M15', 220), closed = m15.slice(0, -1), h1 = candles(L.sym, 'H1', 400).slice(0, -1), av = atr(closed, 14), ax = adx(closed, 14), em = ema(h1.map(function (b) { return b[4]; }), 200);
      var rs = day + L.start * 60, re = rs + 4 * M15, we = re + 7200, flat = day + 20 * 3600, rb = m15.filter(function (b) { return b[0] >= rs && b[0] < re; }), hi = null, lo = null;
      if (rb.length === 4) { hi = Math.max.apply(null, rb.map(function (b) { return b[2]; })); lo = Math.min.apply(null, rb.map(function (b) { return b[3]; })); }
      var last = closed.length ? closed[closed.length - 1][4] : M.price, pos = a.positions.filter(function (p) { return p.magic === (L.sym === 'XAUUSDm' ? 1777001 : 1777003); }).length;
      var phase = wd === 0 || wd === 6 ? 'weekend' : t < rs ? 'before' : t < re ? 'range' : pos ? 'holding' : t < we && t < flat ? 'window' : 'over';
      var lossW = S.min * S.unit * 1.5 * av, lossB = S.min * S.unit * 0.5 * av, needW = lossW / 0.05, needB = lossB / 0.05;
      legs.push({ symbol: L.sym, name: L.name, session: L.session, magic: L.sym === 'XAUUSDm' ? 1777001 : 1777003, ok: true, now: t, phase: phase, range_start: rs, range_end: re, window_end: we, flat: flat, hi: hi, lo: lo, price: M.price,
        last_close: last, ema: em, trend: last > em ? 'up' : 'down', adx: ax, atr: av, adx_ok: ax != null && ax >= 20, digits: S.dg, buy_ok: hi != null && last > hi && last > em, sell_ok: lo != null && last < lo && last < em,
        min_lot: S.min, min_lot_loss_worst: lossW, min_lot_loss_best: lossB, need_worst: needW, need_best: needB, can_trade: eq >= needW ? 'yes' : eq >= needB ? 'some' : 'no', entries_today: 0, spread: M.ask - M.bid });
    });
    var tr = a.trades, wins = tr.filter(function (x) { return x.net > 0; }), gp = wins.reduce(function (s, x) { return s + x.net; }, 0), gl = -tr.filter(function (x) { return x.net <= 0; }).reduce(function (s, x) { return s + x.net; }, 0);
    return { ok: true, params: ARES_P, label: a.label, now: t, legs: legs, equity: eq, risk_usd: eq * 0.05, day_stop_usd: eq * 0.15, day_pl: 0, entries_today: 0, open_now: a.positions.length,
      stats: { n: tr.length, wins: wins.length, net: rnd2(tr.reduce(function (s, x) { return s + x.net; }, 0)), pf: gl ? rnd2(gp / gl) : null }, bench: { pf: '–', dd: '–', note: 'demo' } };
  }
  function liveOf() {
    var t = nowS(), out = { ok: true, symbols: {}, server_now: t, source: 'Market snapshot' };
    NAMES.forEach(function (s) { var M = MKT[s], dg = SYM[s].dg; out.symbols[s] = { bid: rd(M.bid, dg), ask: rd(M.ask, dg), time: t, spread: M.spread, digits: dg, day_open: rd(M.day_open, dg), chg_pct: rnd2((M.price / M.day_open - 1) * 100) }; });
    return out;
  }
  function alertfeed() {
    var o = {}; ACCTS.forEach(function (a) { var s = stateOf(a); o[a.key] = { ok: true, login: a.login, equity: s.account.equity, algo: true, log_source: s.log.source,
      positions: s.positions.map(function (p) { return { ticket: p.ticket, symbol: p.symbol, side: p.side, lot: p.lot, open_price: p.open_price, sl: p.sl, strategy: p.strategy }; }),
      trades: a.trades.slice(-30).map(function (x) { return { id: x.id, symbol: x.symbol, side: x.side, strategy: x.strategy, net: x.net, reason: x.reason, close: x.close }; }) }; });
    return o;
  }

  // ------------------------------------------------------------------ fetch interception
  function json(o, status) { return Promise.resolve(new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); }
  function route(url, opts) {
    var u = new URL(url, location.href), p = u.pathname.replace(/^.*?\/api\//, '/api/'), q = u.searchParams, m = (opts && opts.method || 'GET').toUpperCase(), a;
    var acct = function (k) { return ACCTS.filter(function (x) { return x.key === k; })[0]; };
    if (p === '/api/config') return { accounts: ACCTS.map(pubCfg), dd_lines: [15, 25, 32], refresh_seconds: 60, strats: REAL_STRATS };
    if (p === '/api/whoami') return { ok: true, local: true, pin: false, locked: false };
    if (p === '/api/live') return liveOf();
    if (p === '/api/watch') return { symbols: NAMES, tfs: Object.keys(TFSEC) };
    if (p === '/api/alertfeed') return alertfeed();
    if (p === '/api/chart') { var sy = q.get('symbol'), tf = q.get('tf') || 'H4', cn = Math.max(200, Math.min(parseInt(q.get('count') || '2500', 10), 5000)); if (!SYM[sy] || !TFSEC[tf]) return { ok: false, error: 'unsupported' };
      return series(sy, tf).then(function () { return { ok: true, symbol: sy, tf: tf, candles: candles(sy, tf, cn), digits: SYM[sy].dg, point: SYM[sy].point, server_now: nowS(), source: 'Market snapshot (real candles)' }; }); }
    if (p === '/api/last') { var s2 = q.get('symbol'), t2 = q.get('tf') || 'H4'; if (!SYM[s2] || !TFSEC[t2]) return { ok: false };
      return series(s2, t2).then(function () { return { ok: true, candles: candles(s2, t2, 3), bid: rd(MKT[s2].bid, SYM[s2].dg), ask: rd(MKT[s2].ask, SYM[s2].dg), server_now: nowS() }; }); }
    var mm = p.match(/^\/api\/(state|quick|levels|ares|order)\/([^\/]+)(\/symbols)?$/);
    if (mm) {
      a = acct(mm[2]); if (!a) return { ok: false, error: 'unknown account' };
      if (mm[1] === 'state') return stateOf(a);
      if (mm[1] === 'quick') return quickOf(a);
      if (mm[1] === 'levels') return a.key === 'demoA' ? levelsFor(a) : { ok: false };
      if (mm[1] === 'ares') return a.bot_name === 'ares' ? aresFor(a) : { ok: false, error: 'not an ares account' };
      var body = {}; try { body = JSON.parse(opts && opts.body || '{}'); } catch (e) {} return orderApi(a, body, mm[3] || '');
    }
    if (p === '/api/autostart') return { ok: true, launched: [] };
    if (p === '/api/refresh') return { ok: true };
    if (p.indexOf('/api/stop') === 0) return { ok: true, pending: false };
    if (p.indexOf('/api/launch') === 0) return { ok: true, launched: false, note: 'Demo: nothing to launch' };
    return { ok: false, error: 'not available in the demo' };
  }
  var READY = loadAll().then(function () { build(); setInterval(function () { tickMarket(); engineTick(); }, 1000); });
  window.fetch = function (url, opts) {
    var s = typeof url === 'string' ? url : url && url.url || '';
    if (s.indexOf('/api/') >= 0) return READY.then(function () { return Promise.resolve(route(s, opts)); }).then(function (o) { return json(o); }).catch(function (e) { console.error('demo api', s, e); return json({ ok: false, error: String(e) }, 500); });
    return realFetch(url, opts);
  };
  window.OLY_DEMO = { symbols: NAMES, accounts: ACCTS.length };
})();
