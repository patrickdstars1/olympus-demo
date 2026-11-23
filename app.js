/* olympus dashboard front end: reads /api/state/<account>, computes everything else in the browser. No trading calls here. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var NS = 'http://www.w3.org/2000/svg';
  var CFG = null, S = null, key = null, page = 'overview', timer = null, drawn = '';
  var F = { period: 'all', strat: 'olympus', symbol: '', side: '', brk: 'strategy', month: null };
  try { key = localStorage.getItem('dash-acct'); } catch (e) {}

  // ---------- formatting
  function num(v, d) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function money(v, d) { if (v == null || isNaN(v)) return '–'; return (v < 0 ? '−$' : '$') + num(Math.abs(v), d); }
  function smoney(v, d) { if (v == null || isNaN(v)) return '–'; return (v > 0 ? '+' : '') + money(v, d); }
  function pct(v, d) { if (v == null || isNaN(v)) return '–'; return num(v, d == null ? 1 : d) + '%'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dkey(t) { var d = new Date(t * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fdt(t) { var d = new Date(t * 1000); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dur(sec) { if (sec < 3600) return Math.round(sec / 60) + 'm'; if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + Math.round((sec % 3600) / 60) + 'm'; return Math.floor(sec / 86400) + 'd ' + Math.floor((sec % 86400) / 3600) + 'h'; }
  function ago(t) { var s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + ' วินาทีที่แล้ว' : s < 5400 ? Math.round(s / 60) + ' นาทีที่แล้ว' : Math.round(s / 3600) + ' ชม.ที่แล้ว'; }
  // approximate equity at which each strategy's minimum lot stays within the 3% risk cap (measured 12 Oct 2026; moves with volatility)
  var MINEQ = { 1888012: 311, 1888021: 528, 1999001: 848, 1999003: 1376, 1888013: 1608, 1999002: 1875, 1888022: 4348 };
  var STR = {}; // magic -> [name, market, tf, family]
  function isOly(t) { return !!STR[t.magic]; }

  // ---------- data helpers
  function periodStart(p) {
    var n = new Date(), d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    if (p === 'today') return d.getTime() / 1000;
    if (p === 'week') { var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.getTime() / 1000; }
    if (p === 'month') return new Date(n.getFullYear(), n.getMonth(), 1).getTime() / 1000;
    if (p === 'quarter') return new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1).getTime() / 1000;
    if (p === 'year') return new Date(n.getFullYear(), 0, 1).getTime() / 1000;
    return 0;
  }
  function stratOk(t) {
    var f = F.strat;
    if (f === 'all') return true; if (f === 'olympus') return (S && S.cfg && S.cfg.manual) ? true : isOly(t); if (f === 'manual') return !isOly(t); return t.strategy === f;
  }
  function filtered(opts) {
    opts = opts || {};
    var t0 = periodStart(F.period);
    return (S.trades || []).filter(function (t) {
      return t.close >= t0 && stratOk(t) && (!opts.sym || !F.symbol || t.symbol === F.symbol) && (!opts.side || !F.side || t.side === F.side);
    });
  }
  var EV = null;
  function events() {
    var ev = [];
    (S.balance_deals || []).forEach(function (b) { if (b.type === 'balance') ev.push([b.t, b.amt]); });
    (S.trades || []).forEach(function (t) { ev.push([t.close, t.net]); });
    ev.sort(function (a, b) { return a[0] - b[0]; });
    var bal = 0; EV = ev.map(function (e) { bal += e[1]; return [e[0], bal]; });
    return EV;
  }
  function balAt(t) { var b = 0; for (var i = 0; i < EV.length; i++) { if (EV[i][0] <= t) b = EV[i][1]; else break; } return b; }

  function metrics(tr) {
    var m = { n: tr.length, wins: 0, losses: 0, net: 0, gw: 0, gl: 0, fees: 0, nosl: 0, rs: [], maxDD: 0, maxDDpct: 0, ws: 0, ls: 0, bw: null, bl: null };
    if (!tr.length) return m;
    var sorted = tr.slice().sort(function (a, b) { return a.close - b.close; });
    var bal = Math.max(balAt(sorted[0].close - 1), 1), peak = bal, curW = 0, curL = 0, holdW = 0, holdL = 0, prevT = sorted[0].close - 1;
    sorted.forEach(function (t) {
      var flows = 0; (S.balance_deals || []).forEach(function (b) { if (b.type === 'balance' && b.t > prevT && b.t <= t.close) flows += b.amt; });
      bal += flows; peak += flows; prevT = t.close;   // deposits/withdrawals are not profit or loss
      m.net += t.net; m.fees += t.comm; if (!t.sl) m.nosl++;
      if (t.net > 0) { m.wins++; m.gw += t.net; curW++; curL = 0; holdW += t.close - t.open; } else { m.losses++; m.gl += -t.net; curL++; curW = 0; holdL += t.close - t.open; }
      m.ws = Math.max(m.ws, curW); m.ls = Math.max(m.ls, curL);
      if (t.r != null) m.rs.push(t.r);
      if (m.bw == null || t.net > m.bw) m.bw = t.net; if (m.bl == null || t.net < m.bl) m.bl = t.net;
      bal += t.net; peak = Math.max(peak, bal);
      var dd = peak - bal; if (dd > m.maxDD) { m.maxDD = dd; m.maxDDpct = peak > 0 ? Math.min(100, dd / peak * 100) : 0; }
    });
    m.wr = m.wins / m.n * 100; m.pf = m.gl > 0 ? m.gw / m.gl : (m.gw > 0 ? Infinity : 0);
    m.exp = m.net / m.n; m.avgW = m.wins ? m.gw / m.wins : 0; m.avgL = m.losses ? -m.gl / m.losses : 0;
    m.expR = m.rs.length ? m.rs.reduce(function (a, b) { return a + b; }, 0) / m.rs.length : null;
    m.sumR = m.rs.reduce(function (a, b) { return a + b; }, 0);
    m.holdW = m.wins ? holdW / m.wins : 0; m.holdL = m.losses ? holdL / m.losses : 0;
    var mean = m.exp, v = tr.reduce(function (a, t) { return a + Math.pow(t.net - mean, 2); }, 0) / Math.max(1, m.n - 1); m.sd = Math.sqrt(v);
    var po = m.avgL ? m.avgW / -m.avgL : 0; m.kelly = (m.avgL && m.n >= 20) ? (m.wr / 100 - (1 - m.wr / 100) / po) * 100 : null;
    m.recovery = m.maxDD > 0 ? m.net / m.maxDD : null;
    return m;
  }

  // ---------- svg helpers
  function svg(w, h) { var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + w + ' ' + h); s.setAttribute('width', w); s.setAttribute('height', h); s.style.maxWidth = '100%'; return s; }
  function sv(p, tag, attrs, text) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; p.appendChild(e); return e; }
  var C = { blue: '#2a78d6', ink: '#14181f', up: '#0f8a55', down: '#c8372f', grid: '#eceff3', muted: '#6a7482' };
  function themeColors() { var cs = getComputedStyle(document.documentElement); ['blue', 'up', 'down', 'grid', 'muted', 'ink'].forEach(function (k) { var v = cs.getPropertyValue('--' + k).trim(); if (v) C[k] = v; }); }
  function niceTicks(lo, hi, n) {
    if (hi - lo < 1e-9) { hi = lo + 1; }
    var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n))), err = (hi - lo) / n / step;
    step *= err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.4 ? 2 : 1;
    var out = [], v = Math.ceil(lo / step) * step; while (v <= hi + 1e-9) { out.push(v); v += step; } return out;
  }
  function tickFmt(v) { var a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : Math.round(a)); }
  function timeAxis(s, t0, t1, x, yb, w) {
    var span = t1 - t0, step = span > 86400 * 200 ? 86400 * 90 : span > 86400 * 40 ? 86400 * 14 : span > 86400 * 7 ? 86400 * 3 : span > 86400 ? 21600 : 3600, first = Math.ceil(t0 / step) * step;
    var last = -1e9;
    for (var t = first; t <= t1; t += step) { var px = x(t); if (px - last < 70) continue; last = px; var d = new Date(t * 1000);
      sv(s, 'text', { x: px, y: yb + 16, 'text-anchor': 'middle' }, span > 86400 * 2 ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : pad(d.getHours()) + ':' + pad(d.getMinutes())); }
  }

  function balanceChart(host) {
    themeColors(); host.textContent = '';
    var W = Math.max(320, host.clientWidth), H = 352, m = { l: 56, r: 64, t: 10, b: 24 }, iw = W - m.l - m.r;
    var t0 = periodStart(F.period), now = S.server_time, evs = events();
    var pts = evs.filter(function (e) { return e[0] >= t0; });
    if (!pts.length) { host.innerHTML = '<div class="empty">ยังไม่มีข้อมูลในช่วงนี้</div>'; return; }
    var startBal = balAt(t0 - 1) || pts[0][1] - 0;
    var series = [[Math.max(t0 || pts[0][0], pts[0][0] - 1), startBal]].concat(pts); series.push([now, series[series.length - 1][1]]);
    var tr = filtered(), cum = [[series[0][0], 0]], c = 0; tr.slice().sort(function (a, b) { return a.close - b.close; }).forEach(function (t) { c += t.net; cum.push([t.close, c]); }); cum.push([now, c]);
    var all = series.map(function (p) { return p[1]; }).concat(cum.map(function (p) { return p[1]; }), (S.curve || []).filter(function (r) { return r.t >= series[0][0]; }).map(function (r) { return r.equity; }));
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all); var pad_ = (hi - lo) * 0.08 || 1; lo -= pad_; hi += pad_;
    var tx0 = series[0][0], tx1 = now, hMain = 220, hdd = 70;
    var s = svg(W, H); host.appendChild(s);
    var x = function (t) { return m.l + (t - tx0) / Math.max(1, tx1 - tx0) * iw; }, y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * hMain; };
    niceTicks(lo, hi, 5).forEach(function (v) { sv(s, 'line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), class: 'gl' }); sv(s, 'text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, tickFmt(v)); });
    var line = function (arr, color, w2, step) { var d = ''; arr.forEach(function (p, i) { var px = x(p[0]), py = y(p[1]); d += (i ? (step ? 'H' + px.toFixed(1) + 'V' + py.toFixed(1) : 'L' + px.toFixed(1) + ' ' + py.toFixed(1)) : 'M' + px.toFixed(1) + ' ' + py.toFixed(1)); }); sv(s, 'path', { d: d, fill: 'none', stroke: color, 'stroke-width': w2, 'stroke-linejoin': 'round' }); };
    var cumAbs = cum.map(function (p) { return [p[0], p[1] + startBal]; });
    line(series, C.ink, 2, true);
    var eqs = (S.curve || []).filter(function (r) { return r.t >= tx0; }).map(function (r) { return [r.t, r.equity]; });
    if (eqs.length > 1) line(eqs, C.muted, 1, false);
    if (tr.length && F.strat !== 'all') line(cumAbs, C.blue, 2, true);   // the filtered trades' own running result
    var lastB = series[series.length - 1][1];
    sv(s, 'rect', { x: m.l + iw + 4, y: y(lastB) - 9, width: 58, height: 18, rx: 3, fill: C.ink }); sv(s, 'text', { x: m.l + iw + 33, y: y(lastB) + 4, 'text-anchor': 'middle', fill: '#fff', style: 'fill:#fff' }, tickFmt(lastB));
    timeAxis(s, tx0, tx1, x, m.t + hMain + hdd + 14, iw);
    // drawdown bars (balance vs its running peak)
    var base = m.t + hMain + 22, peak = -1e18, ddp = [];
    series.forEach(function (p) { peak = Math.max(peak, p[1]); ddp.push([p[0], peak > 0 ? (peak - p[1]) / peak * 100 : 0]); });
    var mx = Math.max.apply(null, ddp.map(function (d) { return d[1]; }).concat([5]));
    sv(s, 'line', { x1: m.l, x2: m.l + iw, y1: base, y2: base, class: 'ax' });
    ddp.forEach(function (d, i) { if (!i) return; var x0 = x(ddp[i - 1][0]), x1 = x(d[0]); if (ddp[i - 1][1] > 0) sv(s, 'rect', { x: x0, y: base, width: Math.max(1, x1 - x0), height: ddp[i - 1][1] / mx * hdd, fill: C.down, opacity: .85 }); });
    sv(s, 'text', { x: m.l - 6, y: base + 10, 'text-anchor': 'end' }, 'DD%'); sv(s, 'text', { x: m.l - 6, y: base + hdd - 2, 'text-anchor': 'end' }, '−' + mx.toFixed(0) + '%');
  }

  function dailyChart(host, tr) {
    themeColors(); host.textContent = '';
    var W = Math.max(300, host.clientWidth), H = 220, m = { l: 48, r: 8, t: 10, b: 28 }, iw = W - m.l - m.r;
    var map = {}; tr.forEach(function (t) { var k = dkey(t.close); map[k] = (map[k] || 0) + t.net; });
    var keys = Object.keys(map).sort().slice(-45);
    if (!keys.length) { host.innerHTML = '<div class="empty">ยังไม่มีไม้ปิดในช่วงนี้</div>'; return; }
    var vals = keys.map(function (k) { return map[k]; }), hi = Math.max.apply(null, vals.concat([1])), lo = Math.min.apply(null, vals.concat([-1]));
    var s = svg(W, H); host.appendChild(s);
    var ih = H - m.t - m.b, y = function (v) { return m.t + (hi - v) / (hi - lo) * ih; }, bw = Math.min(40, iw / keys.length * 0.7);
    niceTicks(lo, hi, 4).forEach(function (v) { sv(s, 'line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), class: 'gl' }); sv(s, 'text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, tickFmt(v)); });
    keys.forEach(function (k, i) {
      var cx = m.l + (i + 0.5) / keys.length * iw, v = map[k], y0 = y(0), y1 = y(v);
      sv(s, 'rect', { x: cx - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), rx: 2, fill: v >= 0 ? C.up : C.down });
      if (keys.length <= 14 || i % Math.ceil(keys.length / 10) === 0) sv(s, 'text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, k.slice(8) + '/' + k.slice(5, 7));
      var tt = document.createElementNS(NS, 'title'); tt.textContent = k + '  ' + smoney(v); s.lastChild.appendChild(tt);
    });
  }

  function calendar(host, tr) {
    var now = new Date(); if (!F.month) F.month = now.getFullYear() * 12 + now.getMonth();
    var y = Math.floor(F.month / 12), mo = F.month % 12, first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
    var map = {}, cnt = {}; tr.forEach(function (t) { var k = dkey(t.close); map[k] = (map[k] || 0) + t.net; cnt[k] = (cnt[k] || 0) + 1; });
    var months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var tot = 0; for (var d0 = 1; d0 <= days; d0++) { var kk = y + '-' + pad(mo + 1) + '-' + pad(d0); if (map[kk]) tot += map[kk]; }
    var h = '<h2><span class="mnav"><button id="cprev" aria-label="เดือนก่อน">‹</button>' + months[mo] + ' ' + y + '<button id="cnext" aria-label="เดือนถัดไป">›</button></span><small class="' + cls(tot) + '">' + smoney(tot) + '</small></h2><div class="cal">';
    ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].forEach(function (d) { h += '<div class="h">' + d + '</div>'; });
    for (var i = 0; i < off; i++) h += '<div></div>';
    for (var d = 1; d <= days; d++) { var k = y + '-' + pad(mo + 1) + '-' + pad(d), v = map[k]; h += '<div class="d ' + (v > 0 ? 'p' : v < 0 ? 'l' : '') + '"><span>' + d + '</span>' + (v != null ? '<b class="' + cls(v) + '">' + (v > 0 ? '+' : '') + num(v, 0) + '</b>' : '<b></b>') + '</div>'; }
    host.innerHTML = h + '</div>';
    $('#cprev', host).onclick = function () { F.month--; calendar(host, tr); }; $('#cnext', host).onclick = function () { F.month++; calendar(host, tr); };
  }

  // ---------- derived account facts
  function parsePeak() { var t = S.log && S.log.init && S.log.init.text; var m = t && t.match(/peak ([\d.]+)/); return m ? parseFloat(m[1]) : null; }
  function ddNow() {
    var eq = S.account.equity, peak = parsePeak() || eq;
    (S.curve || []).forEach(function (r) { if (S.log && S.log.init) peak = Math.max(peak, r.equity); }); peak = Math.max(peak, eq);
    return { peak: peak, dd: peak > 0 ? (1 - eq / peak) * 100 : 0 };
  }
  function olyPositions() { return (S.positions || []).filter(function (p) { return !!STR[p.magic]; }); }

  // ---------- page shell
  function top(title, sub) {
    var live = S && S.ok;
    return '<div class="top"><div><h1>' + title + '</h1><div class="sub">' + sub + '</div></div><div class="sync"><span class="dot ' + (live ? '' : 'off') + '"></span><span>' + (live ? 'ซิงก์ ' + ago(S.ts) : 'ยังไม่ได้ข้อมูล') + '</span><button class="btn" id="sync">Sync</button></div></div>';
  }
  function banners() {
    var h = '';
    if (!S.ok) return '<div class="banner bad"><b>อ่าน MT5 ไม่ได้:</b> ' + esc(S.error || '') + (/ไม่ได้เปิดอยู่/.test(S.error || '') ? ' (ปิดอยู่ ข้อมูลจะกลับมาเองภายในไม่กี่วินาทีหลังเปิดอีกครั้ง)' : '') + (/ไม่ได้เปิดอยู่/.test(S.error || '') ? ' <button class="btn" id="launchbtn">เปิด MT5 ให้</button> <span id="launchmsg" class="s"></span>' : '') + '</div>';
    if (S.terminal && !S.terminal.connected) h += '<div class="banner bad"><b>MT5 ไม่ได้ต่อ server</b> บอทเทรดไม่ได้</div>';
    if (S.terminal && !S.terminal.algo && !(S.cfg && S.cfg.manual && !S.cfg.bot_name)) h += (S.log && S.log.source === 'VPS')
      ? '<div class="banner"><b>Algo Trading ในเครื่องนี้ปิดอยู่</b> ปกติถ้า olympus รันบน VPS (log ที่แสดงมาจาก VPS ดูสถานะ VPS ในการ์ดด้านล่าง) ไม่ต้องเปิดฝั่งเครื่องนี้ ห้ามเปิดซ้อนกับ VPS</div>'
      : '<div class="banner warn"><b>Algo Trading ปิดอยู่ใน MT5 บัญชีนี้</b> olympus จะไม่เทรดจนกว่าจะเปิดปุ่ม Algo Trading ให้เป็นสีเขียว</div>';
    if (S.vps && !(S.cfg && S.cfg.manual) && ['stale', 'stopped', 'noea', 'disconnected'].indexOf(S.vps.state) >= 0) h += '<div class="banner bad"><b>VPS มีปัญหา:</b> ' + esc(S.vps.text) + ' · บอทบน VPS อาจไม่ได้เทรด ตรวจที่ MT5 → Tools → Options → VPS</div>';
    var ev = S.log && S.log.events && S.log.events.length ? S.log.events[S.log.events.length - 1] : null;
    if (ev) h += '<div class="banner bad"><b>olympus ถูกหยุดแล้ว</b> ' + esc(ev.date + ' ' + ev.time) + ' · ' + esc(ev.text) + ' · เริ่มใหม่ต้องตั้ง InpResetKill</div>';
    if (S.log && S.log.errors && S.log.errors.length) h += '<div class="banner warn"><b>พบ error ใน log ' + S.log.errors.length + ' รายการ</b> ล่าสุด: ' + esc(S.log.errors[S.log.errors.length - 1]) + '</div>';
    if (Date.now() / 1000 - S.ts > 300) h += '<div class="banner warn">ข้อมูลเก่า ' + ago(S.ts) + ' (ตัวอ่าน MT5 ไม่ได้อัปเดต)</div>';
    var nosl = (S.positions || []).filter(function (p) { return !p.sl; });
    if (nosl.length) h += '<div class="banner warn"><b>มี ' + nosl.length + ' ไม้ไม่มี Stop Loss</b> (' + nosl.map(function (p) { return esc(p.strategy) + ' ' + esc(p.symbol); }).join(', ') + ')</div>';
    return h;
  }
  function filterBar(opts) {
    opts = opts || {};
    var per = [['all', 'ทั้งหมด'], ['today', 'วันนี้'], ['week', 'สัปดาห์นี้'], ['month', 'เดือนนี้'], ['quarter', 'ไตรมาส'], ['year', 'ปีนี้']];
    var h = '<div class="filters"><div class="seg" id="seg">' + per.map(function (p) { return '<button data-v="' + p[0] + '" class="' + (F.period === p[0] ? 'on' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>';
    var names = Object.keys(STR).map(function (m) { return STR[m][0]; });
    h += '<select id="fs"><option value="olympus"' + (F.strat === 'olympus' ? ' selected' : '') + '>เฉพาะ olympus</option><option value="all"' + (F.strat === 'all' ? ' selected' : '') + '>ทุกไม้</option><option value="manual"' + (F.strat === 'manual' ? ' selected' : '') + '>เฉพาะไม้ Manual</option>' + names.map(function (n) { return '<option' + (F.strat === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>';
    if (opts.sym) {
      var syms = Array.from(new Set((S.trades || []).map(function (t) { return t.symbol; }))).sort();
      h += '<select id="fy"><option value="">ทุกสัญลักษณ์</option>' + syms.map(function (x) { return '<option' + (F.symbol === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>';
      h += '<select id="fd"><option value="">ทุกฝั่ง</option><option' + (F.side === 'BUY' ? ' selected' : '') + '>BUY</option><option' + (F.side === 'SELL' ? ' selected' : '') + '>SELL</option></select>';
    }
    return h + '<span class="cnt">' + filtered(opts).length + ' / ' + (S.trades || []).length + '</span></div>';
  }
  function bindFilters(rerender) {
    var seg = $('#seg'); if (seg) seg.onclick = function (e) { var b = e.target.closest('button'); if (b) { F.period = b.dataset.v; rerender(); } };
    var a = $('#fs'); if (a) a.onchange = function () { F.strat = a.value; rerender(); };
    var b = $('#fy'); if (b) b.onchange = function () { F.symbol = b.value; rerender(); };
    var c = $('#fd'); if (c) c.onchange = function () { F.side = c.value; rerender(); };
  }
  function bindSync() { var b = $('#sync'); if (b) b.onclick = function () { b.disabled = true; b.textContent = '…'; fetch('/api/refresh', { method: 'POST', headers: { 'X-Dash': '1' } }).then(function () { setTimeout(load, 6000); }); }; }

  // ---------- pages
  function pOverview(main) {
    var tr = filtered(), m = metrics(tr), a = S.account, rc = S.reconcile || {}, dn = ddNow(), cfg = S.cfg;
    var openRisk = olyPositions().reduce(function (s, p) { return s + p.risk; }, 0), floating = (S.positions || []).reduce(function (s, p) { return s + p.profit; }, 0);
    var h = top('ภาพรวม', 'ผลเทรดที่ตรงกับ MT5 · ' + esc(S.label) + ' · ' + S.login) + (OLY.statusCard ? OLY.statusCard() : '') + banners() + '<div id="radar-slot"></div>' + filterBar();
    h += '<div class="cards c4"><div class="c"><span class="k"><i class="ki">📈</i>กำไรสุทธิ</span><span class="v ' + cls(m.net) + '">' + smoney(m.net) + '</span><span class="s">ค่าคอม/สวอป ' + smoney(m.fees) + ' · ' + m.n + ' เทรด</span></div>' +
      '<div class="c"><span class="k"><i class="ki">💰</i>EQUITY</span><span class="v">' + money(a.equity) + '</span><span class="s">Balance ' + money(a.balance) + (a.profit ? ' · ลอยตัว ' + smoney(a.profit) : '') + '</span></div>' +
      '<div class="c"><span class="k"><i class="ki">📌</i>ไม้ที่เปิดอยู่</span><span class="v">' + (S.positions || []).length + '</span><span class="s">ความเสี่ยงรวม olympus ' + money(openRisk) + ' (' + pct(a.equity ? openRisk / a.equity * 100 : 0) + ')</span></div>' +
      '<div class="c"><span class="k"><i class="ki">🛡</i>MARGIN LEVEL</span><span class="v">' + (a.margin ? pct(a.margin_level, 0) : '–') + '</span><span class="s">Margin ใช้อยู่ ' + money(a.margin) + ' · leverage 1:' + a.leverage + '</span></div></div>';
    h += '<div class="cards c6">' +
      c6('อัตราชนะ', m.n ? pct(m.wr) : '–', m.wins + 'W · ' + m.losses + 'L') + c6('Profit factor', m.n ? (isFinite(m.pf) ? num(m.pf) : '∞') : '–', m.n ? 'payoff ' + (m.avgL ? num(m.avgW / -m.avgL) : '–') : '') +
      c6('Expectancy', m.n ? smoney(m.exp) : '–', m.expR != null ? num(m.expR) + 'R · n=' + m.rs.length : '') + c6('เฉลี่ยชนะ / แพ้', m.n ? smoney(m.avgW) : '–', m.n ? smoney(m.avgL) : '') +
      c6('Max drawdown', m.n ? '−' + money(m.maxDD).replace('$', '$') : '–', m.n ? '−' + pct(m.maxDDpct) : '') + c6('ไม่มี SL', String(m.nosl), 'ในไม้ที่ปิดแล้ว (ควรเป็น 0)') + '</div>';
    var dep = rc.deposits || 0;
    h += '<div class="recon"><span class="badge ' + (Math.abs((rc.deposits || 0) + (rc.trades || 0) + (rc.credit || 0) + (rc.other || 0) - a.balance) < 0.05 ? 'demo' : 'live') + '">' + (Math.abs((rc.deposits || 0) + (rc.trades || 0) + (rc.credit || 0) + (rc.other || 0) - a.balance) < 0.05 ? 'ตรงกับ MT5' : 'ไม่ตรงกับ MT5') + '</span>เงินฝากสุทธิ <b>' + money(dep) + '</b> + ผลเทรดทุกไม้ <b>' + smoney(rc.trades) + '</b> = <b>' + money((rc.deposits || 0) + (rc.trades || 0) + (rc.credit || 0) + (rc.other || 0)) + '</b> · balance จริง <b>' + money(a.balance) + '</b>' + (S.reconcile && F.strat !== 'all' ? ' <span class="s">(ตัวเลขนี้รวมทุกไม้ในบัญชีเสมอ ไม่ตามตัวกรอง)</span>' : '') + '</div>';
    h += '<div class="grid2"><div class="card"><h2>Balance <small>เส้นดำ = balance · เส้นฟ้า = ผลเทรดสะสมของที่กรอง · เทา = equity</small></h2><div class="plot" id="bal"></div></div>' + planCard(dn) + '</div>';
    h += '<div class="grid2b"><div class="card"><h2>กำไร/ขาดทุนรายวัน <small>45 วันล่าสุดที่มีไม้</small></h2><div class="plot" id="daily"></div></div><div class="card" id="cal"></div></div>';
    main.innerHTML = h; if (SOFT) return; bindFilters(function () { render(); }); bindSync();
    balanceChart($('#bal')); dailyChart($('#daily'), tr); calendar($('#cal'), tr);
    if (OLY.afterOverview) OLY.afterOverview($('#radar-slot'));
  }
  function c6(k, v, s) { return '<div class="c"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + s + '</span></div>'; }
  function planCard(dn) {
    var cfg = S.cfg, a = S.account, lines = (CFG.dd_lines || [15, 25, 32]), scaleMax = 40, h = '<div class="card"><h2>เส้นหยุดตามแผน <small>แผนทดลอง</small></h2>';
    h += '<div><div class="k">Drawdown จากจุดสูงสุด (มุมมองของ Kill Switch)</div><div class="v ' + (dn.dd >= lines[0] ? 'warn' : '') + '" style="font-size:22px">' + pct(dn.dd) + '</div><div class="bar" style="margin:8px 0 18px"><i style="width:' + Math.min(100, dn.dd / scaleMax * 100) + '%"></i>' +
      lines.map(function (l) { return '<u style="left:' + l / scaleMax * 100 + '%"></u>'; }).join('') + '</div><div class="s" style="display:flex;justify-content:space-between"><span>0%</span>' + lines.map(function (l) { return '<span>' + l + '%</span>'; }).join('') + '</div>' + (cfg.manual ? '<div class="chips"><span class="chip2 plain">peak ' + money(dn.peak) + '</span></div>' : '<div class="chips"><span class="chip2 ' + (dn.dd >= 15 ? 'hit' : '') + '">15% → ½</span><span class="chip2 ' + (dn.dd >= 25 ? 'hit' : '') + '">25% → ¼</span><span class="chip2 ' + (dn.dd >= 32 ? 'hit' : '') + '">32% → Kill Switch</span><span class="chip2 plain">peak ' + money(dn.peak) + '</span></div>') + '</div>';
    if (cfg.stop_equity) {
      var span = Math.max(1, (cfg.deposit || a.balance) - cfg.stop_equity), used = Math.max(0, Math.min(1, ((cfg.deposit || a.balance) - a.equity) / span));
      h += '<div><div class="k">เส้นหยุดของคุณ: equity ต่ำกว่า ' + money(cfg.stop_equity, 0) + '</div><div class="gauge"><svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--chip)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="' + (used > .66 ? 'var(--down)' : 'var(--ink)') + '" stroke-width="4" stroke-dasharray="' + (used * 94.2).toFixed(1) + ' 94.2" transform="rotate(-90 18 18)"/></svg><div><div class="v" style="font-size:18px">' + money(a.equity) + '</div><div class="s">เหลือก่อนถึงเส้นหยุด ' + money(Math.max(0, a.equity - cfg.stop_equity)) + ' (เริ่มที่ ' + money(cfg.deposit) + ')</div></div></div></div>';
    }
    var v = S.verify;
    if (!cfg.manual) h += '<div><div class="k">ผลตรวจเทียบ backtest ล่าสุด</div>' + (v ? '<div><span class="badge ' + (v.verdict === 'PASS' ? 'demo' : v.verdict === 'FAIL' ? 'live' : '') + '">' + esc(v.verdict) + '</span> <span class="s">' + esc(v.file) + '</span></div><div class="s">' + esc(v.note) + '</div>' : '<div class="s">ยังไม่เคยรัน dd_verify</div>') + '</div>';
    h += (cfg.manual ? '' : '<div><div class="k">olympus</div><div class="s">' + (S.log && S.log.init ? esc(S.log.init.text) + '<br>โหลดเมื่อ ' + esc(S.log.init.date + ' ' + S.log.init.time) : 'ไม่พบบรรทัดเริ่มทำงานใน log') + '</div></div>') + '</div>';
    return h;
  }

  function pTrade(main) {
    var pos = S.positions || [], ord = S.orders || [], a = S.account, OO = !!(OLY.orderOn && OLY.orderOn());
    var fl = pos.reduce(function (s, p) { return s + p.profit; }, 0), rk = olyPositions().reduce(function (s, p) { return s + p.risk; }, 0);
    var h = top('ไม้ที่เปิดอยู่', (OO ? 'ปิดไม้ ปิดครึ่ง และแก้ SL/TP ได้จากหน้านี้ · ส่งออเดอร์ใหม่ที่หน้ากราฟ' : 'ดูอย่างเดียว ไม่มีการส่งคำสั่งจากหน้านี้ (olympus เป็นผู้เปิด/ปิดไม้เอง)')) + banners();
    h += '<div class="cards c4"><div class="c"><span class="k">ไม้ที่เปิด</span><span class="v">' + pos.length + '</span><span class="s">olympus ' + olyPositions().length + ' · Manual ' + (pos.length - olyPositions().length) + '</span></div>' +
      '<div class="c"><span class="k">กำไร/ขาดทุนลอยตัว</span><span class="v ' + cls(fl) + '">' + smoney(fl) + '</span><span class="s">รวมสวอป</span></div>' +
      '<div class="c"><span class="k">ความเสี่ยงรวม olympus</span><span class="v">' + money(rk) + '</span><span class="s">' + pct(a.equity ? rk / a.equity * 100 : 0) + ' ของ equity (เพดาน 20%)</span></div>' +
      '<div class="c"><span class="k">ออเดอร์ค้าง</span><span class="v">' + ord.length + '</span><span class="s">pending</span></div></div>';
    var slSum = pos.reduce(function (t, p) { return t + (p.sl && p.sl_money != null ? p.sl_money : 0); }, 0), tpSum = pos.reduce(function (t, p) { return t + (p.tp && p.tp_money != null ? p.tp_money : 0); }, 0), nTp = pos.filter(function (p) { return p.tp; }).length;
    if (pos.length) h += '<div class="outcome"><div class="oc down"><i class="oi">▼</i><div><div class="k">ถ้าทุกไม้โดน SL เสียรวม</div><div class="v down">' + smoney(slSum) + '</div><div class="s">' + pct(a.equity ? -slSum / a.equity * 100 : 0) + ' ของ equity</div></div></div>' +
      '<div class="oc up"><i class="oi">▲</i><div><div class="k">ถ้าทุกไม้ที่ตั้ง TP ถึงเป้า ได้รวม</div><div class="v up">' + (nTp ? smoney(tpSum) : '–') + '</div><div class="s">' + nTp + ' จาก ' + pos.length + ' ไม้ตั้ง TP</div></div></div>' +
      '<div class="oc"><i class="oi">⚖</i><div><div class="k">ได้ : เสีย</div><div class="v">' + (nTp && slSum ? num(tpSum / -slSum) + ' : 1' : '–') + '</div><div class="s">ยังไม่รวมสวอป/ค่าคอม</div></div></div></div>';
    h += '<div class="card"><h2>ไม้ที่เปิดอยู่</h2>' + (pos.length ? '<div class="tbl"><table><thead><tr><th>กลยุทธ์</th><th>สัญลักษณ์</th><th>ฝั่ง</th><th class="n">Lot</th><th>เปิดเมื่อ</th><th class="n">ราคาเข้า</th><th class="n">ราคาปัจจุบัน</th><th class="n">SL</th><th class="n">เสียถ้าโดน SL</th><th class="n">TP</th><th class="n">ได้ถ้าถึง TP</th><th class="n">ความเสี่ยง</th><th class="n">กำไร/ขาดทุน</th>' + (OO ? '<th></th>' : '') + '</tr></thead><tbody>' +
      pos.map(function (p) { return '<tr><td>' + esc(p.strategy) + '</td><td>' + esc(p.symbol) + '</td><td><span class="tag ' + p.side.toLowerCase() + '">' + p.side + '</span></td><td class="n">' + p.lot + '</td><td>' + fdt(p.open) + '</td><td class="n">' + num(p.open_price, 2) + '</td><td class="n">' + num(p.price, 2) + '</td><td class="n">' + (p.sl ? num(p.sl, 2) : '<span class="tag nosl">No SL</span>') + '</td><td class="n down">' + (p.sl && p.sl_money != null ? smoney(p.sl_money) : '–') + '</td><td class="n">' + (p.tp ? num(p.tp, 2) : '<span class="s">ไม่ตั้ง</span>') + '</td><td class="n up">' + (p.tp && p.tp_money != null ? smoney(p.tp_money) : '–') + '</td><td class="n">' + (p.risk ? money(p.risk) : '–') + '</td><td class="n ' + cls(p.profit) + '">' + smoney(p.profit) + '</td>' + (OO ? '<td class="n oacts"><button class="btn sm" data-oact="close" data-t="' + p.ticket + '">ปิด</button><button class="btn sm" data-oact="half" data-t="' + p.ticket + '">ปิดครึ่ง</button><button class="btn sm" data-oact="be" data-t="' + p.ticket + '" title="Break-even: เลื่อน SL มาที่ราคาเข้า">BE</button><button class="btn sm" data-oact="sltp" data-t="' + p.ticket + '">SL/TP</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">ไม่มีไม้เปิดอยู่ olympus ตัดสินใจตอนปิดแท่ง H4 (ทุก 4 ชม.) และ D1</div>') + '</div>';
    h += '<div class="card"><h2>ออเดอร์ค้าง</h2>' + (ord.length ? '<div class="tbl"><table><thead><tr><th>สัญลักษณ์</th><th class="n">Lot</th><th class="n">ราคา</th><th class="n">SL</th><th class="n">TP</th><th>ตั้งเมื่อ</th><th>Comment</th>' + (OO ? '<th></th>' : '') + '</tr></thead><tbody>' + ord.map(function (o) { return '<tr><td>' + esc(o.symbol) + '</td><td class="n">' + o.lot + '</td><td class="n">' + num(o.price, 2) + '</td><td class="n">' + (o.sl || '–') + '</td><td class="n">' + (o.tp || '–') + '</td><td>' + fdt(o.time) + '</td><td>' + esc(o.comment) + '</td>' + (OO ? '<td class="n oacts"><button class="btn sm" data-oact="cancel" data-t="' + o.ticket + '">ยกเลิก</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">ไม่มีออเดอร์ค้าง</div>') + '</div>';
    main.innerHTML = h; if (!SOFT) bindSync();
  }

  function pJournal(main) {
    var tr = filtered({ sym: 1, side: 1 }).slice().sort(function (a, b) { return b.close - a.close; }), m = metrics(tr);
    var h = top('บันทึกเทรด', 'ทุกเทรดที่สร้างจาก deal ของ MT5') + banners() + filterBar({ sym: 1 });
    h += '<div class="recon"><b>' + tr.length + '</b> เทรด · <b class="' + cls(m.net) + '">' + smoney(m.net) + '</b> · WR <b>' + (m.n ? pct(m.wr) : '–') + '</b> · PF <b>' + (m.n ? (isFinite(m.pf) ? num(m.pf) : '∞') : '–') + '</b><span style="margin-left:auto"><button class="btn" id="csv">ส่งออก CSV</button></span></div>';
    h += '<div class="tbl"><table><thead><tr><th>ปิด</th><th>สัญลักษณ์</th><th>ฝั่ง</th><th class="n">Lot</th><th class="n">เข้า</th><th class="n">ออก</th><th class="n">SL แรก</th><th class="n">จุด</th><th class="n">ค่าคอม</th><th class="n">สุทธิ</th><th class="n">R</th><th class="n">ระยะถือ</th><th>กลยุทธ์</th><th>ออกด้วย</th></tr></thead><tbody>' +
      (tr.length ? tr.map(function (t) { return '<tr><td>' + fdt(t.close) + '</td><td>' + esc(t.symbol) + '</td><td><span class="tag ' + t.side.toLowerCase() + '">' + t.side + '</span></td><td class="n">' + t.lot + '</td><td class="n">' + num(t.open_price, 2) + '</td><td class="n">' + num(t.close_price, 2) + '</td><td class="n">' + (t.sl ? num(t.sl, 2) : '<span class="tag nosl">No SL</span>') + '</td><td class="n ' + cls(t.points) + '">' + (t.points > 0 ? '+' : '') + t.points + '</td><td class="n">' + num(t.comm) + '</td><td class="n ' + cls(t.net) + '">' + smoney(t.net) + '</td><td class="n ' + cls(t.r) + '">' + (t.r == null ? '–' : (t.r > 0 ? '+' : '') + num(t.r) + 'R') + '</td><td class="n">' + dur(t.close - t.open) + '</td><td>' + esc(t.strategy) + '</td><td><span class="tag">' + esc(t.reason) + '</span></td></tr>'; }).join('') : '<tr><td colspan="14" class="empty">ไม่มีเทรดตามตัวกรอง</td></tr>') + '</tbody></table></div>';
    main.innerHTML = h; bindFilters(render); bindSync();
    $('#csv').onclick = function () {
      var rows = [['close', 'symbol', 'side', 'lot', 'open_price', 'close_price', 'sl', 'points', 'fees', 'net', 'R', 'hold_sec', 'strategy', 'reason']].concat(tr.map(function (t) { return [new Date(t.close * 1000).toISOString(), t.symbol, t.side, t.lot, t.open_price, t.close_price, t.sl, t.points, t.comm, t.net, t.r == null ? '' : t.r, t.close - t.open, t.strategy, t.reason]; }));
      var blob = new Blob(['\ufeff' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n')], { type: 'text/csv' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'trades_' + S.login + '.csv' }); document.body.appendChild(a); a.click(); a.remove();
    };
  }

  function groupBy(tr, fn) { var g = {}; tr.forEach(function (t) { var k = fn(t); (g[k] = g[k] || []).push(t); }); return g; }
  function pAnalytics(main) {
    var tr = filtered(), m = metrics(tr);
    var h = top('วิเคราะห์', 'ตัวชี้วัดความเสี่ยงและการแยกผล') + banners() + filterBar();
    var span = tr.length ? (tr[tr.length - 1].close - tr[0].close) / 86400 : 0;
    h += '<div class="grid2b"><div class="card"><h2>ตัวชี้วัดความเสี่ยง</h2><div class="kv">' + [
      ['กำไรสูงสุด / ขาดทุนสูงสุด (ไม้เดียว)', m.n ? smoney(m.bw) + ' / ' + smoney(m.bl) : '–'], ['SD ต่อเทรด', m.n ? money(m.sd) : '–'], ['Kelly', m.kelly != null ? pct(m.kelly) : '– (ต้องมี ≥ 20 ไม้)'],
      ['ชนะติดกันสูงสุด', m.n ? m.ws : '–'], ['แพ้ติดกันสูงสุด', m.n ? m.ls : '–'], ['ถือไม้ชนะเฉลี่ย', m.n && m.wins ? dur(m.holdW) : '–'], ['ถือไม้แพ้เฉลี่ย', m.n && m.losses ? dur(m.holdL) : '–'],
      ['Max DD (ของที่กรอง)', m.n ? '−' + money(m.maxDD) + ' · −' + pct(m.maxDDpct) : '–'], ['Recovery factor', m.recovery != null ? num(m.recovery) : '–'], ['R รวม', m.rs.length ? num(m.sumR) + 'R' : '–'], ['ค่าคอม/สวอปรวม', m.n ? smoney(m.fees) : '–'], ['ช่วงเวลาที่มีไม้', tr.length ? num(span, 0) + ' วัน' : '–']
    ].map(function (r) { return '<span>' + r[0] + '</span><span>' + r[1] + '</span>'; }).join('') + '</div>' + (m.n < 30 ? '<div class="banner warn">ไม้น้อยกว่า 30 ไม้ ตัวเลขเหล่านี้ยังไม่มีความหมายทางสถิติ (ตามเกณฑ์ในแผนทดลอง)</div>' : '') + '</div>';
    h += '<div class="card"><h2>แยกผลตาม</h2><div class="tabs" id="tabs">' + [['strategy', 'กลยุทธ์'], ['symbol', 'สัญลักษณ์'], ['side', 'ฝั่ง'], ['hour', 'ชั่วโมง'], ['dow', 'วัน'], ['month', 'เดือน'], ['hold', 'ระยะถือ'], ['reason', 'วิธีออก']].map(function (t) { return '<button data-v="' + t[0] + '" class="' + (F.brk === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="brk"></div></div></div>';
    main.innerHTML = h; bindFilters(render); bindSync(); $('#tabs').onclick = function (e) { var b = e.target.closest('button'); if (b) { F.brk = b.dataset.v; render(); } };
    var fn = { strategy: function (t) { return t.strategy; }, symbol: function (t) { return t.symbol; }, side: function (t) { return t.side; }, hour: function (t) { return pad(new Date(t.open * 1000).getHours()) + ':00'; }, dow: function (t) { return ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][new Date(t.close * 1000).getDay()]; }, month: function (t) { return dkey(t.close).slice(0, 7); }, hold: function (t) { var s = t.close - t.open; return s < 3600 ? '< 1 ชม.' : s < 86400 ? '1–24 ชม.' : s < 86400 * 5 ? '1–5 วัน' : '> 5 วัน'; }, reason: function (t) { return t.reason; } }[F.brk];
    var g = groupBy(tr, fn), rows = Object.keys(g).sort().map(function (k) { var mm = metrics(g[k]); return { k: k, n: g[k].length, wr: mm.wr, pf: mm.pf, net: mm.net }; });
    if (F.brk === 'strategy') rows.sort(function (a, b) { return b.net - a.net; });
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.net); }).concat([1]));
    $('#brk').innerHTML = rows.length ? '<div class="bars">' + rows.map(function (r) { return '<div class="r"><span>' + esc(r.k) + ' <span class="s">n=' + r.n + '</span></span><div class="t"><i style="' + (r.net >= 0 ? 'left:50%;width:' + r.net / mx * 50 : 'right:50%;width:' + -r.net / mx * 50) + '%;background:' + (r.net >= 0 ? 'var(--up)' : 'var(--down)') + '"></i></div><span class="' + cls(r.net) + '" style="text-align:right;font-family:var(--fm)">' + smoney(r.net) + '</span></div>'; }).join('') + '</div>' +
      '<div class="tbl" style="margin-top:12px"><table><thead><tr><th>กลุ่ม</th><th class="n">n</th><th class="n">WR</th><th class="n">PF</th><th class="n">สุทธิ</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.k) + '</td><td class="n">' + r.n + '</td><td class="n">' + pct(r.wr, 0) + '</td><td class="n">' + (isFinite(r.pf) ? num(r.pf) : '∞') + '</td><td class="n ' + cls(r.net) + '">' + smoney(r.net) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">ยังไม่มีข้อมูลตามตัวกรอง</div>';
  }

  function pStrategies(main) {
    var allT = (S.trades || []).filter(isOly), skips = (S.log && S.log.skips) || {}, pos = S.positions || [];
    var h = top('กลยุทธ์ olympus', '7 กลยุทธ์ในบัญชีเดียว ผลตั้งแต่เริ่มบัญชี') + banners();
    if (OLY.isAres && OLY.isAres()) { main.innerHTML = h + OLY.aresBox(); return; }
    if (S.cfg && S.cfg.manual) { main.innerHTML = h + '<div class="card"><h2>บัญชีนี้เทรดมือ</h2><div class="s" style="font-size:14px">ไม่มีบอท olympus ทำงานในบัญชีนี้ (ไม่ใช้ VPS) จึงไม่มีสถานะกลยุทธ์ให้ดู ดูผลเทรดที่หน้า ภาพรวม / บันทึกเทรด / วิเคราะห์ ส่วนการทดสอบบอทดูได้ที่บัญชี Demo (เลือกบัญชีด้านบน)</div></div>'; return; }
    h += '<div class="card"><h2>สถานะ olympus</h2><div class="kv"><span>บรรทัดเริ่มทำงานล่าสุด</span><span style="font-family:var(--f);font-size:12px;max-width:520px">' + (S.log && S.log.init ? esc(S.log.init.text) : '–') + '</span><span>Algo Trading</span><span class="' + (S.terminal.algo ? 'up' : 'down') + '">' + (S.terminal.algo ? 'เปิด' : 'ปิด') + '</span><span>การเชื่อมต่อ</span><span class="' + (S.terminal.connected ? 'up' : 'down') + '">' + (S.terminal.connected ? 'ต่อแล้ว' : 'ไม่ได้ต่อ') + '</span><span>แท่งที่พลาด (ปิดเครื่อง) 7 วัน</span><span>' + (S.log ? S.log.missed : '–') + ' ครั้ง</span><span>Error ใน log 7 วัน</span><span>' + (S.log ? S.log.errors.length : '–') + '</span><span>แหล่ง log</span><span style="font-family:var(--f)">' + (S.log ? esc(S.log.source) + (S.log.vps_synced ? ' · ซิงก์ ' + ago(S.log.vps_synced) : '') : '–') + '</span></div></div>';
    h += '<div class="scards">' + Object.keys(STR).map(function (mg) {
      var st = STR[mg], t = allT.filter(function (x) { return x.magic == mg; }), mm = metrics(t), p = pos.filter(function (x) { return x.magic == mg; })[0], sk = skips[st[0]] || 0;
      var need = MINEQ[mg], low = need && S.account.equity < need, status = p ? ['กำลังถือไม้', 'demo'] : (low ? ['ทุนยังไม่ถึงเกณฑ์', 'live'] : (!t.length && sk ? ['ข้ามไม้ (lot ขั้นต่ำ)', 'live'] : ['รอสัญญาณ', '']));
      return '<div class="scard"><h3>' + esc(st[0]) + '<span class="badge ' + status[1] + '">' + status[0] + '</span></h3><div class="s">' + esc(st[1]) + ' · ' + st[2] + ' · ' + (st[3] === 'trend' ? 'ตามเทรนด์' : 'ซื้อตอนย่อ') + '</div><div class="kv">' +
        '<span>ไม้ที่ปิดแล้ว</span><span>' + t.length + '</span><span>WR / PF</span><span>' + (t.length ? pct(mm.wr, 0) + ' / ' + (isFinite(mm.pf) ? num(mm.pf) : '∞') : '–') + '</span><span>กำไรสุทธิ</span><span class="' + cls(mm.net) + '">' + (t.length ? smoney(mm.net) : '–') + '</span>' +
        '<span>ไม้ปัจจุบัน</span><span>' + (p ? p.side + ' ' + p.lot + ' · ' + smoney(p.profit) : 'ไม่มี') + '</span><span>ทุนขั้นต่ำโดยประมาณ</span><span class="' + (low ? 'down' : '') + '">' + (need ? money(need, 0) : '–') + '</span><span>ข้ามไม้ (lot ขั้นต่ำ) 7 วัน</span><span>' + sk + ' ครั้ง</span><span>เทรดล่าสุด</span><span>' + (t.length ? fdt(t[t.length - 1].close) : '–') + '</span></div></div>';
    }).join('') + '</div>';
    h += '<div class="card"><h2>Log ล่าสุดของ olympus <small>' + (S.log ? esc(S.log.source) : '') + ' · ' + ((S.log && S.log.recent) ? S.log.recent.length : 0) + ' บรรทัดล่าสุด (ไม่รวมค่า Inputs)</small></h2>' + ((S.log && S.log.recent && S.log.recent.length) ? '<div class="tbl" style="max-height:340px"><table><thead><tr><th>เวลา</th><th>ข้อความ</th></tr></thead><tbody>' + S.log.recent.slice().reverse().map(function (r) { return '<tr><td>' + esc(r.date.slice(5) + ' ' + r.time) + '</td><td style="white-space:normal">' + esc(r.text) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">ไม่มี log</div>') + '<div class="s">เวลาของ log VPS เป็นเวลาของเซิร์ฟเวอร์ VPS (ช้ากว่าเวลาไทยราว 5 ชั่วโมงตอนนี้) log VPS จะมาถึงเครื่องนี้เมื่อ MT5 ในเครื่องเปิดอยู่</div></div>';
    h += '<div class="card"><h2>วิธีเริ่ม olympus ใหม่หลังกดหยุดหรือ Kill Switch</h2><ol style="margin:0;padding-left:20px;font-size:14px"><li>ทบทวนสาเหตุก่อน (ตามแผนทดลอง: อย่ารีเซ็ตทันที)</li><li>ใน MT5: คลิกขวาที่กราฟที่มี olympus → Expert Advisors → Properties → Inputs ตั้ง <code>InpResetKill = true</code> กด OK</li><li>เปิด Properties อีกครั้ง ตั้ง <code>InpResetKill = false</code> กด OK</li><li>ดูแท็บ Experts ว่าขึ้น <code>olympus: 7 strategies …</code> peak ใหม่จะเริ่มนับจาก equity ตอนนั้น</li></ol></div>';
    main.innerHTML = h; bindSync();
  }

  function pSettings(main) {
    var c = S.cfg, since = c.since, dep = c.deposit;
    var verify = 'python tools\\dd_verify.py --login ' + c.login + ' --exe "' + c.exe + '"' + (c.portable ? ' --portable' : '') + ' --data "' + c.data + '" --since ' + since + ' --deposit ' + dep + ' --scale ' + c.scale;
    var monthly = 'python tools\\dd_monthly.py --login ' + c.login + ' --exe "' + c.exe + '"' + (c.portable ? ' --portable' : '') + ' --label "' + c.label + '"';
    var h = top('ตั้งค่าและคำสั่ง', 'ค่าที่แดชบอร์ดใช้ (แก้ในไฟล์ dashboard\\config.json แล้วรีสตาร์ทโปรแกรม)') + banners();
    h += '<div class="grid2b"><div class="card"><h2>บัญชี ' + esc(S.label) + '</h2><div class="kv"><span>ประเภท</span><span>' + esc(c.kind) + '</span><span>เลขบัญชี</span><span>' + c.login + '</span><span>Server</span><span>' + esc(c.server) + '</span><span>เริ่มทดลองวันที่</span><span>' + esc(since) + '</span><span>ทุนเริ่มต้น</span><span>' + money(dep) + '</span><span>InpRiskScale ที่ตั้งไว้</span><span>' + c.scale + '</span><span>เส้นหยุด (equity)</span><span>' + (c.stop_equity ? money(c.stop_equity, 0) : 'ไม่ตั้ง') + '</span><span>โฟลเดอร์ MT5</span><span style="font-size:11px">' + esc(c.data) + '</span></div></div>' +
      '<div class="card"><h2>คำสั่งตรวจ (รันที่ app-folder)</h2><div class="k">ตรวจเทียบ backtest (ปิด MT5 Tester ก่อน)</div><pre>' + esc(verify) + '</pre><div class="k">สรุปรายเดือน (รันวันที่ 1)</div><pre>' + esc(monthly) + '</pre></div></div>';
    h += '<div class="card"><h2>โปรแกรมนี้ทำอะไร</h2><ul style="margin:0;padding-left:20px;font-size:14px"><li>อ่านข้อมูลจาก MT5 ที่เปิดอยู่ในเครื่องเท่านั้น (ทุก ' + CFG.refresh_seconds + ' วินาที) ไม่เก็บรหัสผ่านและไม่ส่งข้อมูลออกนอกเครื่อง</li><li>ไม่ส่งคำสั่งซื้อขาย ปุ่มเดียวที่ทำอะไรคือ "หยุด olympus" ซึ่งสร้างไฟล์สัญญาณให้ olympus รับไปปิดไม้และหยุดเอง</li><li>ต้องเปิด MT5 ของบัญชีนั้นไว้ ถ้าย้าย olympus ขึ้น VPS ให้เปิด MT5 ในเครื่องแบบล็อกอิน investor (ดูอย่างเดียว) และปิด Algo Trading ไว้ แดชบอร์ดจะยังอ่านเทรด/ยอดเงินได้ แต่ปุ่มหยุดจะไม่ถึง VPS</li><li>กราฟ equity มาจาก snapshot ที่แดชบอร์ดบันทึกเอง (MT5 ไม่เก็บประวัติ equity) จึงเริ่มสะสมตั้งแต่เปิดโปรแกรมครั้งแรก</li></ul></div>';
    main.innerHTML = h; bindSync();
  }

  // ---------- shell: account box, stop modal, routing
  function renderAcct() {
    var a = S && S.ok ? S.account : null, accts = CFG.accounts;
    var box = $('#acct'), keep = document.createElement('div');
    keep.innerHTML = '<select id="asel">' + accts.map(function (x) { return '<option value="' + x.key + '"' + (x.key === key ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>' +
      '<div class="row"><span class="badge ' + (S && S.cfg && S.cfg.kind === 'Live' ? 'live' : 'demo') + '"><span class="dot ' + (S && S.ok ? '' : 'off') + '"></span>' + (S && S.cfg ? S.cfg.kind + (S.cfg.bot_name ? ' · ' + esc(S.cfg.bot_name) : S.cfg.manual ? ' · เทรดมือ' : '') : '') + '</span><span>' + (S && S.login ? S.login : '') + '</span></div><div class="eq" id="ac-eq">' + (a ? money(a.equity) : '–') + '</div><div class="row"><span id="ac-bal">Equity · Balance ' + (a ? money(a.balance) : '–') + '</span></div>';
    // keep the live <select> when nothing but numbers changed (rebuilding it closes the list while the user is choosing an account)
    var old = $('#asel'); if (old && old.value === key && box.childNodes.length === keep.childNodes.length) { var okm = true; for (var q = 0; q < keep.childNodes.length; q++) okm = okm && morph(box.childNodes[q], keep.childNodes[q]); if (okm) return; }
    box.innerHTML = keep.innerHTML;
    $('#asel').onchange = function () { key = this.value; try { localStorage.setItem('dash-acct', key); } catch (e) {} F.month = null; load(); };
  }
  function openStop() {
    if (!S || !S.cfg) return;
    var n = olyPositions().length;
    $('#m-info').innerHTML = '<div class="banner ' + (S.cfg.kind === 'Live' ? 'bad' : 'warn') + '"><b>' + esc(S.label) + '</b> · ' + S.cfg.kind + ' · ' + S.login + '<br>ไม้ olympus ที่เปิดอยู่ตอนนี้: <b>' + n + '</b></div>';
    $('#m-in').value = ''; $('#m-ok').disabled = true; $('#m-msg').textContent = ''; $('#modal').hidden = false; $('#m-in').focus();
  }
  $('#stopbtn').onclick = openStop;
  $('#m-cancel').onclick = function () { $('#modal').hidden = true; };
  $('#m-in').oninput = function () { $('#m-ok').disabled = this.value.trim().toUpperCase() !== 'STOP'; };
  $('#m-ok').onclick = function () {
    var btn = this; btn.disabled = true; $('#m-msg').textContent = 'กำลังส่งคำสั่ง…';
    fetch('/api/stop/' + key, { method: 'POST', headers: { 'X-Dash': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'STOP', login: S.login }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) { $('#m-msg').textContent = 'ไม่สำเร็จ: ' + (r.j.detail || ''); btn.disabled = false; return; }
        $('#m-msg').textContent = 'ส่งแล้ว รอ olympus รับคำสั่ง (ไม่เกิน 30 วินาที)…';
        var tries = 0, iv = setInterval(function () {
          tries++; fetch('/api/stop/' + key).then(function (x) { return x.json(); }).then(function (j) {
            if (!j.pending) { clearInterval(iv); $('#m-msg').innerHTML = '<span class="up"><b>olympus รับคำสั่งแล้ว</b></span> กำลังปิดไม้และหยุดเทรด ดูผลในหน้าภาพรวมอีกสักครู่'; fetch('/api/refresh', { method: 'POST', headers: { 'X-Dash': '1' } }); setTimeout(load, 5000); }
            else if (tries > 12) { clearInterval(iv); $('#m-msg').innerHTML = '<span class="down"><b>olympus ยังไม่รับคำสั่ง</b></span> อาจเป็นเวอร์ชันเก่าที่ยังไม่มีฟังก์ชันนี้ (ต้องรีสตาร์ท MT5 ให้โหลดตัวใหม่) หรือรันอยู่บนเครื่องอื่น ให้ปิด Algo Trading ที่ MT5 โดยตรงทันทีถ้าต้องการหยุดจริง'; }
          });
        }, 5000);
      });
  };
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('#modal').hidden = true; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#launchbtn'); if (!b) return;
    b.disabled = true; var m = $('#launchmsg');
    fetch('/api/launch/' + key, { method: 'POST', headers: { 'X-Dash': '1' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (m) m.textContent = j.note || ''; setTimeout(load, 40000);
    }).catch(function () { if (m) m.textContent = 'สั่งไม่สำเร็จ'; b.disabled = false; });
  });

  // opening the dashboard window starts the MT5 terminals that are not running (once per window, not on every reload)
  try { if (!sessionStorage.getItem('oly-autostart')) { sessionStorage.setItem('oly-autostart', '1'); fetch('/api/autostart', { method: 'POST', headers: { 'X-Dash': '1' } }).then(function () { setTimeout(load, 45000); }).catch(function () {}); } } catch (e) {}

  var PAGES = { overview: pOverview, trade: pTrade, journal: pJournal, analytics: pAnalytics, strategies: pStrategies, settings: pSettings };
  var OLY = window.OLY = { ext: {}, listeners: [], get S() { return S; }, get key() { return key; }, get CFG() { return CFG; }, get page() { return page; },
    esc: esc, money: money, smoney: smoney, pct: pct, num: num, fdt: fdt, ago: ago, dur: dur, cls: cls, STR: STR, isOly: isOly, ddNow: ddNow,
    go: function (p) { page = p; render(); window.scrollTo(0, 0); },
    setKey: function (k) { if (k === key || !CFG.accounts.some(function (a) { return a.key === k; })) return; key = k; try { localStorage.setItem('dash-acct', key); } catch (e) {} F.month = null; load(); }, rerender: function () { render(); }, reload: function () { load(); }, afterOverview: null };
  function render() {
    renderAcct();
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) { a.classList.toggle('on', a.dataset.p === page); });
    var main = $('#main');
    if (!S || !S.ok || !S.account) { main.innerHTML = top('ภาพรวม', 'รอข้อมูลจาก MT5') + (S ? banners() : '<div class="empty">กำลังโหลด…</div>'); bindSync(); return; }
    events(); drawn = page + '|' + key; (PAGES[page] || OLY.ext[page] || pOverview)(main);
  }
  function TR(s) { return window.OLY_I18N ? window.OLY_I18N.tr(s) : s; }   // English mode: compare against the translated text
  var SOFT = false, quickKey = null, quickSig = '', quickBusy = false;
  // copies text/class/style changes from a freshly built tree onto the live one; false when the shape differs (then the page is rebuilt)
  function morph(a, b) {
    if (a.nodeType !== b.nodeType) { return false; }
    if (a.nodeType === 3) { var bv = TR(b.nodeValue); if (a.nodeValue !== bv) a.nodeValue = bv; return true; }
    if (a.nodeType !== 1 || a.tagName !== b.tagName) { return false; }
    if (/^(plot|chartbox)$/.test(a.id) || a.id === 'bal' || a.id === 'daily' || a.id === 'cal' || a.id === 'radar-slot' || a.hasAttribute('data-keep')) return true;   // drawn by other code: leave alone
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
    if (a.childNodes.length !== b.childNodes.length) { return false; }
    for (var i = 0; i < b.attributes.length; i++) { var at = b.attributes[i], av = TR(at.value); if (a.getAttribute(at.name) !== av) a.setAttribute(at.name, av); }
    for (var j = a.attributes.length - 1; j >= 0; j--) { var an = a.attributes[j].name; if (!b.hasAttribute(an)) a.removeAttribute(an); }
    for (var k = 0; k < a.childNodes.length; k++) if (!morph(a.childNodes[k], b.childNodes[k])) return false;
    return true;
  }
  function softRender() {
    var main = $('#main'); if (!main || drawn !== page + '|' + key) return;
    var f = PAGES[page]; if (page !== 'overview' && page !== 'trade') return;
    var tmp = document.createElement('div'); SOFT = true;
    try { f(tmp); } catch (e) { SOFT = false; return; } SOFT = false;
    var ok = main.childNodes.length === tmp.childNodes.length;   // main and tmp are different tags: compare what is inside
    for (var i = 0; ok && i < tmp.childNodes.length; i++) ok = morph(main.childNodes[i], tmp.childNodes[i]);
    if (!ok) render();
  }
  function quickTick() {
    if (!S || !S.ok || quickBusy || document.hidden) return; quickBusy = true; var k = key;
    fetch('/api/quick/' + k).then(function (r) { return r.json(); }).then(function (q) {
      if (!q.ok || k !== key || !S || !S.ok) return;
      var sig = JSON.stringify([q.account, q.positions, q.orders, q.terminal]); if (sig === quickSig) return; quickSig = sig;
      S.account = Object.assign({}, S.account, q.account); S.terminal = Object.assign({}, S.terminal || {}, q.terminal); S.positions = q.positions; S.orders = q.orders;
      OLY.listeners.forEach(function (f) { try { f(S); } catch (e) { console.error(e); } });
      var a = S.account, el = $('#ac-eq'); if (el) el.textContent = money(a.equity); el = $('#ac-bal'); if (el) el.textContent = 'Equity · Balance ' + money(a.balance);
      var e = OLY.ext[page]; if (e && e.live && e.onState) e.onState(S); else softRender();
    }).catch(function () {}).then(function () { quickBusy = false; });
  }
  setInterval(quickTick, 700);
  function load() {
    fetch('/api/state/' + key).then(function (r) { return r.json(); }).then(function (j) {
      S = j; OLY.listeners.forEach(function (f) { try { f(S); } catch (e) { console.error(e); } });
      var e = OLY.ext[page]; if (e && e.live && S.ok && S.account && drawn === page + '|' + key) { renderAcct(); if (e.onState) e.onState(S); } else render();
    }).catch(function () { if (OLY.alert) OLY.alert({ id: 'srvdown|' + Math.floor(Date.now() / 1800000), acct: null, level: 'bad', title: 'ติดต่อโปรแกรมแดชบอร์ดไม่ได้', text: 'server.py อาจหยุดทำงาน ข้อมูลบนหน้านี้ไม่อัปเดต เปิด start_server.vbs ใหม่' }); S = { ok: false, error: 'ติดต่อโปรแกรมแดชบอร์ดไม่ได้ (server.py ยังรันอยู่หรือไม่?)', ts: 0, label: '', login: '' }; render(); });
  }
  document.getElementById('nav').onclick = function (e) { var a = e.target.closest('a'); if (a) { page = a.dataset.p; try { history.replaceState(null, '', '#' + page); } catch (x) {} render(); window.scrollTo(0, 0); } };
  window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if ((PAGES[h] || OLY.ext[h]) && h !== page) { page = h; render(); window.scrollTo(0, 0); } });
  window.addEventListener('resize', function () { if (S && S.ok && page === 'overview') { balanceChart($('#bal')); dailyChart($('#daily'), filtered()); } });
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    CFG = c; Object.keys(c.strats).forEach(function (m) { STR[m] = c.strats[m]; });
    if (!key || !c.accounts.some(function (a) { return a.key === key; })) key = c.accounts[0].key;
    var h = location.hash.slice(1); if (PAGES[h] || OLY.ext[h]) page = h;
    load(); timer = setInterval(load, 15000);
    window.addEventListener('load', function () { var h2 = location.hash.slice(1); if ((PAGES[h2] || OLY.ext[h2]) && h2 !== page) { page = h2; render(); } });   // a page script that loaded after the config answer
  });
})();
