/* Chart page, entry radar, market watch, alert engine and top strip for the olympus dashboard (read-only). */
(function () {
  'use strict';
  var OLY = window.OLY; if (!OLY) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = OLY.esc, money = OLY.money;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var NICE = { BTCUSDm: 'BTC', ETHUSDm: 'ETH', XAUUSDm: 'ทองคำ', US500m: 'S&P 500', USTECm: 'Nasdaq 100', GBPJPYm: 'GBPJPY' };
  var SYMS = Object.keys(NICE), TFS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H2', 'H4', 'H8', 'D1', 'W1', 'MN1'], TFSEC = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H2: 7200, H4: 14400, H8: 28800, D1: 86400, W1: 604800, MN1: 2592000 };
  var UP = '#0f8a55', DOWN = '#c8372f';
  var P = LS.get('oly-chart', { symbol: 'BTCUSDm', tf: 'H4', ind: { ema200: true, sma50: false, sma200: false, don20: false, don55: false, vol: true }, lines: true, markers: true, log: false, ctype: 'candle', pct: false });
  P.hide = P.hide || {}; if (P.manual == null) P.manual = false; if (!P.ctype) P.ctype = 'candle';
  var HOOKS = { built: [], data: [], live: [] };
  function fire(n) { HOOKS[n].forEach(function (f) { try { f(CH); } catch (e) { console.error(e); } }); }
  function scaleMode() { return P.pct ? 2 : P.log ? 1 : 0; }
  function saveP() { LS.set('oly-chart', P); }
  // identity of each bot on the chart: COLOUR = which bot, SHAPE = family (Hermes arrows, Apollo squares), TEXT = family + TF
  var SC = { 1888012: '#e8890c', 1888013: '#c99700', 1888021: '#9b5de5', 1888022: '#e5489b', 1999001: '#0891b2', 1999002: '#4f6bed', 1999003: '#06b6d4' };
  function sc(m) { return SC[m] || '#6a7482'; }
  function isApollo(m) { var s = OLY.STR[m]; return !!s && s[3] === 'dip'; }
  function tagOf(m) { var s = OLY.STR[m]; return s ? (isApollo(m) ? 'Apollo ' : 'Hermes ') + s[2] : 'Manual'; }
  function nameOf(m) { var s = OLY.STR[m]; return s ? (isApollo(m) ? 'Apollo ' : 'Hermes ') + s[1] + ' ' + s[2] : 'Manual'; }
  function sw(m) { return '<i class="sw ' + (isApollo(m) ? 'sq' : 'ar') + '" style="--c:' + sc(m) + '"></i>'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(t) { var d = new Date(t * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dm(t) { var d = new Date(t * 1000); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  function px(v, dg) { return v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dg == null ? 2 : dg, maximumFractionDigits: dg == null ? 2 : dg }); }
  function cd(sec) { sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' : '') + pad(m) + ':' + pad(s); }
  function theme() { var cs = getComputedStyle(document.documentElement), g = function (n, d) { return cs.getPropertyValue(n).trim() || d; }; return { bg: g('--surface', '#fff'), ink: g('--ink2', '#333'), grid: g('--grid', '#eee'), line: g('--line', '#ddd'), muted: g('--muted', '#888'), up: g('--up', UP), down: g('--down', DOWN), blue: g('--blue', '#2a78d6') }; }

  // ---------------------------------------------------------------- live data + levels
  var LIVE = null, LIVEAT = 0, LEVELS = null, LEVELSAT = 0, liveFail = 0;
  function serverNow() { return LIVE ? LIVE.server_now + (Date.now() - LIVEAT) / 1000 : Date.now() / 1000; }
  function mid(sym) { var s = LIVE && LIVE.symbols && LIVE.symbols[sym]; return s ? (s.bid + s.ask) / 2 : null; }
  function pollLive() {
    fetch('/api/live').then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { LIVE = j; LIVEAT = Date.now(); liveFail = 0; onLive(); } else liveFail++;
    }).catch(function () { liveFail++; }).then(function () { if (liveFail === 45) pushAlert({ id: 'livefail|' + Math.floor(Date.now() / 3600000), acct: null, level: 'warn', title: 'ดึงราคาไม่ได้', text: 'แดชบอร์ดอ่านราคาจาก MT5 ไม่ได้หลายครั้งติดกัน ตรวจว่า MT5 ยังเปิดอยู่' }); });
  }
  function pollLevels() {
    if (!OLY.key) return;
    if (OLY.S && OLY.S.cfg && OLY.S.cfg.manual) { LEVELS = null; return; }   // olympus entry levels mean nothing on a hand-traded / ares account
    var lk = OLY.key;
    fetch('/api/levels/' + lk).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || lk !== OLY.key) return; var prev = LEVKEY === lk ? LEVELS : null; LEVKEY = lk; LEVELS = j; LEVELSAT = Date.now(); onLevels(prev, j);
    }).catch(function () {});
  }
  function isMet(tr, price) {
    if (price == null) return false;
    if (tr.zone) { var lo = Math.min(tr.zone[0], tr.zone[1]), hi = Math.max(tr.zone[0], tr.zone[1]); return tr.possible !== false && price > lo && price < hi; }
    return tr.side === 'BUY' ? price > tr.level : price < tr.level;
  }
  function strat(magic) { return LEVELS && LEVELS.strategies.filter(function (s) { return s.magic == magic; })[0]; }
  function closeIn(s) { return s.bar_close - serverNow(); }
  // countdown to the bar close; a closed market (stale ticks, bar already ended) must not sit at 00:00
  function cdc(s) {
    var left = closeIn(s); if (left > 1) return cd(left);
    var t = LIVE && LIVE.symbols && LIVE.symbols[s.symbol], age = t ? serverNow() - t.time : 0;
    return age > 600 ? 'ตลาดปิด' : 'กำลังเปิดแท่งใหม่';
  }

  // ---------------------------------------------------------------- alert engine
  var ALERTS = LS.get('oly-alerts', []), FIRED = LS.get('oly-fired', {}), AOPT = LS.get('oly-aopt', { sound: true, toast: true }), ACTX = null;
  // every alert belongs to one account (a.acct = account key; null = whole dashboard). Unread counts and the mute switch are per account.
  var NEXTAF = null, UNREAD = LS.get('oly-unread2', {}), AMUTE = LS.get('oly-amute', {}), LEVKEY = null;
  function accts() { return (OLY.CFG && OLY.CFG.accounts) || []; }
  function acctOf(k) { return accts().filter(function (a) { return a.key === k; })[0]; }
  function unreadOf(k) { return (UNREAD[k] || 0) + (UNREAD['*'] || 0); }
  function unreadAll() { return Object.keys(UNREAD).reduce(function (n, k) { return n + (UNREAD[k] || 0); }, 0); }
  function markRead(k) { if (k === '*') UNREAD = {}; else if (k === '@') delete UNREAD['*']; else delete UNREAD[k]; LS.set('oly-unread2', UNREAD); }
  function openAlert(a) { if (a.acct && a.acct !== OLY.key && acctOf(a.acct) && OLY.setKey) OLY.setKey(a.acct); if (a.symbol) goChart(a.symbol, a.tf); }
  function beep(level) {
    if (!AOPT.sound) return;
    try {
      ACTX = ACTX || new (window.AudioContext || window.webkitAudioContext)(); var o = ACTX.createOscillator(), g = ACTX.createGain();
      o.frequency.value = level === 'bad' ? 330 : level === 'good' ? 880 : 620; o.type = 'sine'; g.gain.value = 0.06; o.connect(g); g.connect(ACTX.destination); o.start(); o.stop(ACTX.currentTime + (level === 'bad' ? 0.5 : 0.22));
    } catch (e) {}
  }
  function toast(a) {
    if (!AOPT.toast) return;
    var box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    var t = document.createElement('div'); t.className = 'toast ' + a.level; t.innerHTML = (a.label ? '<i class="tacct">' + esc(a.label) + '</i>' : '') + '<b>' + esc(a.title) + '</b><span>' + esc(a.text) + '</span>';
    t.onclick = function () { t.remove(); openAlert(a); };
    box.appendChild(t); setTimeout(function () { t.remove(); }, a.level === 'bad' ? 30000 : 14000);
  }
  function pushAlert(a) {
    var now = Date.now();
    if (a.id) { if (FIRED[a.id]) return; FIRED[a.id] = now; Object.keys(FIRED).forEach(function (k) { if (now - FIRED[k] > 3 * 86400000) delete FIRED[k]; }); LS.set('oly-fired', FIRED); }
    if (a.acct === undefined) a.acct = OLY.key || null;
    var ac = a.acct && acctOf(a.acct); a.label = ac ? ac.label : '';
    a.t = now; if (a.acct && AMUTE[a.acct] && !a.force) a.muted = true; delete a.force;
    ALERTS.unshift(a); ALERTS = ALERTS.slice(0, 400); LS.set('oly-alerts', ALERTS);
    if (!a.muted) {      // a muted account still records its alerts, silently
      var uk = a.acct || '*'; UNREAD[uk] = (UNREAD[uk] || 0) + 1; LS.set('oly-unread2', UNREAD);
      toast(a); beep(a.level);
      try { if (window.Notification && Notification.permission === 'granted') new Notification('Olympus · ' + (a.label ? a.label + ' · ' : '') + a.title, { body: a.text }); } catch (e) {}
    }
    renderStrip(); if (OLY.page === 'alerts') renderAlertList();
  }
  // alerts that do not need the account to be the one on screen
  function algoAlert(login, label, ak) { pushAlert({ id: 'algo|' + login + '|' + Math.floor(Date.now() / 21600000), acct: ak, level: 'warn', title: 'Algo Trading ปิดอยู่ (' + label + ')', text: 'MT5 ในเครื่องนี้ปิด Algo Trading บอทในเครื่องจะไม่เทรด (ถ้าบอทรันบน VPS แล้วและตั้งใจปิดฝั่งเครื่อง ไม่ต้องสนใจ)' }); }
  function stopAlert(login, ak, eq, line) { pushAlert({ id: 'stopline|' + login + '|' + Math.floor(Date.now() / 3600000), acct: ak, level: 'bad', title: 'Equity ถึงเส้นหยุดตามแผน', text: 'Equity ' + money(eq) + ' ต่ำกว่า ' + money(line, 0) + ' ตามแผนทดลองให้หยุดและทบทวนก่อน' }); }
  function tradeAlerts(login, ak, pos, trades) {
    var tk = pos.map(function (p) { return p.ticket; }), rec = trades.slice().sort(function (a, b) { return a.close - b.close; }).slice(-30), ids = rec.map(function (t) { return t.id; });
    var seen = LS.get('oly-seen-' + login, null);
    if (seen === null) { LS.set('oly-seen-' + login, { t: tk, tr: ids }); return; }
    pos.forEach(function (p) { if (seen.t.indexOf(p.ticket) < 0) pushAlert({ id: 'open|' + p.ticket, acct: ak, level: 'good', symbol: p.symbol, title: 'เปิดไม้ ' + p.side + ' · ' + p.strategy, text: p.lot + ' lot @ ' + px(p.open_price) + (p.sl ? ' · SL ' + px(p.sl) : ' · ไม่มี SL!') }); });
    rec.forEach(function (t) { if (seen.tr.indexOf(t.id) < 0) pushAlert({ id: 'close|' + t.id, acct: ak, level: t.net >= 0 ? 'good' : 'warn', symbol: t.symbol, title: 'ปิดไม้ ' + t.side + ' · ' + t.strategy, text: t.symbol + ' ' + OLY.smoney(t.net) + ' (' + t.reason + ')' }); });
    LS.set('oly-seen-' + login, { t: tk, tr: seen.tr.filter(function (x) { return ids.indexOf(x) < 0; }).concat(ids).slice(-400) });
  }
  // the accounts that are NOT on screen: trades, stop line and Algo are still watched through one light request
  function pollFeed() {
    if (!accts().length) return;
    fetch('/api/alertfeed').then(function (r) { return r.json(); }).then(function (F) {
      Object.keys(F).forEach(function (k) {
        var f = F[k], ac = acctOf(k); if (k === OLY.key || !f.ok || !ac) return;
        tradeAlerts(f.login, k, f.positions || [], f.trades || []);
        if (ac.stop_equity && f.equity <= ac.stop_equity) stopAlert(f.login, k, f.equity, ac.stop_equity);
        if (!f.algo && !(ac.manual && !ac.bot_name) && f.log_source !== 'VPS') algoAlert(f.login, ac.label, k);
      });
    }).catch(function () {});
  }
  // ares accounts: range ready, breakout condition met, and a check that the EA really entered
  var ARESPEND = {};
  function pollAresAlerts() {
    accts().forEach(function (ac) {
      if (ac.bot_name !== 'ares') return;
      fetch('/api/ares/' + ac.key).then(function (r) { return r.json(); }).then(function (R) {
        if (!R.ok) return;
        (R.legs || []).forEach(function (A) {
          if (!A.ok) return; var k = ac.key, dg = A.digits, up = A.trend === 'up', side = up ? 'BUY' : 'SELL', pk = k + '|' + A.symbol + '|' + A.range_start, nm = 'ares ' + A.name;
          var go = NICE[A.symbol] ? { symbol: A.symbol, tf: 'M15' } : {};      // the chart page only knows some symbols
          function push(a) { a.acct = k; if (go.symbol) { a.symbol = go.symbol; a.tf = go.tf; } pushAlert(a); }
          if (A.phase === 'window' && A.hi != null) push({ id: 'ares-range|' + pk, level: 'info', title: nm + ': กรอบวันนี้พร้อมแล้ว', text: 'กรอบ ' + px(A.lo, dg) + ' – ' + px(A.hi, dg) + ' · รอ ' + (up ? 'BUY ถ้าปิดเหนือ ' + px(A.hi, dg) : 'SELL ถ้าปิดต่ำกว่า ' + px(A.lo, dg)) + ' · รับเบรกเอาต์ถึง ' + hm(A.window_end) });
          var met = A.phase === 'window' && A.adx_ok && (up ? A.buy_ok : A.sell_ok);
          if (met) {
            push({ id: 'ares-sig|' + pk, level: 'warn', title: nm + ': เข้าเงื่อนไขเบรกเอาต์ ' + side, text: 'แท่ง M15 ปิดที่ ' + px(A.last_close, dg) + ' นอกกรอบ ตรงเทรนด์ และ ADX ผ่าน ares ควรเปิดไม้ ' + side + ' (ADX บนแดชบอร์ดเป็นค่าประมาณ)' });
            if (!ARESPEND[pk]) ARESPEND[pk] = Date.now() + 180000;
            else if (Date.now() > ARESPEND[pk]) push({ id: 'ares-miss|' + pk, level: 'warn', title: nm + ': ยังไม่เปิดไม้ทั้งที่เข้าเงื่อนไข', text: 'ผ่านมา 3 นาทีแล้วยังไม่พบไม้ ' + side + ' อาจข้ามเพราะสเปรดกว้าง ADX จริงไม่ถึง หรือครบจำนวนไม้ของวัน ดูแท็บ Experts ใน MT5 ของบัญชีนี้' });
          }
          if (A.phase === 'over' && !A.entries_today && A.now < A.flat) push({ id: 'ares-over|' + pk, level: 'info', title: nm + ': จบช่วงของวันนี้ ไม่มีไม้', text: 'ไม่มีเบรกเอาต์ที่ผ่านเงื่อนไขในช่วง ' + hm(A.range_end) + '–' + hm(A.window_end) });
        });
      }).catch(function () {});
    });
  }
  var BASE = {}, PENDING = [], VPSPREV = {};
  var VT = { ok: ['ok', 'ปกติ'], syncing: ['wait', 'กำลังซิงก์'], late: ['warn', 'ยังไม่ซิงก์ log'], stale: ['bad', 'ขาดสัญญาณ'], stopped: ['bad', 'หยุดอยู่'], noea: ['bad', 'ไม่มี EA'], disconnected: ['bad', 'หลุดจากโบรกเกอร์'], unknown: ['wait', 'ไม่ทราบสถานะ'] };
  var VBAD = ['stale', 'stopped', 'noea', 'disconnected'];
  function onLive() {
    // price touch / near / custom alerts, evaluated on every live tick (2 s) with the latest levels
    if (LEVELS) LEVELS.strategies.forEach(function (s) {
      if (s.error) return; var price = mid(s.symbol); if (price == null) return;
      s.triggers.forEach(function (tr) {
        var id = s.magic + '|' + tr.side, met = isMet(tr, price), held = !!s.position;
        if (BASE[id] === undefined) { BASE[id] = met; return; }
        if (met && !BASE[id] && !held) {
          pushAlert({ id: 'touch|' + id + '|' + s.bar_open, acct: LEVKEY, level: s.eligible ? 'warn' : 'info', symbol: s.symbol, tf: s.tf,
            title: (s.eligible ? 'ราคาแตะจุดเข้า ' : 'ราคาแตะจุดเข้า (ทุนไม่พอ) ') + tr.side + ' · ' + s.name,
            text: tr.text + ' · ราคาตอนนี้ ' + px(price, s.digits) + ' · แท่ง ' + s.tf + ' ปิดอีก ' + cdc(s) + ' ต้องรอปิดแท่งถึงจะเข้าไม้' + (s.eligible ? '' : ' (ทุนไม่พอ บอทจะข้าม)') });
        }
        BASE[id] = met;
        var d = tr.dist_atr, nearId = 'near|' + id + '|' + s.bar_open;
        if (!met && !held && s.eligible && d != null && Math.abs(d) < 0.3 && tr.possible !== false) pushAlert({ id: nearId, acct: LEVKEY, level: 'info', symbol: s.symbol, tf: s.tf, title: 'ใกล้จุดเข้า ' + tr.side + ' · ' + s.name, text: tr.text + ' · ราคา ' + px(price, s.digits) + ' ห่าง ' + px(Math.abs(d), 2) + ' ATR' });
      });
    });
    var cu = LS.get('oly-custom', []), changed = false;
    cu.forEach(function (a) {
      var p = mid(a.symbol); if (p == null || a.done) return;
      if ((a.dir === 'up' && p >= a.price) || (a.dir === 'down' && p <= a.price)) { a.done = true; changed = true; pushAlert({ acct: a.acct || null, level: 'warn', symbol: a.symbol, tf: P.tf, title: 'ราคาถึงที่ตั้งเตือน · ' + NICE[a.symbol], text: NICE[a.symbol] + ' ' + (a.dir === 'up' ? 'ขึ้นถึง ' : 'ลงถึง ') + px(a.price) + ' (ตอนนี้ ' + px(p) + ')' }); }
    });
    if (changed) { LS.set('oly-custom', cu); if (OLY.page === 'chart') renderCustom(); }
    renderStrip(); if (OLY.page === 'chart') updateChartLive(); if (OLY.page === 'overview') renderWatch();
  }
  function onLevels(prev, cur) {
    cur.strategies.forEach(function (s) {
      if (s.error) return; var old = prev && prev.strategies.filter(function (x) { return x.magic == s.magic; })[0];
      if (old && s.bar_open !== old.bar_open && s.last_signal && !old.position) {
        pushAlert({ id: 'signal|' + s.magic + '|' + s.last_bar, acct: LEVKEY, level: s.eligible ? 'good' : 'info', symbol: s.symbol, tf: s.tf,
          title: 'แท่ง ' + s.tf + ' ปิดแล้ว: สัญญาณ ' + s.last_signal + ' · ' + s.name,
          text: s.eligible ? 'บอทควรเปิดไม้ ' + s.last_signal + ' ภายในไม่กี่วินาที (ประมาณ ' + s.lot + ' lot) ถ้าไม่เห็นไม้ใน 2 นาที จะมีแจ้งเตือนให้ตรวจ' : 'มีสัญญาณแต่ทุนไม่พอ (lot ขั้นต่ำเสี่ยง ' + px(s.min_risk_pct, 1) + '% เกินเพดาน 3%) บอทจะข้ามไม้นี้' });
        if (s.eligible) PENDING.push({ acct: LEVKEY, magic: s.magic, name: s.name, at: Date.now() + 120000, side: s.last_signal, symbol: s.symbol, tf: s.tf, bar: s.last_bar });
      }
    });
    renderStrip(); if (OLY.page === 'chart') { renderSide(); drawLevels(); } if (OLY.page === 'overview') renderRadar();
  }
  function onState(S) {
    if (!S || !S.ok || !S.account) return;   // MT5 not readable right now: nothing to evaluate
    var key = S.login;
    if (S.terminal && !S.terminal.algo && !(S.cfg && S.cfg.manual && !S.cfg.bot_name) && !(S.log && S.log.source === 'VPS')) algoAlert(key, S.label, OLY.key);
    if (S.terminal && S.terminal.algo && S.cfg && S.cfg.kind === 'Live' && !S.cfg.manual && S.log && S.log.source === 'VPS') pushAlert({ id: 'dupe|' + key + '|' + Math.floor(Date.now() / 1800000), level: 'bad', title: 'Algo Trading ในเครื่องนี้เปิดอยู่พร้อม VPS', text: 'บัญชีจริงมี olympus รันบน VPS อยู่แล้ว ถ้าเครื่องนี้มี olympus ติดกราฟและเปิด Algo Trading ด้วย บอทจะเปิดไม้ซ้อนกัน ปิดปุ่ม Algo Trading ใน MT5 ในเครื่องนี้ทันที' });
    var ev = S.log && S.log.events && S.log.events[S.log.events.length - 1];
    if (ev) pushAlert({ id: 'kill|' + key + '|' + ev.date + ev.time, level: 'bad', title: 'olympus หยุดทำงาน (' + S.label + ')', text: ev.text });
    if (S.log && S.log.errors && S.log.errors.length) pushAlert({ id: 'err|' + key + '|' + S.log.errors[S.log.errors.length - 1], level: 'bad', title: 'มี error ใน log ของ olympus', text: S.log.errors[S.log.errors.length - 1] });
    var V = S.vps;
    if (V) {
      if (VBAD.indexOf(V.state) >= 0) pushAlert({ id: 'vps|' + key + '|' + V.state + '|' + Math.floor(Date.now() / (V.state === 'stale' ? 7200000 : 3600000)), level: 'bad', title: 'VPS มีปัญหา: ' + (VT[V.state] || VT.unknown)[1] + ' (' + S.label + ')', text: V.text + ' · บอทบน VPS อาจไม่ได้เทรด ตรวจที่ MT5 → Tools → Options → VPS (ควรขึ้น Started) หรือ mql5.com' });
      else if (V.state === 'late') pushAlert({ id: 'vpslate|' + key + '|' + Math.floor(Date.now() / 21600000), level: 'warn', title: 'ยังไม่ได้ซิงก์ log จาก VPS (ไม่ใช่ VPS ขาด)', text: V.text + ' ถ้ายังเงียบต่อไปจะแจ้งเตือนแดง' });
      else if (V.state === 'ok' && VPSPREV[key] && (VBAD.indexOf(VPSPREV[key]) >= 0 || VPSPREV[key] === 'late')) pushAlert({ id: 'vpsok|' + key + '|' + Math.floor(Date.now() / 60000), level: 'good', title: 'VPS กลับมาปกติแล้ว', text: V.text });
      VPSPREV[key] = V.state;
    }
    var dn = OLY.ddNow(); [32, 25, 15].some(function (l) { if (dn.dd >= l) { pushAlert({ id: 'dd|' + key + '|' + l, level: l >= 25 ? 'bad' : 'warn', title: 'Drawdown ถึง ' + l + '% (' + S.label + ')', text: 'DD ปัจจุบัน ' + OLY.pct(dn.dd) + ' จากจุดสูงสุด ' + money(dn.peak) + (l === 15 ? ' · บอทลดขนาดไม้เหลือครึ่งหนึ่ง' : l === 25 ? ' · บอทลดขนาดไม้เหลือ ¼' : ' · Kill Switch') }); return true; } return false; });
    if (S.cfg && S.cfg.stop_equity && S.account.equity <= S.cfg.stop_equity) stopAlert(key, OLY.key, S.account.equity, S.cfg.stop_equity);
    tradeAlerts(key, OLY.key, S.positions || [], S.trades || []);
    PENDING = PENDING.filter(function (p) {
      if (p.acct && p.acct !== OLY.key) return Date.now() < p.at + 600000;   // judged only with that account's own data
      if (Date.now() < p.at) return true;
      var got = (S.positions || []).some(function (x) { return x.magic == p.magic; }) || (S.trades || []).some(function (x) { return x.magic == p.magic && x.open >= p.bar; });
      if (!got && !(S.cfg && S.cfg.manual)) pushAlert({ id: 'missing|' + p.magic + '|' + p.bar, acct: p.acct, level: 'bad', title: 'ไม่พบไม้ที่ควรเปิด · ' + p.name, text: 'มีสัญญาณ ' + p.side + ' เมื่อ 2 นาทีก่อนแต่ไม่พบไม้ในบัญชี ตรวจแท็บ Experts/Journal ของ VPS และหน้ากลยุทธ์ (ข้ามไม้เพราะ margin หรือเพดานความเสี่ยงก็เป็นไปได้)' });
      return false;
    });
    renderStrip();
  }
  OLY.listeners.push(onState);

  // ---------------------------------------------------------------- top strip
  function renderStrip() {
    var el = $('#strip'); if (!el) return; var S = OLY.S, ur = unreadAll();
    var h4 = LEVELS && LEVELS.strategies.filter(function (s) { return s.tf === 'H4' && !s.error; })[0], d1 = LEVELS && LEVELS.strategies.filter(function (s) { return s.tf === 'D1' && !s.error; })[0];
    var eq = S && S.ok ? S.account.equity : null, today = 0;
    if (S && S.ok) { var t0 = new Date(); t0.setHours(0, 0, 0, 0); (S.trades || []).forEach(function (t) { if (t.close >= t0.getTime() / 1000 && (OLY.isOly(t) || (S.cfg && S.cfg.manual))) today += t.net; }); }
    var fl = S && S.ok ? (S.positions || []).reduce(function (a, p) { return a + p.profit; }, 0) : 0;
    var V = S && S.ok && S.vps, VS = V && (VT[V.state] || VT.unknown);
    var ea = V ? '<i class="vd ' + VS[0] + '"></i>VPS ' + VS[1] + (V.heartbeat_age_min != null ? ' (ได้ยินล่าสุด ' + V.heartbeat_age_min + ' นาทีที่แล้ว)' : '') : (S && S.ok && S.cfg && S.cfg.bot_name ? 'บอท ' + S.cfg.bot_name + (S.terminal.algo ? '' : ' · <b class="warn">Algo ปิดอยู่</b>') : S && S.ok && S.cfg && S.cfg.manual ? 'เทรดมือ (ไม่มีบอท)' : S && S.ok && S.log ? (S.log.init ? 'olympus ทำงานในเครื่องนี้' : 'ไม่พบ olympus ใน log') : '–');
    var onVps = S && S.ok && S.log && S.log.source === 'VPS', algo = S && S.ok && !(S.cfg && S.cfg.manual) ? (S.terminal.algo ? '' : (onVps ? ' · Algo ในเครื่องนี้ปิด (ปกติ เพราะรันบน VPS)' : ' · <b class="warn">Algo ในเครื่องนี้ปิด</b>')) : '';
    el.innerHTML = '<span class="si"><i class="dot ' + (LIVE && liveFail < 3 ? '' : 'off') + '"></i>' + (LIVE ? 'ราคาสด' : 'รอราคา') + '</span>' +
      '<span class="si">Equity <b>' + (eq == null ? '–' : money(eq)) + '</b> · วันนี้ <b class="' + OLY.cls(today + fl) + '">' + OLY.smoney(today + fl) + '</b></span>' +
      '<span class="si">รอบตัดสินใจถัดไป: ' + (h4 ? 'H4 ใน <b>' + cd(closeIn(h4)) + '</b> (' + hm(h4.bar_close) + ' UTC → ' + hm(h4.bar_close) + ')' : '') + (d1 ? ' · D1 ใน <b>' + cd(closeIn(d1)) + '</b>' : '') + '</span>' +
      '<span class="si">' + ea + algo + '</span>' +
      (OLY.healthBadge ? OLY.healthBadge() : '') + '<a class="bell" id="bell" title="แจ้งเตือน">🔔' + (ur ? '<em>' + ur + '</em>' : '') + '</a>';
    if (h4) { var loc = new Date(h4.bar_close * 1000); el.querySelector('.si:nth-child(3)').innerHTML = 'รอบตัดสินใจถัดไป: H4 ใน <b>' + cd(closeIn(h4)) + '</b> (' + pad(loc.getHours()) + ':' + pad(loc.getMinutes()) + ' เวลาเครื่อง)' + (d1 ? ' · D1 ใน <b>' + cd(closeIn(d1)) + '</b> (' + (function () { var l2 = new Date(d1.bar_close * 1000); return pad(l2.getHours()) + ':' + pad(l2.getMinutes()); })() + ')' : ''); }
    $('#bell').title = 'แจ้งเตือนรวมทั้งแอป'; $('#bell').onclick = function () { NEXTAF = '*'; OLY.go('alerts'); };
    var nb = $('#navbell'), ua = UNREAD[OLY.key] || 0; if (nb) nb.textContent = ua ? ua : '';
  }
  setInterval(renderStrip, 1000);

  // ---------------------------------------------------------------- chart page
  var CH = null;   // {chart, candles, vol, ind:{}, lines:[], data:[], el, ro}
  function ema(v, n) { var a = 2 / (n + 1), o = [], p = v[0]; v.forEach(function (x, i) { p = i ? a * x + (1 - a) * p : x; o.push(p); }); return o; }
  function sma(v, n) { var o = [], s = 0; v.forEach(function (x, i) { s += x; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); }); return o; }
  function donch(h, l, n) { var up = [], lo = []; for (var i = 0; i < h.length; i++) { if (i < n) { up.push(null); lo.push(null); continue; } var mx = -1e18, mn = 1e18; for (var k = i - n; k < i; k++) { if (h[k] > mx) mx = h[k]; if (l[k] < mn) mn = l[k]; } up.push(mx); lo.push(mn); } return [up, lo]; }
  function tfmt(t) { var d = new Date(t * 1000); return d.getDate() + ' ' + ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()] + ' ' + d.getFullYear().toString().slice(2) + (TFSEC[P.tf] >= 86400 ? '' : ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())); }

  function chartPage(main) {
    var S = OLY.S;
    var h = '<div class="top"><div><h1>กราฟ</h1><div class="sub">แท่งเทียนสดจาก MT5 · เลือกตลาดและ TF · เส้นจุดเข้าของ olympus</div></div><div class="sync"><span class="s" id="chsrc"></span></div></div>';
    h += '<div class="chbar"><div class="seg" id="chsym">' + SYMS.map(function (s) { return '<button data-v="' + s + '" class="' + (P.symbol === s ? 'on' : '') + '">' + NICE[s] + '</button>'; }).join('') + '</div>' +
      '<div class="seg" id="chtf">' + TFS.map(function (t) { return '<button data-v="' + t + '" class="' + (P.tf === t ? 'on' : '') + '">' + t + '</button>'; }).join('') + '</div>' +
      '<div class="chips" id="chind"><button data-k="vol" class="' + (P.ind.vol ? 'on' : '') + '">Volume</button></div><div class="chips" id="chx"></div>' +
      '<div class="chips"><button id="tl" class="' + (P.lines ? 'on' : '') + '">เส้นจุดเข้า olympus</button><button id="tm" class="' + (P.markers ? 'on' : '') + '">ไม้ของ olympus</button><button id="tn" class="' + (P.manual ? 'on' : '') + '" title="ไม้ที่คุณเปิดเอง (ไม่ใช่บอท) แสดงเป็นลูกศรเทา">ไม้ Manual</button><button id="tg" class="' + (P.log ? 'on' : '') + '">Log</button><button id="tp" class="' + (P.pct ? 'on' : '') + '" title="แสดงแกนราคาเป็น % จากจุดแรกที่เห็น">%</button><button id="tf">ดูล่าสุด</button></div></div>';
    h += '<div class="chhead" id="chhead"></div><div class="chgrid"><div class="chwrap"><div id="chart"></div><div class="chleg" id="chleg"></div></div><aside class="chside" id="chside"></aside></div>';
    if (OLY.orderOn && OLY.orderOn()) h += '<div class="card" id="tk-pvcard"><h2>สรุปคำสั่งที่กำลังตั้ง <small>ความเสี่ยง ผลตอบแทน margin และสเปรดของคำสั่งในช่องส่งคำสั่ง</small></h2><div class="tk-pv" id="tk-pv"></div></div>';
    h += '<div class="card" id="symkey"></div><div class="card" id="custom"></div><div class="card" id="chtrades"></div>';
    if (OLY.orderOn && OLY.orderOn() && OLY.orderHelp) h += OLY.orderHelp();
    main.innerHTML = h;
    $('#chsym').onclick = function (e) { var b = e.target.closest('button'); if (b) { P.symbol = b.dataset.v; saveP(); chartPage(main); } };
    $('#chtf').onclick = function (e) { var b = e.target.closest('button'); if (b) { P.tf = b.dataset.v; saveP(); chartPage(main); } };
    $('#chind').onclick = function (e) { var b = e.target.closest('button'); if (b) { P.ind.vol = !P.ind.vol; saveP(); b.classList.toggle('on'); applyInd(); } };
    $('#tl').onclick = function () { P.lines = !P.lines; saveP(); this.classList.toggle('on'); drawLevels(); };
    $('#tm').onclick = function () { P.markers = !P.markers; saveP(); this.classList.toggle('on'); drawMarkers(); };
    $('#tn').onclick = function () { P.manual = !P.manual; saveP(); this.classList.toggle('on'); drawMarkers(); };
    $('#tg').onclick = function () { P.log = !P.log; if (P.log) P.pct = false; saveP(); this.classList.toggle('on', P.log); $('#tp').classList.toggle('on', P.pct); CH.chart.applyOptions({ rightPriceScale: { mode: scaleMode() } }); };
    $('#tp').onclick = function () { P.pct = !P.pct; if (P.pct) P.log = false; saveP(); this.classList.toggle('on', P.pct); $('#tg').classList.toggle('on', P.log); CH.chart.applyOptions({ rightPriceScale: { mode: scaleMode() } }); };
    $('#tf').onclick = function () { fitView(); };
    buildChart();
  }
  chartPage.live = true; chartPage.onState = function () { renderSide(); renderKey(); drawLevels(); drawMarkers(); renderTrades(); renderCustom(); };
  OLY.ext.chart = chartPage;

  function buildChart() {
    var T = theme(), el = $('#chart');
    if (!window.LightweightCharts) { el.innerHTML = '<div class="empty">โหลดไลบรารีกราฟไม่ได้ (ต้องต่ออินเทอร์เน็ต) รีเฟรชหน้านี้อีกครั้ง</div>'; renderSide(); return; }
    if (CH) { try { CH.chart.remove(); CH.ro && CH.ro.disconnect(); } catch (e) {} CH = null; }
    var chart = LightweightCharts.createChart(el, {
      width: el.clientWidth, height: Math.max(480, Math.min(720, window.innerHeight - 330)),
      layout: { background: { type: 'solid', color: T.bg }, textColor: T.ink, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } }, crosshair: { mode: 0 },
      rightPriceScale: { borderColor: T.line, mode: scaleMode(), minimumWidth: 72 }, timeScale: { borderColor: T.line, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 9, tickMarkFormatter: function (t, type) { if (type === 0) return String(new Date(t * 1000).getFullYear()); if (type === 1) return ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][new Date(t * 1000).getMonth()]; return type === 2 || TFSEC[P.tf] >= 86400 ? dm(t) : hm(t); } },
      localization: { timeFormatter: tfmt }, handleScale: { axisPressedMouseMove: true }, kineticScroll: { touch: true, mouse: false }
    });
    var candles = P.ctype === 'line' ? chart.addLineSeries({ color: T.blue, lineWidth: 2 })
      : P.ctype === 'area' ? chart.addAreaSeries({ lineColor: T.blue, topColor: 'rgba(75,147,234,.35)', bottomColor: 'rgba(75,147,234,.02)', lineWidth: 2 })
      : P.ctype === 'bars' ? chart.addBarSeries({ upColor: T.up, downColor: T.down })
      : chart.addCandlestickSeries({ upColor: T.up, downColor: T.down, borderVisible: false, wickUpColor: T.up, wickDownColor: T.down });
    var vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    CH = { chart: chart, candles: candles, vol: vol, ind: {}, lines: [], data: [], el: el, digits: 2, loadedKey: '' };
    CH.ro = new ResizeObserver(function () { chart.applyOptions({ width: el.clientWidth }); }); CH.ro.observe(el);
    chart.subscribeCrosshairMove(function (p) {
      if (!CH) return; if (!p.time) { legend(null); return; } var r = rowAt(p.time); if (!r) { legend(null); return; } legend({ open: r[1], high: r[2], low: r[3], close: r[4] }, p.time);
    });
    legend(null); renderSide(); renderKey();
    fire('built');
    loadCandles();
  }
  function rowAt(t) { var d = CH.data, lo = 0, hi = d.length - 1; if (!d.length) return null; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (d[m][0] <= t) lo = m; else hi = m - 1; } return d[lo][0] === t ? d[lo] : null; }
  function haRows(rows) { var out = [], po = null, pc = null; rows.forEach(function (r) { var c = (r[1] + r[2] + r[3] + r[4]) / 4, o = po == null ? (r[1] + r[4]) / 2 : (po + pc) / 2; out.push([r[0], o, Math.max(r[2], o, c), Math.min(r[3], o, c), c, r[5]]); po = o; pc = c; }); return out; }
  function pts(rows) {
    if (P.ctype === 'ha') rows = haRows(rows);
    if (P.ctype === 'line' || P.ctype === 'area') return rows.map(function (r) { return { time: r[0], value: r[4] }; });
    return rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; });
  }
  function legend(d, t) {
    var leg = $('#chleg'); if (!leg || !CH) return; var last = CH.data[CH.data.length - 1]; var c = d || (last && { open: last[1], high: last[2], low: last[3], close: last[4] }); if (!c) { leg.textContent = ''; return; }
    var chg = (c.close - c.open) / c.open * 100, dg = CH.digits;
    leg.innerHTML = '<b>' + NICE[P.symbol] + ' · ' + P.tf + '</b> ' + (t ? tfmt(t) + ' ' : '') + '<span>O</span>' + px(c.open, dg) + ' <span>H</span>' + px(c.high, dg) + ' <span>L</span>' + px(c.low, dg) + ' <span>C</span>' + px(c.close, dg) + ' <b class="' + OLY.cls(chg) + '">' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</b>';
  }
  function loadCandles() {
    var want = P.symbol + '|' + P.tf; $('#chsrc') && ($('#chsrc').textContent = 'กำลังโหลด…');
    fetch('/api/chart?symbol=' + P.symbol + '&tf=' + P.tf + '&count=' + (['M1', 'M5', 'M15', 'M30'].indexOf(P.tf) >= 0 ? 5000 : 3000)).then(function (r) { return r.json(); }).then(function (j) {
      if (!CH || want !== P.symbol + '|' + P.tf) return;
      if (!j.ok) { $('#chart').innerHTML = '<div class="empty">' + esc(j.error || 'ไม่มีข้อมูล') + '</div>'; return; }
      var T = theme(); CH.data = j.candles; CH.digits = j.digits; CH.point = j.point || 0.01; CH.loadedKey = want; CH.tfsec = TFSEC[P.tf];
      CH.candles.applyOptions({ priceFormat: { type: 'price', precision: j.digits, minMove: j.point } });
      CH.candles.setData(pts(j.candles));
      CH.vol.setData(j.candles.map(function (r) { return { time: r[0], value: r[5], color: r[4] >= r[1] ? 'rgba(15,138,85,.35)' : 'rgba(200,55,47,.35)' }; }));
      $('#chsrc').textContent = 'แหล่งราคา: ' + j.source + ' · เวลาแสดงตามเครื่องคุณ';
      applyInd(); drawLevels(); drawMarkers(); fitView(); renderSide(); renderKey(); renderTrades(); renderCustom(); legend(null); updateHead(); fire('data');
    }).catch(function () { $('#chsrc') && ($('#chsrc').textContent = 'โหลดกราฟไม่สำเร็จ'); });
  }
  function fitView() { if (!CH || !CH.data.length) return; var n = CH.data.length; CH.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 140), to: n + 8 }); }
  function applyInd() { if (CH) CH.vol.applyOptions({ visible: !!P.ind.vol }); }
  function drawLevels() {
    if (!CH) return; CH.lines.forEach(function (ln) { try { CH.candles.removePriceLine(ln); } catch (e) {} }); CH.lines = [];
    var S = OLY.S, T = theme();
    function pl(price, color, width, style, title) { CH.lines.push(CH.candles.createPriceLine({ price: price, color: color, lineWidth: width, lineStyle: style, axisLabelVisible: true, axisLabelColor: color, axisLabelTextColor: '#ffffff', title: (window.OLY_I18N ? window.OLY_I18N.tr(title) : title) })); }
    (S && S.positions || []).filter(function (p) { return p.symbol === P.symbol && !P.hide[p.magic]; }).forEach(function (p) {
      var col = OLY.isOly(p) ? sc(p.magic) : T.blue;
      pl(p.open_price, col, 2, 0, tagOf(p.magic) + ' ' + (p.side === 'BUY' ? '▲' : '▼') + p.side + ' ' + p.lot + ' (' + OLY.smoney(p.profit) + ')');
      if (p.sl) pl(p.sl, T.down, 1, 0, 'SL ' + tagOf(p.magic) + (p.sl_money != null ? ' (' + OLY.smoney(p.sl_money) + ')' : ''));
      if (p.tp) pl(p.tp, T.up, 1, 0, 'TP ' + tagOf(p.magic) + (p.tp_money != null ? ' (' + OLY.smoney(p.tp_money) + ')' : ''));
    });
    if (P.lines && LEVELS) LEVELS.strategies.filter(function (s) { return s.symbol === P.symbol && !s.error && !P.hide[s.magic]; }).forEach(function (s) {
      var col = sc(s.magic), w = s.tf === P.tf ? 2 : 1, tag = tagOf(s.magic), dim = s.eligible ? '' : ' ✗ทุน';
      if (!s.position) s.triggers.forEach(function (tr) {
        var ar = tr.side === 'BUY' ? '▲' : '▼', st = tr.side === 'BUY' ? 2 : 1, head = tag + ' ' + ar + tr.side;
        if (tr.zone) {
          if (tr.possible === false) return; var z = tr.zone.slice().sort(function (a, b) { return a - b; });
          pl(z[1], col, w, st, head + ' โซนบน' + dim); pl(z[0], col, w, st, head + ' โซนล่าง' + dim);
        } else pl(tr.level, col, w, st, head + (tr.side === 'BUY' ? ' ปิดเหนือ' : ' ปิดต่ำกว่า') + dim);
      });
      else s.exits.filter(function (x) { return x.side === s.position.side; }).forEach(function (x) { pl(x.level, col, w, 3, tag + ' จุดออก (ปิด' + (x.side === 'BUY' ? 'ต่ำกว่า' : 'เหนือ') + ')'); });
    });
    (LS.get('oly-custom', [])).filter(function (a) { return a.symbol === P.symbol && !a.done && (!a.acct || a.acct === OLY.key); }).forEach(function (a) { pl(a.price, '#d99a00', 1, 1, '🔔'); });
    (OLY.aresRange ? OLY.aresRange(P.symbol) : []).forEach(function (l) { pl(l.price, '#8e44ad', 1, 2, l.title); });   // today's ares opening range
    (OLY.ticketLines ? OLY.ticketLines(P.symbol) : []).forEach(function (l) { pl(l.price, l.color, 1.5, 2, l.title); });   // SL / TP / price being typed in the order ticket
  }
  function barTime(t) { var d = CH.data, lo = 0, hi = d.length - 1; if (!d.length || t < d[0][0]) return null; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (d[m][0] <= t) lo = m; else hi = m - 1; } return d[lo][0]; }
  function drawMarkers() {
    if (!CH) return; var S = OLY.S, mk = [], GREY = '#8892a0';
    if (!P.markers && !P.manual) { CH.candles.setMarkers([]); return; }
    (S && S.trades || []).filter(function (t) { return t.symbol === P.symbol; }).forEach(function (t) {
      var a = barTime(t.open), b = barTime(t.close), o = OLY.isOly(t); if (a == null) return;
      var buy = t.side === 'BUY';
      if (!o) {   // manual trades: small grey, no text, only if asked for
        if (!P.manual) return;
        mk.push({ time: a, position: buy ? 'belowBar' : 'aboveBar', color: GREY, shape: buy ? 'arrowUp' : 'arrowDown', size: 0.6, text: '' });
        if (b != null) mk.push({ time: b, position: buy ? 'aboveBar' : 'belowBar', color: GREY, shape: 'circle', size: 0.4, text: '' });
        return;
      }
      if (!P.markers || P.hide[t.magic]) return;
      var col = sc(t.magic), ap = isApollo(t.magic);
      mk.push({ time: a, position: buy ? 'belowBar' : 'aboveBar', color: col, shape: ap ? 'square' : (buy ? 'arrowUp' : 'arrowDown'), size: 1.4, text: tagOf(t.magic) + ' ' + (buy ? '▲' : '▼') + t.lot });
      if (b != null) mk.push({ time: b, position: buy ? 'aboveBar' : 'belowBar', color: col, shape: 'circle', size: 1, text: OLY.smoney(t.net, 0) });
    });
    if (P.markers) (S && S.positions || []).filter(function (p) { return p.symbol === P.symbol && !P.hide[p.magic]; }).forEach(function (p) {
      var a = barTime(p.open); if (a == null) return; var buy = p.side === 'BUY', o = OLY.isOly(p);
      mk.push({ time: a, position: buy ? 'belowBar' : 'aboveBar', color: o ? sc(p.magic) : '#2a78d6', shape: o && isApollo(p.magic) ? 'square' : (buy ? 'arrowUp' : 'arrowDown'), size: 1.6, text: tagOf(p.magic) + ' ' + (buy ? '▲' : '▼') + p.lot + ' (เปิดอยู่)' });
    });
    mk.sort(function (x, y) { return x.time - y.time; }); CH.candles.setMarkers(mk);
  }
  var lastPoll = 0, inflight = false;
  function updateChartLive() {
    if (!CH || !CH.data.length) return; var sym = P.symbol, tf = P.tf;
    var s = LIVE && LIVE.symbols[sym]; if (s) updateHead();
    if (inflight || Date.now() - lastPoll < 450) return; lastPoll = Date.now(); inflight = true;
    fetch('/api/last?symbol=' + sym + '&tf=' + tf).then(function (r) { return r.json(); }).then(function (j) {
      inflight = false;
      if (!j.ok || !CH || sym !== P.symbol || tf !== P.tf) return;
      var c = j.candles[j.candles.length - 1], last = CH.data[CH.data.length - 1];
      if (c[0] < last[0]) return;
      if (c[0] === last[0]) CH.data[CH.data.length - 1] = c; else { CH.data.push(c); loadAfterNewBar(); }
      CH.candles.update(pts(CH.data.slice(-2)).pop());
      if (P.ctype === 'ha') CH.candles.setData(pts(CH.data));
      CH.vol.update({ time: c[0], value: c[5], color: c[4] >= c[1] ? 'rgba(15,138,85,.35)' : 'rgba(200,55,47,.35)' });
      legend(null); fire('live');
    }).catch(function () { inflight = false; });
  }
  setInterval(function () { if (OLY.page === 'chart') updateChartLive(); }, 500);   // the chart follows the market about twice a second, not only on the 1 s price poll
  var reloadT = 0;
  function loadAfterNewBar() { if (Date.now() - reloadT < 20000) return; reloadT = Date.now(); setTimeout(function () { if (CH) { loadCandles(); } }, 1500); }
  function updateHead() {
    var el = $('#chhead'); if (!el) return; var s = LIVE && LIVE.symbols[P.symbol]; if (!s) { el.innerHTML = ''; return; }
    var dg = s.digits, left = CH && CH.data.length ? (CH.data[CH.data.length - 1][0] + TFSEC[P.tf] - serverNow()) : null;
    el.innerHTML = '<span class="px">' + px(s.bid, dg) + '</span><span class="' + OLY.cls(s.chg_pct) + '">' + (s.chg_pct > 0 ? '+' : '') + (s.chg_pct == null ? '–' : s.chg_pct.toFixed(2)) + '% วันนี้</span><span class="s">Bid ' + px(s.bid, dg) + ' · Ask ' + px(s.ask, dg) + ' · Spread ' + s.spread + ' จุด</span>' + (left != null ? '<span class="s">แท่ง ' + P.tf + ' ปิดใน <b>' + (left > 1 ? cd(left) : (serverNow() - s.time > 600 ? 'ตลาดปิด' : 'กำลังเปิดแท่งใหม่')) + '</b></span>' : '');
  }
  setInterval(function () { if (OLY.page === 'chart') updateHead(); }, 1000);

  function trigHtml(s, tr) {
    var price = mid(s.symbol), met = isMet(tr, price), imposs = tr.possible === false;
    var d = tr.dist_pct, dn = tr.dist_atr;
    return '<div class="trg"><span class="tag ' + tr.side.toLowerCase() + '">' + tr.side + '</span><div><div>' + esc(tr.text) + '</div>' +
      (imposs ? '<div class="s">แท่งนี้เข้าไม่ได้: เงื่อนไขสองข้อขัดกัน (ราคาที่ทำให้ RSI(2) ถึงเกณฑ์ อยู่คนละฝั่งกับเส้นเทรนด์) ต้องรอให้ราคาหรือเส้นเทรนด์ขยับก่อน</div>' : '<div class="s">' + (met ? '<b class="up">เข้าเงื่อนไขอยู่ตอนนี้</b> · ต้องรอปิดแท่งให้ได้ตามนี้' : (d == null ? '' : 'ห่าง ' + (d > 0 ? '+' : '') + px(d, 2) + '% (' + px(Math.abs(dn), 2) + ' ATR)')) + '</div>') +
      '<div class="s">' + (tr.parts || []).map(function (p) { return esc(p[0]) + ' ' + px(p[1], s.digits); }).join(' · ') + '</div></div></div>';
  }
  function glyph(kind, col) {
    var g = { up: '<path d="M7 1.5l5.5 7H9v4H5v-4H1.5z" fill="' + col + '"/>', down: '<path d="M7 12.5l5.5-7H9v-4H5v4H1.5z" fill="' + col + '"/>',
      sq: '<rect x="2" y="2" width="10" height="10" rx="1.5" fill="' + col + '"/>', dot: '<circle cx="7" cy="7" r="4.6" fill="' + col + '"/>' };
    return '<svg class="gl" width="14" height="14" viewBox="0 0 14 14">' + g[kind] + '</svg>';
  }
  function lineSample(col, dash, w) { return '<svg class="ls" width="38" height="10" viewBox="0 0 38 10"><line x1="1" y1="5" x2="37" y2="5" stroke="' + col + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>'; }
  function renderKey() {
    var el = $('#symkey'); if (!el) return;
    var ms = Object.keys(OLY.STR).filter(function (m) { return OLY.STR[m][1] === NICE[P.symbol]; });
    var h = '<h2>คำอธิบายสัญลักษณ์ <small>บอทที่เทรด ' + NICE[P.symbol] + ' · กดชื่อบอทเพื่อซ่อน/แสดงเส้นและลูกศรของมัน</small></h2>';
    h += '<div class="kbots">';
    if (!ms.length) h += '<div class="s">olympus ไม่มีบอทที่เทรดตลาดนี้ (ยังดูไม้ Manual และเส้นที่วาดเองได้)</div>';
    ms.forEach(function (m) {
      var st = OLY.STR[m], ap = isApollo(m), lv = strat(m), c = sc(m), status = '';
      if (lv && !lv.error) {
        if (lv.position) status = 'ถือ ' + (lv.position.side === 'BUY' ? '▲' : '▼') + lv.position.side + ' ' + lv.position.lot + ' lot @ ' + px(lv.position.price, lv.digits);
        else {
          var best = null; lv.triggers.forEach(function (tr) { if (tr.possible === false || tr.dist_atr == null) return; var d = isMet(tr, mid(lv.symbol)) ? 0 : Math.abs(tr.dist_atr); if (!best || d < best.d) best = { d: d, tr: tr }; });
          status = (lv.eligible ? 'รอเข้า' : 'ทุนไม่พอ (บอทข้าม)') + (best ? ' ' + (best.tr.side === 'BUY' ? '▲' : '▼') + best.tr.side + ' ' + (best.tr.zone ? 'โซน ' + px(Math.min(best.tr.zone[0], best.tr.zone[1]), lv.digits) + '–' + px(Math.max(best.tr.zone[0], best.tr.zone[1]), lv.digits) : (best.tr.side === 'BUY' ? 'ปิดเหนือ ' : 'ปิดต่ำกว่า ') + px(best.tr.level, lv.digits)) + ' · ห่าง ' + px(Math.abs(best.tr.dist_pct), 2) + '%' : ' (แท่งนี้เข้าไม่ได้)');
        }
      }
      h += '<button class="kb ' + (P.hide[m] ? 'off' : '') + '" data-mg="' + m + '" style="--c:' + c + '"><span class="kh">' + glyph(ap ? 'sq' : 'up', c) + '<b>' + (ap ? 'Apollo' : 'Hermes') + ' ' + esc(st[1]) + ' <u>' + esc(st[2]) + '</u></b></span><span class="s">' +
        (ap ? 'ซื้อตอนราคาย่อตัวแรง (RSI(2) ต่ำ) ขณะที่ยังเหนือเส้นเทรนด์' : 'เทรดตามเทรนด์ เข้าเมื่อราคาปิดทะลุกรอบ Donchian') + '</span><span class="s kst">' + esc(status || '–') + '</span></button>';
    });
    h += '</div><div class="kkey"><div class="kk"><h3>ลูกศรและจุดบนกราฟ</h3>' +
      '<div class="kr">' + glyph('up', '#6a7482') + glyph('down', '#6a7482') + '<span><b>ลูกศร ▲▼</b> = ไม้ของ <b>Hermes</b> (▲ ใต้แท่ง = เข้า BUY · ▼ เหนือแท่ง = เข้า SELL)</span></div>' +
      '<div class="kr">' + glyph('sq', '#6a7482') + '<span><b>สี่เหลี่ยม ■</b> = ไม้ของ <b>Apollo</b> (ใต้แท่ง = BUY · เหนือแท่ง = SELL)</span></div>' +
      '<div class="kr">' + glyph('dot', '#6a7482') + '<span><b>วงกลม ●</b> = ปิดไม้ ตัวเลขคือกำไร/ขาดทุนเป็นดอลลาร์</span></div>' +
      '<div class="kr">' + glyph('up', '#8892a0') + '<span><b>ลูกศรเทาเล็ก</b> = ไม้ที่คุณเปิดเอง (Manual) เปิดดูได้ที่ปุ่ม "ไม้ Manual"</span></div>' +
      '<div class="kr"><span class="s">สีของลูกศร/เส้น = บอทตัวไหน (ดูสีหน้าชื่อบอทด้านบน) ข้อความข้างลูกศร = บอท + TF + ทิศ + lot</span></div></div>' +
      '<div class="kk"><h3>เส้นแนวนอน</h3>' +
      '<div class="kr">' + lineSample('#6a7482', '6 5', 2) + '<span><b>เส้นประ</b> = รอเข้า <b>▲BUY</b> (ปิดแท่งเหนือราคานี้)</span></div>' +
      '<div class="kr">' + lineSample('#6a7482', '1.5 4', 2) + '<span><b>เส้นจุด</b> = รอเข้า <b>▼SELL</b> (ปิดแท่งต่ำกว่าราคานี้)</span></div>' +
      '<div class="kr">' + lineSample('#6a7482', '12 6', 2) + '<span><b>เส้นประยาว</b> = จุดออกของไม้ที่ถืออยู่</span></div>' +
      '<div class="kr">' + lineSample('#6a7482', '', 2.5) + '<span><b>เส้นทึบ</b> = ไม้ที่ถืออยู่ (ราคาเข้า) · <span class="down">SL แดง</span> · <span class="up">TP เขียว</span></span></div>' +
      '<div class="kr">' + lineSample('#6a7482', '6 5', 3) + lineSample('#6a7482', '6 5', 1) + '<span><b>หนา</b> = ตัดสินที่ TF เดียวกับกราฟที่เปิด · <b>บาง</b> = TF อื่น (เช่นดู H4 แต่เป็นเส้นของ D1)</span></div>' +
      '<div class="kr"><span class="s">โซน (Apollo) = ช่วงราคาปิดที่ทำให้เข้าไม้ได้ · "✗ทุน" = ทุนไม่พอ บอทจะข้ามไม้นั้น · เส้นเทา = เส้นที่คุณวาด/EMA/SMA/Donchian</span></div></div></div>';
    el.innerHTML = h;
    Array.prototype.forEach.call(el.querySelectorAll('.kb'), function (b) { b.onclick = function () { var m = b.dataset.mg; P.hide[m] = !P.hide[m]; saveP(); b.classList.toggle('off', !!P.hide[m]); drawLevels(); drawMarkers(); }; });
  }
  function renderSide() {
    var el = $('#chside'); if (!el) return; var S = OLY.S;
    if (OLY.isAres && OLY.isAres()) { if (!$('#ares-box')) el.innerHTML = OLY.aresBox(); return; }
    if (OLY.orderOn && OLY.orderOn()) {      // order desk: ticket + open positions next to the chart
      if (!$('#ticket-slot')) { el.innerHTML = '<div id="ticket-slot" data-keep></div><div class="card" id="desk-pos"></div>'; OLY.mountTicket(); }
      // the page may have been drawn before the account was known: make sure the summary and help cards exist
      var grid = $('.chgrid');
      if (grid && !$('#tk-pvcard')) grid.insertAdjacentHTML('afterend', '<div class="card" id="tk-pvcard"><h2>สรุปคำสั่งที่กำลังตั้ง <small>ความเสี่ยง ผลตอบแทน margin และสเปรดของคำสั่งในช่องส่งคำสั่ง</small></h2><div class="tk-pv" id="tk-pv"></div></div>');
      var ct = $('#chtrades'); if (ct && !$('#orderhelp') && OLY.orderHelp) ct.insertAdjacentHTML('afterend', OLY.orderHelp());
      OLY.deskUpdate(); return;
    }
    if (S && S.cfg && S.cfg.manual) { el.innerHTML = ''; return; }
    if (!LEVELS) { el.innerHTML = '<div class="card"><div class="empty">กำลังคำนวณจุดเข้า…</div></div>'; return; }
    var mine = LEVELS.strategies.filter(function (s) { return s.symbol === P.symbol; });
    var h = nearestBox() + allBox();
    if (!mine.length) h += '<div class="card"><h2>' + NICE[P.symbol] + '</h2><div class="s">olympus ไม่มีกลยุทธ์ที่เทรดตลาดนี้</div></div>';
    mine.forEach(function (s) {
      if (s.error) { h += '<div class="card"><h2><span>' + sw(s.magic) + esc(s.name) + '</span></h2><div class="s">' + esc(s.error) + '</div></div>'; return; }
      var st = s.position ? '<span class="badge demo">ถือ ' + s.position.side + ' ' + s.position.lot + '</span>' : (s.eligible ? '<span class="badge">รอสัญญาณ</span>' : '<span class="badge live">ทุนไม่พอ</span>');
      h += '<div class="card lv" style="border-left:4px solid ' + sc(s.magic) + '"><h2><span>' + sw(s.magic) + esc(s.name) + '</span>' + st + '</h2>';
      h += '<div class="s">แท่ง ' + s.tf + ' ปิดใน <b>' + cdc(s) + '</b> (' + hm(s.bar_close) + ' เวลาเครื่อง) · ATR ' + px(s.atr, s.digits) + '</div>';
      if (s.position) {
        h += '<div class="trg"><span class="tag ' + s.position.side.toLowerCase() + '">' + s.position.side + '</span><div>เข้า ' + px(s.position.price, s.digits) + ' · SL ' + (s.position.sl ? px(s.position.sl, s.digits) : 'ไม่มี') + ' · ' + OLY.smoney(s.position.profit) + '</div></div>';
        s.exits.filter(function (x) { return x.side === s.position.side; }).forEach(function (x) { h += '<div class="s">' + esc(x.text) + '</div>'; });
      } else s.triggers.forEach(function (tr) { h += trigHtml(s, tr); });
      h += '<div class="s">' + s.info.map(esc).join('<br>') + '</div>';
      h += '<div class="s ' + (s.eligible ? '' : 'down') + '">' + (s.eligible ? 'ทุน ' + money(LEVELS.equity) + ' เปิดได้ประมาณ <b>' + s.lot + ' lot</b> (' + esc(s.sl_note) + ')' : 'ทุน ' + money(LEVELS.equity) + ' ไม่พอ: lot ขั้นต่ำเสี่ยง ' + px(s.min_risk_pct, 1) + '% ของทุน เกินเพดาน 3% บอทจะข้ามไม้นี้') + '</div></div>';
    });
    el.innerHTML = h;
  }
  // every strategy at a glance: holding / waiting / not enough capital
  function allBox() {
    if (!LEVELS || !LEVELS.strategies || (OLY.S && OLY.S.cfg && OLY.S.cfg.manual)) return '';   // no bot on a hand-traded account
    var n = { hold: 0, wait: 0, cap: 0 }, rows = LEVELS.strategies.map(function (s) {
      if (s.error) return '<div class="al-r"><div class="al-t"><span>' + sw(s.magic) + esc(s.name) + '</span></div><div class="s">' + esc(s.error) + '</div></div>';
      var badge, line, best = null;
      s.triggers.forEach(function (tr) { if (tr.possible === false || tr.dist_atr == null) return; var d = isMet(tr, mid(s.symbol)) ? 0 : Math.abs(tr.dist_atr); if (!best || d < best.d) best = { d: d, tr: tr }; });
      if (s.position) {
        n.hold++; var ex = s.exits.filter(function (x) { return x.side === s.position.side; })[0];
        badge = '<span class="badge demo">เข้าไม้แล้ว ' + s.position.side + ' ' + s.position.lot + '</span>';
        line = 'เข้า ' + px(s.position.price, s.digits) + ' · <b class="' + OLY.cls(s.position.profit) + '">' + OLY.smoney(s.position.profit) + '</b>' + (ex ? ' · ออกถ้าปิด ' + px(ex.level, s.digits) : '');
      } else if (!s.eligible) {
        n.cap++; var need = s.min_risk_pct != null ? LEVELS.equity * s.min_risk_pct / 3 : null;
        badge = '<span class="badge live">ทุนไม่พอ</span>';
        line = need ? 'ต้องมีทุนประมาณ ' + money(need, 0) + ' (ขาดอีก ' + money(need - LEVELS.equity, 0) + ')' : 'lot ขั้นต่ำเสี่ยงเกินเพดาน';
      } else {
        n.wait++; badge = '<span class="badge">รอสัญญาณ</span>';
        line = best ? best.tr.side + ' ' + (best.tr.zone ? 'โซน ' + px(Math.min(best.tr.zone[0], best.tr.zone[1]), s.digits) + '–' + px(Math.max(best.tr.zone[0], best.tr.zone[1]), s.digits) : (best.tr.side === 'BUY' ? 'เหนือ ' : 'ต่ำกว่า ') + px(best.tr.level, s.digits)) + (best.d === 0 ? ' · <b class="up">ถึงแล้ว</b>' : ' · ห่าง ' + px(Math.abs(best.tr.dist_pct), 2) + '%') : 'แท่งนี้เข้าไม่ได้';
      }
      return '<div class="al-r clk' + (s.symbol === P.symbol ? ' cur' : '') + '" data-go="' + s.symbol + '|' + s.tf + '"><div class="al-t"><span>' + sw(s.magic) + esc(s.name) + '</span>' + badge + '</div><div class="s">' + line + ' · ปิดแท่งใน ' + cdc(s) + '</div></div>';
    });
    return '<div class="card allbox"><h2>ภาพรวมทุกกลยุทธ์ <small>เข้าไม้แล้ว ' + n.hold + ' · รอสัญญาณ ' + n.wait + ' · ทุนไม่พอ ' + n.cap + '</small></h2>' + rows.join('') + '</div>';
  }
  function nearestBox() {
    var best = null;
    LEVELS.strategies.forEach(function (s) {
      if (s.error || s.position || !s.eligible) return;
      s.triggers.forEach(function (tr) { if (tr.possible === false || tr.dist_atr == null) return; var d = isMet(tr, mid(s.symbol)) ? 0 : Math.abs(tr.dist_atr); if (!best || d < best.d) best = { d: d, s: s, tr: tr }; });
    });
    if (!best) return '<div class="card"><h2>จุดเข้าไม้แรก</h2><div class="s">ไม่มีกลยุทธ์ที่ทุนพอและรอสัญญาณ</div></div>';
    var s = best.s, tr = best.tr;
    return '<div class="card nearest"><h2>จุดเข้าไม้แรกที่ใกล้ที่สุด</h2><div><b>' + sw(s.magic) + esc(s.name) + ' ' + (tr.side === 'BUY' ? '▲' : '▼') + tr.side + '</b></div><div>' + esc(tr.text) + '</div><div class="s">ราคา ' + px(mid(s.symbol), s.digits) + ' · ' + (best.d === 0 ? '<b class="up">เข้าเงื่อนไขแล้ว รอปิดแท่ง</b>' : 'ห่าง ' + px(Math.abs(tr.dist_pct), 2) + '% (' + px(best.d, 2) + ' ATR)') + ' · แท่ง ' + s.tf + ' ปิดใน ' + cdc(s) + '</div><button class="btn" data-go="' + s.symbol + '|' + s.tf + '">ไปดูกราฟ</button></div>';
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-go]'); if (b) { var p = b.dataset.go.split('|'); goChart(p[0], p[1]); } });
  function goChart(sym, tf) { P.symbol = sym; if (tf) P.tf = tf; saveP(); OLY.go('chart'); }
  OLY.goChart = goChart; OLY.drawLevels = function () { if (OLY.page === 'chart' && CH) drawLevels(); }; OLY.chartSymbol = function () { return P.symbol; }; OLY.chartCH = function () { return CH; };
  OLY.goChartSym = function (sym) { if (!NICE[sym] || sym === P.symbol) return false; P.symbol = sym; saveP(); OLY.go('chart'); return true; };
  OLY.getLevels = function () { return LEVELS; };
  OLY.chartApi = { hooks: HOOKS, ch: function () { return CH; }, P: P, saveP: saveP, LS: LS, NICE: NICE, SYMS: SYMS, TFSEC: TFSEC, sc: sc, tagOf: tagOf, theme: theme, px: px, pts: pts, rowAt: rowAt,
    reload: function () { if (CH) loadCandles(); }, rebuild: function () { var m = document.getElementById('main'); chartPage(m); }, redrawLevels: function () { drawLevels(); }, mid: mid,
    addAlert: function (price) { var all = LS.get('oly-custom', []), cur = mid(P.symbol); all.push({ id: Date.now(), acct: OLY.key, symbol: P.symbol, price: price, dir: cur == null || price >= cur ? 'up' : 'down', done: false }); LS.set('oly-custom', all); renderCustom(); drawLevels(); } };
  OLY.debug = function () { return { CH: CH, LIVE: LIVE, LEVELS: LEVELS, P: P, ALERTS: ALERTS }; };

  var CUSTSIG = '';
  function renderCustom() {
    var el = $('#custom'); if (!el) return; var list = LS.get('oly-custom', []).filter(function (a) { return a.symbol === P.symbol && (!a.acct || a.acct === OLY.key); }), p = mid(P.symbol);
    // this card is refreshed on every price tick: rebuilding it would wipe what is being typed, so it is redrawn only when the list itself changes
    var sig = P.symbol + '|' + OLY.key + '|' + list.map(function (a) { return a.id + ':' + a.price + ':' + a.done; }).join(',');
    if (el.firstChild && el.querySelector('#cprice') && sig === CUSTSIG) { var ci = $('#cprice'); if (ci) ci.placeholder = 'ราคา เช่น ' + (p ? px(p, 0) : ''); return; }
    CUSTSIG = sig;
    el.innerHTML = '<h2>แจ้งเตือนราคาของฉัน <small>' + NICE[P.symbol] + ' · ของบัญชีนี้ · เตือนเมื่อราคาถึง (ต้องเปิดแดชบอร์ดไว้)</small></h2><div class="calc-row"><input id="cprice" type="number" step="any" placeholder="ราคา เช่น ' + (p ? px(p, 0) : '') + '"><button class="btn dark" id="cadd">ตั้งเตือน</button></div>' +
      (list.length ? '<div class="tbl"><table><thead><tr><th>ราคา</th><th>เมื่อ</th><th>สถานะ</th><th></th></tr></thead><tbody>' + list.map(function (a) { return '<tr><td class="n">' + px(a.price) + '</td><td>' + (a.dir === 'up' ? 'ขึ้นถึง' : 'ลงถึง') + '</td><td>' + (a.done ? 'เตือนแล้ว' : 'รอ') + '</td><td><button class="btn" data-del="' + a.id + '">ลบ</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="s">ยังไม่มีแจ้งเตือน</div>');
    $('#cadd').onclick = function () { var v = parseFloat($('#cprice').value), cur = mid(P.symbol); if (!isFinite(v) || cur == null) return; var all = LS.get('oly-custom', []); all.push({ id: Date.now(), acct: OLY.key, symbol: P.symbol, price: v, dir: v >= cur ? 'up' : 'down', done: false }); LS.set('oly-custom', all); renderCustom(); drawLevels(); };
    Array.prototype.forEach.call(el.querySelectorAll('[data-del]'), function (b) { b.onclick = function () { LS.set('oly-custom', LS.get('oly-custom', []).filter(function (a) { return String(a.id) !== b.dataset.del; })); renderCustom(); drawLevels(); }; });
  }
  function renderTrades() {
    var el = $('#chtrades'); if (!el) return; var S = OLY.S; var tr = (S.trades || []).filter(function (t) { return t.symbol === P.symbol; }).slice(-30).reverse();
    el.innerHTML = '<h2>ประวัติเทรดของ ' + NICE[P.symbol] + ' <small>' + tr.length + ' ไม้ล่าสุด · กดแถวเพื่อเลื่อนกราฟไปที่ไม้นั้น</small></h2>' + (tr.length ? '<div class="tbl"><table><thead><tr><th>เปิด</th><th>ปิด</th><th>ฝั่ง</th><th class="n">Lot</th><th class="n">เข้า</th><th class="n">ออก</th><th class="n">สุทธิ</th><th class="n">R</th><th>กลยุทธ์</th><th>ออกด้วย</th></tr></thead><tbody>' + tr.map(function (t) { return '<tr class="clk" data-t="' + t.open + '"><td>' + OLY.fdt(t.open) + '</td><td>' + OLY.fdt(t.close) + '</td><td><span class="tag ' + t.side.toLowerCase() + '">' + t.side + '</span></td><td class="n">' + t.lot + '</td><td class="n">' + px(t.open_price) + '</td><td class="n">' + px(t.close_price) + '</td><td class="n ' + OLY.cls(t.net) + '">' + OLY.smoney(t.net) + '</td><td class="n">' + (t.r == null ? '–' : px(t.r, 2) + 'R') + '</td><td>' + esc(t.strategy) + '</td><td><span class="tag">' + esc(t.reason) + '</span></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">ยังไม่มีเทรดของตลาดนี้ในบัญชี</div>');
    Array.prototype.forEach.call(el.querySelectorAll('tr.clk'), function (r) { r.onclick = function () { if (!CH) return; var t = +r.dataset.t, n = CH.data.length, i = 0; for (; i < n; i++) if (CH.data[i][0] >= t) break; CH.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 40), to: Math.min(n + 8, i + 40) }); window.scrollTo(0, 0); }; });
  }

  // ---------------------------------------------------------------- overview widgets (market watch + entry radar)
  function watchHtml() {
    if (!LIVE) return '<div class="empty">กำลังโหลดราคา…</div>';
    return '<div class="tbl"><table><thead><tr><th>ตลาด</th><th class="n">ราคา</th><th class="n">วันนี้</th><th class="n">Spread</th></tr></thead><tbody>' + SYMS.map(function (s) { var v = LIVE.symbols[s]; return v ? '<tr class="clk" data-go="' + s + '|' + P.tf + '"><td>' + NICE[s] + '</td><td class="n">' + px(v.bid, v.digits) + '</td><td class="n ' + OLY.cls(v.chg_pct) + '">' + (v.chg_pct > 0 ? '+' : '') + v.chg_pct.toFixed(2) + '%</td><td class="n">' + v.spread + '</td></tr>' : ''; }).join('') + '</tbody></table></div>';
  }
  function radarHtml() {
    if (!LEVELS) return '<div class="empty">กำลังคำนวณ…</div>';
    return '<div class="tbl"><table><thead><tr><th>กลยุทธ์</th><th>สถานะ</th><th>จุดเข้าที่ใกล้ที่สุด</th><th class="n">ห่าง</th><th class="n">แท่งปิดใน</th></tr></thead><tbody>' + LEVELS.strategies.map(function (s) {
      if (s.error) return '<tr><td>' + esc(s.name) + '</td><td colspan="4">' + esc(s.error) + '</td></tr>';
      var st = s.position ? '<span class="badge demo">ถือ ' + s.position.side + '</span>' : (s.eligible ? '<span class="badge">รอ</span>' : '<span class="badge live">ทุนไม่พอ</span>'), best = null;
      s.triggers.forEach(function (tr) { if (tr.possible === false || tr.dist_atr == null) return; var d = isMet(tr, mid(s.symbol)) ? 0 : Math.abs(tr.dist_atr); if (!best || d < best.d) best = { d: d, tr: tr }; });
      var txt = s.position ? 'ออกถ้าปิด ' + (s.exits.filter(function (x) { return x.side === s.position.side; })[0] || { level: 0 }).level.toFixed(s.digits > 2 ? 2 : s.digits) : (best ? best.tr.side + ' ' + (best.tr.zone ? 'โซน ' + px(Math.min(best.tr.zone[0], best.tr.zone[1]), s.digits) + '–' + px(Math.max(best.tr.zone[0], best.tr.zone[1]), s.digits) : (best.tr.side === 'BUY' ? 'เหนือ ' : 'ต่ำกว่า ') + px(best.tr.level, s.digits)) : 'แท่งนี้เข้าไม่ได้ (เงื่อนไขขัดกัน)');
      return '<tr class="clk" data-go="' + s.symbol + '|' + s.tf + '"><td>' + sw(s.magic) + esc(s.name) + '</td><td>' + st + '</td><td>' + txt + '</td><td class="n">' + (best && !s.position ? (best.d === 0 ? '<b class="up">ถึงแล้ว</b>' : px(Math.abs(best.tr.dist_pct), 2) + '% · ' + px(best.d, 1) + ' ATR') : '–') + '</td><td class="n">' + cdc(s) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function renderWatch() { var el = $('#watch-box'); if (el) el.innerHTML = watchHtml(); }
  function renderRadar() { var el = $('#radar-box'); if (el) el.innerHTML = radarHtml(); }
  function vpsCard() {
    var S = OLY.S, V = S && S.ok && S.vps; if (!V) return '';
    var T = VT[V.state] || VT.unknown, r = function (k, v) { return '<span>' + k + '</span><span>' + v + '</span>'; };
    return '<div class="card vpscard"><h2>สถานะ VPS <small>' + (V.id ? 'VPS ID ' + esc(V.id) : '') + '</small></h2><div class="vpsmain"><i class="vd big ' + T[0] + '"></i><div><b>' + T[1] + '</b><div class="s">' + esc(V.text) + '</div></div></div>' +
      '<div class="kv">' + r('สัญญาณชีพล่าสุด', V.last_heartbeat ? OLY.fdt(V.last_heartbeat) + (V.heartbeat_age_min != null ? ' (' + V.heartbeat_age_min + ' นาทีที่แล้ว)' : '') : '–') +
      r('EA บน VPS', V.ea == null ? '–' : V.ea + ' ตัว · ' + V.charts + ' กราฟ') + r('เชื่อมต่อโบรกเกอร์', V.connected == null ? '–' : (V.connected ? 'เชื่อมต่ออยู่' : '<b class="down">หลุด</b>')) +
      r('Ping ไปโบรกเกอร์', V.ping_ms == null ? '–' : px(V.ping_ms, 1) + ' ms') + r('CPU ของ EA · RAM', V.ea_cpu == null ? '–' : px(V.ea_cpu, 1) + '% · ' + V.ram_mb + ' MB') +
      r('VPS เริ่มทำงานล่าสุด', V.started_at ? OLY.fdt(V.started_at) : '–') + r('คำสั่งล่าสุดจากคุณ', V.last_command ? (V.last_command.what === 'start' ? 'Start' : 'Stop') + ' เมื่อ ' + esc(V.last_command.time) : '–') +
      r('log ซิงก์มาที่เครื่องนี้', V.copy_age_min == null ? '–' : V.copy_age_min + ' นาทีที่แล้ว') + '</div>' +
      '<div class="s">ข้อมูลนี้อ่านจากสำเนา log ของ VPS ที่ MT5 ในเครื่องดึงมา (VPS เขียนสัญญาณชีพทุกชั่วโมง) ถ้าปิดคอมจะไม่อัปเดตจนกว่าจะเปิดใหม่ วันหมดอายุ/ต่ออายุ VPS อ่านจากเครื่องไม่ได้ ดูที่ MT5 → Tools → Options → VPS หรือ mql5.com</div></div>';
  }
  OLY.afterOverview = function (slot) {
    if (!slot) return;
    if (OLY.isAres && OLY.isAres()) { slot.innerHTML = OLY.aresBox() + (OLY.riskCard ? OLY.riskCard() : '') + '<div class="card"><h2>ราคาตลาดสด</h2><div id="watch-box"></div></div>'; renderWatch(); return; }
    slot.innerHTML = (OLY.riskCard ? OLY.riskCard() : '') + vpsCard() + '<div class="radargrid"><div class="card"><h2>จุดเข้าไม้ของ olympus <small>กดแถวเพื่อเปิดกราฟ</small></h2><div id="radar-box"></div></div><div class="card"><h2>ราคาตลาดสด</h2><div id="watch-box"></div></div></div>';
    renderRadar(); renderWatch();
  };

  // ---------------------------------------------------------------- alerts page
  var AF = null, AFKEY = null;   // account shown on the alerts page ('*' = all); follows the account selector
  function inAF(a) { return AF === '*' || (AF === '@' ? a.acct === null : a.acct === AF); }
  function kindIcon(ac) { return ac.bot_name === 'ares' ? '⚡' : ac.manual ? '✋' : '🤖'; }
  function renderAlertList() {
    var el = $('#alist'); if (!el) return; var list = ALERTS.filter(inAF), n = $('#acount'); if (n) n.textContent = list.length + ' รายการ';
    el.innerHTML = list.length ? list.map(function (a) {
      return '<div class="al ' + a.level + (a.muted ? ' muted' : '') + '" data-i="' + ALERTS.indexOf(a) + '"' + (a.symbol ? ' data-go="1"' : '') + '><span class="s">' + new Date(a.t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) +
        (AF === '*' ? ' <i class="tacct">' + esc(a.label || (a.acct === null ? 'ทั้งระบบ' : 'ก่อนแยกบัญชี')) + '</i>' : '') + (a.muted ? ' <i class="tacct">ปิดเสียง</i>' : '') + '</span><b>' + esc(a.title) + '</b><span>' + esc(a.text) + '</span></div>';
    }).join('') : '<div class="empty">ยังไม่มีแจ้งเตือน</div>';
    el.onclick = function (e) { var d = e.target.closest('.al[data-go]'), a = d && ALERTS[+d.dataset.i]; if (a) openAlert(a); };
  }
  function alertKinds(ac) {
    var always = ['เปิด/ปิดไม้'], sel = [];
    if (ac.stop_equity) always.push('Equity ถึงเส้นหยุด ' + money(ac.stop_equity, 0));
    always.push('ราคาถึงที่ตั้งเตือน');
    if (ac.bot_name === 'ares') always.push('Algo Trading ปิด', 'กรอบวันนี้พร้อม', 'เข้าเงื่อนไขเบรกเอาต์', 'ไม่เปิดไม้ทั้งที่เข้าเงื่อนไข', 'จบวันไม่มีไม้');
    else if (!ac.manual) { always.push('Algo Trading ปิด'); sel = ['ราคาแตะ/ใกล้จุดเข้า', 'แท่งปิดมีสัญญาณ', 'ไม่พบไม้ใน 2 นาที', 'olympus หยุด', 'error ใน log', 'DD ถึง 15/25/32%']; }
    return '<div class="chips">' + always.map(function (t) { return '<span class="chip2 plain">' + t + '</span>'; }).join('') + sel.map(function (t) { return '<span class="chip2 plain dim" title="เตือนเฉพาะตอนเลือกบัญชีนี้อยู่">' + t + ' ◦</span>'; }).join('') + '</div>' +
      (sel.length ? '<div class="s">◦ = เตือนเฉพาะตอนเลือกบัญชีนี้อยู่ที่มุมซ้ายบน · ที่เหลือเตือนตลอดแม้กำลังดูบัญชีอื่น</div>' : '<div class="s">เตือนตลอดแม้กำลังดูบัญชีอื่น</div>');
  }
  function alertsPage(main) {
    if (NEXTAF) { AF = NEXTAF; NEXTAF = null; AFKEY = OLY.key; } else if (AFKEY !== OLY.key || AF === null) { AF = OLY.key; AFKEY = OLY.key; }
    markRead(AF);
    var perm = window.Notification ? Notification.permission : 'ไม่รองรับ', ac = AF === '*' || AF === '@' ? null : acctOf(AF);
    var tabs = accts().map(function (x) { var u = x.key === AF ? 0 : (UNREAD[x.key] || 0); return '<button data-af="' + x.key + '" class="' + (x.key === AF ? 'on' : '') + '"><i>' + kindIcon(x) + '</i>' + esc(x.label) + (AMUTE[x.key] ? ' <i title="ปิดเตือนอยู่">🔕</i>' : '') + (u ? '<em>' + u + '</em>' : '') + '</button>'; }).join('') +
      '<button data-af="@" class="' + (AF === '@' ? 'on' : '') + '"><i>🖥</i>ทั้งระบบ' + (AF !== '@' && UNREAD['*'] ? '<em>' + UNREAD['*'] + '</em>' : '') + '</button><button data-af="*" class="' + (AF === '*' ? 'on' : '') + '"><i>🔔</i>รวมทุกบัญชี</button>';
    main.innerHTML = '<div class="top"><div><h1>แจ้งเตือน</h1><div class="sub">แยกตามบัญชี · กระดิ่งด้านบน = แจ้งเตือนรวมทั้งแอป · แจ้งเตือนจากแดชบอร์ด (ไม่ใช่แจ้งเตือนมือถือของ MT5) · ต้องเปิดแดชบอร์ดไว้ถึงจะเตือน</div></div></div>' +
      '<div class="atabs">' + tabs + '</div>' +
      (ac ? '<div class="card"><h2>' + kindIcon(ac) + ' ' + esc(ac.label) + ' <small>' + (ac.bot_name === 'ares' ? 'บอท ares' : ac.manual ? 'เทรดมือ' : 'บอท olympus') + '</small><button id="a-mute" class="btn ' + (AMUTE[AF] ? '' : 'dark') + '" style="margin-left:auto">' + (AMUTE[AF] ? '🔕 ปิดเตือนบัญชีนี้อยู่' : '🔔 เปิดเตือนบัญชีนี้อยู่') + '</button></h2>' + alertKinds(ac) + '</div>' : '') +
      (AF === '@' ? '<div class="card"><h2>🖥 ทั้งระบบ <small>เรื่องของแดชบอร์ดเอง ไม่ใช่ของบัญชีใด</small></h2><div class="chips"><span class="chip2 plain">ดึงราคาจาก MT5 ไม่ได้</span><span class="chip2 plain">ติดต่อโปรแกรมแดชบอร์ดไม่ได้</span><span class="chip2 plain">ราคาถึงที่ตั้งเตือนที่ไม่ผูกบัญชี</span></div></div>' : '') +
      '<div class="card"><h2>ตั้งค่ารวม <small>ใช้กับทุกบัญชี</small></h2><div class="chips"><button id="a-snd" class="' + (AOPT.sound ? 'on' : '') + '">เสียงเตือน</button><button id="a-toast" class="' + (AOPT.toast ? 'on' : '') + '">ป้ายเตือนมุมจอ</button><button id="a-perm">แจ้งเตือนของเบราว์เซอร์: ' + esc(perm) + (perm === 'default' ? ' (กดเพื่อขออนุญาต)' : '') + '</button><button id="a-test">ทดสอบ</button></div></div>' +
      '<div class="card"><h2>รายการ <small id="acount"></small><button id="a-clear" class="btn" style="margin-left:auto">ล้างรายการ' + (ac ? 'ของบัญชีนี้' : AF === '@' ? 'ของทั้งระบบ' : 'ทั้งหมด') + '</button></h2><div id="alist"></div></div>';
    renderAlertList(); renderStrip();
    Array.prototype.forEach.call(main.querySelectorAll('[data-af]'), function (b) { b.onclick = function () { AF = b.dataset.af; alertsPage(main); }; });
    var mu = $('#a-mute'); if (mu) mu.onclick = function () { if (AMUTE[AF]) delete AMUTE[AF]; else AMUTE[AF] = 1; LS.set('oly-amute', AMUTE); alertsPage(main); };
    $('#a-snd').onclick = function () { AOPT.sound = !AOPT.sound; LS.set('oly-aopt', AOPT); this.classList.toggle('on'); if (AOPT.sound) beep('info'); };
    $('#a-toast').onclick = function () { AOPT.toast = !AOPT.toast; LS.set('oly-aopt', AOPT); this.classList.toggle('on'); };
    $('#a-perm').onclick = function () { if (window.Notification) Notification.requestPermission().then(function () { alertsPage(main); }); };
    $('#a-test').onclick = function () { pushAlert({ acct: ac ? AF : null, force: true, level: 'warn', symbol: P.symbol, title: 'ทดสอบแจ้งเตือน', text: 'ถ้าเห็นข้อความนี้และได้ยินเสียง แปลว่าแจ้งเตือนทำงาน' }); markRead(AF); renderStrip(); };
    $('#a-clear').onclick = function () { ALERTS = ALERTS.filter(function (a) { return !inAF(a); }); LS.set('oly-alerts', ALERTS); renderAlertList(); };
  }
  OLY.ext.alerts = alertsPage; OLY.alert = pushAlert;

  // ---------------------------------------------------------------- start
  renderStrip();
  setTimeout(function () { pollFeed(); setInterval(pollFeed, 5000); pollAresAlerts(); setInterval(pollAresAlerts, 15000); }, 4000);
  pollLive(); setInterval(pollLive, 1000); setTimeout(function () { pollLevels(); setInterval(pollLevels, 10000); }, 1500);
  OLY.listeners.push(function () { if (!LEVELS) pollLevels(); });
})();
