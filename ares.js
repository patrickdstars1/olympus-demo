/* ares account view: the separate daytrade test EA (opening-range breakout; one "leg" per symbol with its own session:
   GBPJPY in London, gold in New York). Shows each leg's timeline and entry conditions plus the shared risk numbers,
   instead of the olympus cards. Read-only; data from /api/ares/<account>. */
(function () {
  'use strict';
  var OLY = window.OLY, A = null, AKEY = null, busy = false;
  function $(q) { return document.querySelector(q); }
  function isAres() { var S = OLY.S; return !!(S && S.cfg && S.cfg.bot_name === 'ares'); }
  OLY.isAres = isAres;
  function hm(t) { var d = new Date(t * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function px(v, dg) { return v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dg, maximumFractionDigits: dg }); }
  function tile(icon, cls, k, v, s) { return '<div class="at ' + cls + '"><i class="ai">' + icon + '</i><div><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s2">' + (s || '') + '</div></div></div>'; }
  var PH = { weekend: ['วันหยุด ตลาดปิด', ''], before: ['รอกรอบราคา', 'wait'], range: ['กำลังสร้างกรอบ', 'wait'], window: ['รอเบรกเอาต์', 'live'], holding: ['กำลังถือไม้', 'live'], done: ['เข้าไม้ของวันนี้แล้ว', 'ok'], over: ['จบช่วงของวันนี้', ''] };
  function step(on, done, t, s) { return '<div class="st ' + (on ? 'on' : done ? 'done' : '') + '"><b>' + t + '</b><span>' + s + '</span></div>'; }

  function leg(L, P) {
    if (!L.ok) return '<div class="aleg"><h3>' + OLY.esc(L.name) + ' · ' + L.session + '</h3><div class="empty">' + OLY.esc(L.error || 'อ่านข้อมูลไม่ได้') + '</div></div>';
    var dg = L.digits, ph = PH[L.phase] || ['', ''], up = L.trend === 'up', money = OLY.money;
    var idx = { before: 0, range: 1, window: 2, holding: 2, done: 3, over: 3, weekend: -1 }[L.phase];
    var can = { yes: ['เข้าได้ทุกไม้', 'up'], some: ['เข้าได้บางไม้', 'warn'], no: ['ทุนไม่พอ', 'down'] }[L.can_trade];
    var dirTxt = L.hi == null ? 'รอกรอบของวันนี้' : (up ? 'BUY ถ้าปิดเหนือ ' + px(L.hi, dg) : 'SELL ถ้าปิดต่ำกว่า ' + px(L.lo, dg));
    return '<div class="aleg"><h3>' + OLY.esc(L.name) + ' · ช่วง' + L.session + ' <span class="chip2 ph ' + ph[1] + '">' + ph[0] + '</span></h3>' +
      '<div class="steps">' + step(idx === 0, idx > 0, 'รอ', 'ถึง ' + hm(L.range_start)) + step(idx === 1, idx > 1, 'สร้างกรอบ', hm(L.range_start) + '–' + hm(L.range_end)) +
      step(idx === 2, idx > 2, 'รับเบรกเอาต์', hm(L.range_end) + '–' + hm(L.window_end)) + step(false, false, 'ปิดทุกไม้', hm(L.flat)) + '</div>' +
      '<div class="atiles">' +
      tile(up ? '▲' : '▼', up ? 'up' : 'down', 'เทรนด์', up ? 'ขาขึ้น' : 'ขาลง', 'เข้าได้เฉพาะ ' + (up ? 'BUY' : 'SELL')) +
      tile(L.adx_ok ? '✓' : '✕', L.adx_ok ? 'up' : 'down', 'ตัวกรองโมเมนตัม', L.adx == null ? '–' : L.adx.toFixed(1), L.adx_ok ? 'ผ่าน' : 'ยังไม่ผ่าน (ค่าประมาณ)') +
      tile('▭', '', 'กรอบวันนี้', L.hi == null ? '–' : px(L.lo, dg) + ' – ' + px(L.hi, dg), 'ราคาตอนนี้ ' + px(L.price, dg)) +
      tile('🎯', (L.buy_ok || L.sell_ok) && L.adx_ok && L.phase === 'window' ? 'up' : '', 'เงื่อนไขเข้า', dirTxt, 'ตัดสินตอนแท่ง M15 ปิด') +
      tile('💰', can[1], 'ทุนขั้นต่ำตอนนี้', '≈ ' + money(L.need_best, 0) + ' – ' + money(L.need_worst, 0), can[0] + ' · lot ' + L.min_lot + ' เสีย ' + money(L.min_lot_loss_best) + '–' + money(L.min_lot_loss_worst)) +
      '</div></div>';
  }
  function html() {
    if (!A) return '<div class="card"><div class="empty">กำลังโหลดข้อมูล ares…</div></div>';
    if (!A.ok) return '<div class="card"><h2>ares</h2><div class="empty">' + OLY.esc(A.error || 'อ่านข้อมูลไม่ได้') + '</div></div>';
    var P = A.params, money = OLY.money, s = A.stats;
    var h = '<div class="card arescard"><h2>ares · ' + A.legs.map(function (L) { return OLY.esc(L.name); }).join(' + ') + ' <small>เบรกเอาต์กรอบเปิดตลาด M15</small></h2>';
    h += '<div class="atiles">' +
      tile('⚖', '', 'เสี่ยงต่อไม้ ' + P.risk_pct + '%', money(A.risk_usd), 'lot คำนวณจากระยะ SL') +
      tile('⛔', '', 'หยุดทั้งวันที่', '−' + money(A.day_stop_usd), 'หรือแพ้ ' + P.loss_streak + ' ไม้ติด') +
      tile('📅', A.day_pl > 0 ? 'up' : A.day_pl < 0 ? 'down' : '', 'ผลวันนี้', OLY.smoney(A.day_pl), A.entries_today + ' ไม้ (สูงสุดวันละ ' + P.max_trades_day + ')') +
      tile('📂', '', 'ไม้ที่เปิดอยู่', A.open_now + ' / ' + P.max_open, 'ปิดทุกไม้ ' + (A.legs[0] && A.legs[0].ok ? hm(A.legs[0].flat) : '')) + '</div>';
    h += A.legs.map(function (L) { return leg(L, P); }).join('');
    h += '<div class="chips"><span class="chip2 plain">ไม้ที่ปิดแล้ว ' + s.n + '</span><span class="chip2 plain">ชนะ ' + (s.n ? Math.round(s.wins / s.n * 100) + '%' : '–') + '</span></div>';
    return h + '</div>';
  }
  function render() { var el = $('#ares-box'); if (el) el.innerHTML = html(); }
  OLY.aresRender = render;
  // today's opening range of each leg, drawn on the chart page for that symbol
  OLY.aresRange = function (sym) {
    var out = []; if (!A || !A.ok || !isAres()) return out;
    (A.legs || []).forEach(function (L) { if (L.ok && L.symbol === sym && L.hi != null) { out.push({ price: L.hi, title: 'กรอบ ares สูง' }); out.push({ price: L.lo, title: 'กรอบ ares ต่ำ' }); } });
    return out;
  };
  OLY.aresBox = function () { return '<div id="ares-box">' + html() + '</div>'; };
  function poll() {
    var S = OLY.S, sb = $('#stopbtn');
    if (sb) sb.style.display = S && S.cfg && S.cfg.manual ? 'none' : '';      // the stop button talks to olympus only
    if (!isAres() || busy || document.hidden) { if (!isAres()) { A = null; AKEY = null; } return; }
    if (AKEY !== OLY.key) { A = null; AKEY = OLY.key; render(); }
    busy = true; var k = OLY.key;
    fetch('/api/ares/' + k).then(function (r) { return r.json(); }).then(function (j) { if (k === OLY.key) { A = j; render(); } }).catch(function () {}).then(function () { busy = false; });
  }
  setInterval(poll, 3000); setTimeout(poll, 600);
})();
