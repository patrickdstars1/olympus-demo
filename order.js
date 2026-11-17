/* Order entry for hand-traded accounts (cfg.manual && cfg.order_entry), like the Exness terminal: a ticket (market or pending order with SL/TP),
   position buttons (close / close half / SL-TP), cancel for pending orders and close-all. It sits next to the chart on the chart page
   (side panel; planned SL/TP are drawn on the chart and a right click on the chart fills SL / TP / price) and also on the open-trades page.
   Talks to POST /api/order/<account> (orders.py checks every order first; this page shows the check and always asks to confirm). */
(function () {
  'use strict';
  var OLY = window.OLY; if (!OLY) return;
  var SYMS = {}, KIND = 'market', QUOTES = null, pvTimer = null, pvSeq = 0, busy = false, deskSig = '';
  function $(q) { return document.querySelector(q); }
  var esc = OLY.esc, money = OLY.money, smoney = OLY.smoney;
  function on() { var S = OLY.S; return !!(S && S.cfg && S.cfg.manual && S.cfg.order_entry); }
  OLY.orderOn = on;
  function post(body, tail) {
    return fetch('/api/order/' + OLY.key + (tail || ''), { method: 'POST', headers: { 'X-Dash': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.locked ? { ok: false, error: 'หน้าจอถูกล็อก ใส่ PIN ก่อน' } : (d.detail ? { ok: false, error: String(d.detail) } : d); })
      .catch(function () { return { ok: false, error: 'ติดต่อโปรแกรมแดชบอร์ดไม่ได้' }; });
  }
  function rid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function px(v, dg) { return v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dg == null ? 2 : dg, maximumFractionDigits: dg == null ? 2 : dg }); }
  function say(msg, cls) { var el = $('#tk-msg'); if (el) { el.className = 'tk-msg ' + (cls || ''); el.textContent = msg || ''; } }
  function dg(sym) { return SYMS[sym] ? SYMS[sym].digits : 2; }
  function sinfo() { var s = $('#tk-sym'); return (s && SYMS[s.value]) || {}; }
  function redraw() { if (OLY.drawLevels) OLY.drawLevels(); }

  function html() {
    var S = OLY.S, algo = S.terminal && S.terminal.algo, live = S.cfg && S.cfg.kind === 'Live';
    return '<div class="card ticket"><h2>ส่งคำสั่งเทรด <small>' + esc(S.label) + (live ? ' · <b class="warn">บัญชีจริง</b>' : ' · เดโม') + '</small>' +
      '<span class="chip2 ' + (algo ? 'ph ok' : 'ph') + '" id="tk-algo" style="margin-left:auto">' + (algo ? 'Algo Trading เปิด' : 'Algo Trading ปิด') + '</span></h2>' +
      '<div class="tk-grid">' +
      '<label>สัญลักษณ์<select id="tk-sym"></select></label>' +
      '<label>ชนิด<div class="seg" id="tk-kind"><button data-k="market" class="on">ราคาตลาด</button><button data-k="pending">ออเดอร์ค้าง</button></div></label>' +
      '<label>Lot<input id="tk-lot" type="number" step="any" min="0" value="0.01"></label>' +
      '<label id="tk-pwrap" style="display:none">ราคาออเดอร์<input id="tk-price" type="number" step="any"></label>' +
      '<label>SL (ราคา)<input id="tk-sl" type="number" step="any" placeholder="ว่าง = ใส่ให้ตอนกดส่ง"><small class="tk-m down" id="tk-slm"></small></label>' +
      '<label>TP (ราคา)<input id="tk-tp" type="number" step="any" placeholder="ว่าง = ใส่ให้ · ลบเอง = ไม่ตั้ง"><small class="tk-m up" id="tk-tpm"></small></label></div>' +
      '<div class="tk-risk"><span>คำนวณ lot จากความเสี่ยง</span><input id="tk-risk" type="number" step="any" placeholder="เช่น 1"><select id="tk-runit"><option value="pct">% ของ equity</option><option value="usd">$</option></select><button class="btn sm" id="tk-calc">คำนวณ lot</button></div>' +
      '<div class="tk-quote" id="tk-quote">รอราคา…</div>' +
      '<div class="tk-btns"><button class="tk-sell" id="tk-sell"><em id="tk-selt">SELL</em><span id="tk-bid"></span></button><button class="tk-buy" id="tk-buy"><em id="tk-buyt">BUY</em><span id="tk-ask"></span></button></div>' +
      '<label class="tk-nosl"><input type="checkbox" id="tk-nosl"> ส่งโดยไม่ตั้ง SL (ขาดทุนไม่จำกัด)</label>' +
      '<div class="tk-msg" id="tk-msg"></div>' +
      '<div class="tk-foot"><button class="btn" id="tk-closeall">ปิดทุกไม้ในบัญชีนี้</button><span class="s">ทุกคำสั่งตรวจก่อนส่งและขอยืนยันทุกครั้ง · บันทึกใน data/actions.log</span></div></div>';
  }

  OLY.mountTicket = function () {
    if (!on()) return;
    var slot = $('#ticket-slot'); if (!slot || slot.firstChild) return;
    slot.innerHTML = html(); KIND = 'market'; deskSig = '';
    var sel = $('#tk-sym'), onChart = OLY.page === 'chart' && OLY.chartSymbol;
    sel.innerHTML = '<option>' + (onChart ? OLY.chartSymbol() : 'BTCUSDm') + '</option>';
    post({}, '/symbols').then(function (d) {
      if (!d.ok) { say(d.error || 'อ่านรายการสัญลักษณ์ไม่ได้', 'bad'); return; }
      d.symbols.forEach(function (s) { SYMS[s.symbol] = s; });
      var want = onChart ? OLY.chartSymbol() : ''; if (!want) { try { want = localStorage.getItem('dash-tk-sym') || ''; } catch (e) {} }
      sel = $('#tk-sym'); if (!sel) return;
      sel.innerHTML = d.symbols.map(function (s) { return '<option' + (s.symbol === want ? ' selected' : '') + '>' + s.symbol + '</option>'; }).join(''); lotHint(); preview(); redraw(); OLY.deskUpdate(); suggestLoad();
    });
    slot.addEventListener('input', function (e) { if (e.target.id === 'tk-sl' || e.target.id === 'tk-tp') { e.target.dataset.touched = '1'; delete e.target.dataset.auto; } preview(); redraw(); });
    slot.addEventListener('change', function (e) {
      if (e.target.id === 'tk-sym') {
        try { localStorage.setItem('dash-tk-sym', e.target.value); } catch (x) {}
        ['#tk-sl', '#tk-tp'].forEach(function (id) { var el = $(id); el.value = ''; delete el.dataset.touched; delete el.dataset.auto; });
        if (OLY.page === 'chart' && OLY.goChartSym && OLY.goChartSym(e.target.value)) return;   // the chart follows the ticket (page is rebuilt)
        lotHint(); suggestLoad();
      }
      preview(); redraw();
    });
    $('#tk-kind').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; KIND = b.dataset.k;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      $('#tk-pwrap').style.display = KIND === 'market' ? 'none' : '';
      if (KIND !== 'market') { var pe = $('#tk-price'), q0 = quote($('#tk-sym').value); if (pe && !pe.value && q0) pe.value = ((q0.bid + q0.ask) / 2).toFixed(dg($('#tk-sym').value)); }   // starts at the market price like the Exness ticket
      pendHint(); preview(); redraw();
    };
    $('#tk-sell').onclick = function () { submit('SELL'); }; $('#tk-buy').onclick = function () { submit('BUY'); };
    $('#tk-closeall').onclick = closeAll; $('#tk-calc').onclick = calcLot;
  };
  // lot from the money you accept to lose: needs the SL; the loss of one minimum lot comes from the server's own calculation, then it is scaled
  function calcLot() {
    var b = read(), v = parseFloat($('#tk-risk').value), eq = OLY.S.account.equity, i = sinfo();
    if (!(v > 0)) { say('ใส่ความเสี่ยงที่ยอมเสียก่อน (เช่น 1 %)', 'bad'); return; }
    if (!parseFloat(b.sl)) { say('ใส่ SL ก่อน ระบบถึงจะคำนวณ lot ได้', 'bad'); return; }
    var usd = $('#tk-runit').value === 'pct' ? eq * v / 100 : v, lot0 = i.min || 0.01;
    b.lot = lot0; b.action = 'open'; b.dry = true; b.no_sl = true; b.side = refSide(b); b.kind = kindFor(b.side, b);
    post(b).then(function (d) {
      if (!d.ok) { say(d.error || 'คำนวณไม่ได้', 'bad'); return; }
      var per = -d.info.sl_money / lot0; if (!(per > 0)) { say('คำนวณไม่ได้ (SL อยู่ผิดฝั่งหรือใกล้ราคาเกินไป)', 'bad'); return; }
      var step = i.step || 0.01, lot = Math.round(Math.floor(usd / per / step + 1e-9) * step * 1e8) / 1e8;
      if (lot < lot0 - 1e-9) { say('lot ขั้นต่ำ (' + lot0 + ') ยังเสียถึง ' + money(per * lot0) + ' มากกว่าที่ตั้งไว้ ' + money(usd) + ' ลองขยับ SL ให้ใกล้ขึ้น', 'bad'); return; }
      if (i.max && lot > i.max) lot = i.max;
      $('#tk-lot').value = lot; say('lot ' + lot + ' · ถ้าโดน SL เสีย ≈ ' + money(per * lot) + ' (' + (per * lot / eq * 100).toFixed(2) + '% ของ equity)', 'ok'); preview(); redraw();
    });
  }
  function lotHint() { var i = sinfo(), el = $('#tk-lot'); if (el && i.min) { el.min = i.min; el.step = i.step; if (!(parseFloat(el.value) >= i.min)) el.value = i.min; } }

  // ---- what the chart page needs from the ticket
  OLY.ticketSet = function (field, price) {
    var el = $(field === 'sl' ? '#tk-sl' : field === 'tp' ? '#tk-tp' : '#tk-price'); if (!el) return;
    var d = dg($('#tk-sym').value); el.value = Number(price).toFixed(d); if (field !== 'price') { el.dataset.touched = '1'; delete el.dataset.auto; }
    if (field === 'price' && KIND === 'market') { var b = $('#tk-kind button[data-k="pending"]'); if (b) b.click(); }
    preview(); redraw();
  };
  OLY.ticketLines = function (sym) {
    var s = $('#tk-sym'); if (!s || s.value !== sym || !on()) return [];
    var out = [], sl = parseFloat($('#tk-sl').value), tp = parseFloat($('#tk-tp').value), p = parseFloat($('#tk-price').value);
    if (sl) out.push({ price: sl, color: '#c8372f', title: 'SL ใหม่' }); if (tp) out.push({ price: tp, color: '#0f8a55', title: 'TP ใหม่' });
    if (KIND !== 'market' && p) out.push({ price: p, color: '#2a78d6', title: 'ราคาออเดอร์ค้าง' });
    return out;
  };

  function quote(sym) { return QUOTES && QUOTES[sym]; }
  function kindFor(side, b) {
    if (KIND === 'market') return 'market';
    var q = quote(b.symbol), p = parseFloat(b.price); if (!q || !p) return 'limit';
    return side === 'BUY' ? (p < q.ask ? 'limit' : 'stop') : (p > q.bid ? 'limit' : 'stop');
  }
  function read() {
    return { symbol: $('#tk-sym').value, lot: $('#tk-lot').value, price: $('#tk-price').value, sl: $('#tk-sl').value, tp: $('#tk-tp').value, no_sl: $('#tk-nosl').checked };
  }
  function refSide(b) {
    var q = quote(b.symbol), ref = KIND === 'market' ? (q ? (q.bid + q.ask) / 2 : null) : parseFloat(b.price), sl = parseFloat(b.sl), tp = parseFloat(b.tp);
    if (!ref) return 'BUY'; if (sl) return sl < ref ? 'BUY' : 'SELL'; if (tp) return tp > ref ? 'BUY' : 'SELL'; return 'BUY';
  }
  function preview() {
    clearTimeout(pvTimer); pvTimer = setTimeout(function () {
      var el = $('#tk-pv'); if (!el) return; var b = read(); b.action = 'open'; b.dry = true; b.side = refSide(b); b.kind = kindFor(b.side, b); b.no_sl = true; var seq = ++pvSeq;
      if (!(parseFloat(b.lot) > 0)) { el.innerHTML = ''; return; }
      post(b).then(function (d) {
        if (seq !== pvSeq || !$('#tk-pv')) return;
        var sm = $('#tk-slm'), tm = $('#tk-tpm');
        if (!d.ok) { if (sm) sm.textContent = ''; if (tm) tm.textContent = ''; el.innerHTML = '<div class="tk-hint">' + esc(d.error || '') + '</div>'; return; }
        var i = d.info;
        if (sm) sm.textContent = i.sl_money != null ? 'เสีย ' + smoney(i.sl_money) + (i.risk_pct != null ? ' (' + i.risk_pct + '%)' : '') : '';
        if (tm) tm.textContent = i.tp_money != null ? 'ได้ ' + smoney(i.tp_money) + (i.rr ? ' · ' + i.rr + ' : 1' : '') : '';
        el.innerHTML = '<div class="atiles">' +
          '<div class="at down"><i class="ai">▼</i><div><div class="k">เสียถ้าโดน SL</div><div class="v">' + (i.sl_money != null ? smoney(i.sl_money) : '–') + '</div><div class="s2">' + (i.risk_pct != null ? i.risk_pct + '% ของ equity' : 'ยังไม่ตั้ง SL') + '</div></div></div>' +
          '<div class="at up"><i class="ai">▲</i><div><div class="k">ได้ถ้าถึง TP</div><div class="v">' + (i.tp_money != null ? smoney(i.tp_money) : '–') + '</div><div class="s2">' + (i.rr ? 'ได้ : เสีย = ' + i.rr + ' : 1' : '') + '</div></div></div>' +
          '<div class="at"><i class="ai">🔒</i><div><div class="k">Margin ที่ใช้</div><div class="v">' + money(i.margin) + '</div><div class="s2">เหลือ ' + money(i.margin_free_after) + '</div></div></div>' +
          '<div class="at"><i class="ai">↔</i><div><div class="k">สเปรด</div><div class="v">' + px(i.spread, i.digits) + '</div><div class="s2">Bid ' + px(i.bid, i.digits) + ' · Ask ' + px(i.ask, i.digits) + '</div></div></div></div>' +
          (i.warnings.filter(function (w) { return w.indexOf('ไม่ได้ตั้ง SL') < 0; }).map(function (w) { return '<div class="tk-hint warn">⚠ ' + esc(w) + '</div>'; }).join(''));
      });
    }, 350);
  }
  // the buttons name the order type the typed price makes (BUY LIMIT, SELL STOP ...)
  function pendHint() {
    if (KIND === 'market') return; var pe = $('#tk-price'), p = parseFloat(pe && pe.value), q = quote($('#tk-sym').value), bl = $('#tk-buyt'), sl = $('#tk-selt'); if (!bl) return;
    if (p && q) { bl.textContent = p < q.ask ? 'BUY LIMIT' : 'BUY STOP'; sl.textContent = p > q.bid ? 'SELL LIMIT' : 'SELL STOP'; } else { bl.textContent = 'BUY'; sl.textContent = 'SELL'; }
  }
  document.addEventListener('input', function (e) { if (e.target.id === 'tk-price') { pendHint(); } });
  // explanation of the order types and symbols: shown below the chart page, not inside the ticket
  OLY.orderHelp = function () {
    var rows = [['BUY Limit', 'ซื้อเมื่อราคาลงมาถึงราคาที่ตั้ง (ตั้งต่ำกว่าราคาตลาด)'], ['BUY Stop', 'ซื้อเมื่อราคาขึ้นไปถึงราคาที่ตั้ง (ตั้งสูงกว่าราคาตลาด)'],
      ['SELL Limit', 'ขายเมื่อราคาขึ้นไปถึงราคาที่ตั้ง (ตั้งสูงกว่าราคาตลาด)'], ['SELL Stop', 'ขายเมื่อราคาลงมาถึงราคาที่ตั้ง (ตั้งต่ำกว่าราคาตลาด)'],
      ['SL', 'ราคาตัดขาดทุน ถึงแล้วปิดไม้ให้อัตโนมัติ'], ['TP', 'ราคาปิดทำกำไร ถึงแล้วปิดไม้ให้อัตโนมัติ'], ['Lot', 'ขนาดไม้ ยิ่งมากยิ่งได้/เสียต่อจุดมาก'],
      ['Margin', 'เงินที่ถูกกันไว้เป็นหลักประกันของไม้นี้'], ['BE', 'Break-even: เลื่อน SL มาที่ราคาเข้า (ทำได้เมื่อไม้กำไรอยู่)'], ['ลากเส้น SL/TP', 'ลากเส้นแดง/เขียวของไม้ที่เปิดอยู่บนกราฟเพื่อย้าย ระบบถามยืนยันก่อนแก้'], ['คำนวณ lot', 'ใส่ SL และเงินที่ยอมเสีย ระบบคำนวณ lot ให้พอดี'], ['SL/TP อัตโนมัติ', 'ถ้าช่อง SL/TP ว่างตอนกด BUY/SELL ระบบใส่ให้จาก ATR(14) ของ H1: SL ห่าง 1.5 เท่า TP ห่าง 3 เท่า (ได้ : เสีย 2 : 1) ดูในหน้าต่างยืนยันและแก้ได้ · พิมพ์แล้วลบเองถ้าไม่อยากตั้ง'], ['ได้ : เสีย', 'กำไรถ้าถึง TP เทียบกับขาดทุนถ้าโดน SL (2 : 1 = ได้เป็น 2 เท่าของที่เสีย)']];
    return '<div class="card" id="orderhelp"><h2>อธิบายคำในช่องส่งคำสั่ง</h2><div class="kv">' + rows.map(function (r) { return '<span><b>' + r[0] + '</b></span><span>' + r[1] + '</span>'; }).join('') + '</div></div>';
  };
  function pollQuotes() {
    if (!$('#tk-quote')) return;
    fetch('/api/live').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return; QUOTES = j.symbols; var s = $('#tk-sym') && $('#tk-sym').value, q = s && QUOTES[s], d = dg(s);
      if (q && $('#tk-quote')) { $('#tk-quote').innerHTML = 'Bid <b>' + px(q.bid, d) + '</b> · Ask <b>' + px(q.ask, d) + '</b> · สเปรด ' + px(q.ask - q.bid, d); $('#tk-bid').textContent = px(q.bid, d); $('#tk-ask').textContent = px(q.ask, d); }
      if (KIND === 'market') { var b1 = $('#tk-buyt'), s1 = $('#tk-selt'); if (b1) { b1.textContent = 'BUY'; s1.textContent = 'SELL'; } } else pendHint();
      var a = $('#tk-algo'), S = OLY.S; if (a && S && S.terminal) { a.textContent = S.terminal.algo ? 'Algo Trading เปิด' : 'Algo Trading ปิด'; a.className = 'chip2 ph' + (S.terminal.algo ? ' ok' : ''); }
    }).catch(function () {});
  }
  setInterval(pollQuotes, 1000);
  setInterval(function () { if ($('#tk-pv') && !document.hidden) preview(); }, 3000);

  // SL and TP are put into the empty fields for the direction that is pressed (BUY / SELL) from the volatility of the symbol: ATR(14) on H1,
  // SL 1.5 x ATR, TP 3 x ATR. A field the user typed in, cleared, or set from the chart is never touched; the confirm dialog shows the result.
  var SUG = {};
  function suggestLoad() {
    var sym = $('#tk-sym') && $('#tk-sym').value; if (!sym) return;
    var c = SUG[sym]; if (c && Date.now() - c.t < 60000) return;
    post({ action: 'suggest', symbol: sym }).then(function (d) { if (d && d.ok) SUG[sym] = { t: Date.now(), d: d }; });
  }
  setInterval(suggestLoad, 30000);
  function autoFill(side) {
    var sym = $('#tk-sym').value, c = SUG[sym], q = quote(sym), p = parseFloat($('#tk-price').value), buy = side === 'BUY';
    var ref = KIND === 'market' ? (q && (buy ? q.ask : q.bid)) : p; if (!c || !ref) return [];
    var d = c.d, f = function (v) { return Number(v.toFixed(d.digits)); }, sl = $('#tk-sl'), tp = $('#tk-tp'), did = [];
    if ((!sl.value || sl.dataset.auto) && !sl.dataset.touched && !$('#tk-nosl').checked) { sl.value = f(buy ? ref - d.sl : ref + d.sl); sl.dataset.auto = '1'; did.push('SL'); }
    if ((!tp.value || tp.dataset.auto) && !tp.dataset.touched) { tp.value = f(buy ? ref + d.tp : ref - d.tp); tp.dataset.auto = '1'; did.push('TP'); }
    return did;
  }

  // ---- open positions and pending orders next to the ticket (chart page); updated in place so a click is never lost to a redraw
  OLY.deskUpdate = function () {
    var el = $('#desk-pos'); if (!el || !on()) return; var S = OLY.S, pos = S.positions || [], ord = S.orders || [];
    var sig = pos.map(function (p) { return [p.ticket, p.lot, p.sl, p.tp].join(':'); }).concat(ord.map(function (o) { return 'o' + o.ticket + ':' + o.price; })).join('|');
    if (sig !== deskSig) {
      deskSig = sig;
      el.innerHTML = '<h2>ไม้ที่เปิดอยู่ <small>' + pos.length + ' ไม้' + (ord.length ? ' · ค้าง ' + ord.length : '') + '</small></h2>' +
        (pos.length ? pos.map(function (p) {
          return '<div class="dp" data-t="' + p.ticket + '"><div class="dp1"><span class="tag ' + p.side.toLowerCase() + '">' + p.side + '</span><b>' + esc(p.symbol.replace(/m$/, '')) + '</b><span>' + p.lot + ' lot</span><span class="dp-pl n"></span></div>' +
            '<div class="dp2"><span>เข้า ' + px(p.open_price, dg(p.symbol)) + '</span><span class="down">SL ' + (p.sl ? px(p.sl, dg(p.symbol)) : '–') + '</span><span class="up">TP ' + (p.tp ? px(p.tp, dg(p.symbol)) : '–') + '</span></div>' +
            '<div class="dp3"><button class="btn sm" data-oact="close" data-t="' + p.ticket + '">ปิด</button><button class="btn sm" data-oact="half" data-t="' + p.ticket + '">ปิดครึ่ง</button><button class="btn sm" data-oact="be" data-t="' + p.ticket + '" title="Break-even: เลื่อน SL มาที่ราคาเข้า">BE</button><button class="btn sm" data-oact="sltp" data-t="' + p.ticket + '">SL/TP</button></div></div>';
        }).join('') : '<div class="s">ไม่มีไม้เปิดอยู่</div>') +
        (ord.length ? '<h2 style="margin-top:10px">ออเดอร์ค้าง</h2>' + ord.map(function (o) {
          return '<div class="dp"><div class="dp1"><b>' + esc(o.symbol.replace(/m$/, '')) + '</b><span>' + o.lot + ' lot</span><span class="n">@ ' + px(o.price, dg(o.symbol)) + '</span></div><div class="dp3"><button class="btn sm" data-oact="cancel" data-t="' + o.ticket + '">ยกเลิก</button></div></div>';
        }).join('') : '');
    }
    Array.prototype.forEach.call(el.querySelectorAll('.dp[data-t]'), function (d) {
      var p = pos.filter(function (x) { return String(x.ticket) === d.dataset.t; })[0], s = d.querySelector('.dp-pl');
      if (p && s) { s.textContent = smoney(p.profit); s.className = 'dp-pl n ' + (p.profit >= 0 ? 'up' : 'down'); }
    });
  };

  // ---- drag the SL / TP line of an open position on the chart (asks to confirm, then edits the position)
  var DR = null, GH = null;
  function CHs() { var C = OLY.chartCH && OLY.chartCH(); return C && C.candles && C.el ? C : null; }
  function lineAt(e) {
    var C = CHs(); if (!C || !on() || OLY.page !== 'chart' || !OLY.chartSymbol) return null;
    var r = C.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, sw = 70; try { sw = C.chart.priceScale('right').width() || 70; } catch (x2) {}
    if (x < 0 || x > C.el.clientWidth - sw || y < 0 || y > C.el.clientHeight) return null;
    var best = null, sym = OLY.chartSymbol();
    (OLY.S.positions || []).forEach(function (p) {
      if (p.symbol !== sym) return;
      ['sl', 'tp'].forEach(function (f) { if (!p[f]) return; var yy = C.candles.priceToCoordinate(p[f]); if (yy == null) return; var d = Math.abs(yy - y); if (d <= 5 && (!best || d < best.d)) best = { p: p, f: f, d: d }; });
    });
    return best;
  }
  function ghost(price, color, title) {
    var C = CHs(); if (!C) return; if (GH) { try { C.candles.removePriceLine(GH); } catch (e) {} GH = null; }
    if (price != null) GH = C.candles.createPriceLine({ price: price, color: color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, axisLabelColor: color, axisLabelTextColor: '#ffffff', title: title });
  }
  document.addEventListener('mousemove', function (e) {
    var C = CHs(); if (!C) return;
    if (DR) {
      var y = e.clientY - C.el.getBoundingClientRect().top, pr = C.candles.coordinateToPrice(y); if (pr == null) return;
      if (Math.abs(e.clientY - DR.y0) > 3) DR.moved = true;
      if (DR.moved) { DR.price = pr; ghost(pr, DR.f === 'sl' ? '#c8372f' : '#0f8a55', (DR.f === 'sl' ? 'SL' : 'TP') + ' → ' + px(pr, dg(DR.p.symbol))); }
      return;
    }
    var w = C.el.closest('.chwrap'); if (w) w.classList.toggle('ns-hover', !!lineAt(e));
  }, true);
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return; var h = lineAt(e); if (!h) return;
    e.stopPropagation(); e.preventDefault(); DR = { p: h.p, f: h.f, y0: e.clientY, moved: false };
  }, true);
  document.addEventListener('mouseup', function (e) {
    if (!DR) return; var d = DR; DR = null; ghost(null); if (!d.moved || d.price == null) return;
    e.stopPropagation(); var dgs = dg(d.p.symbol), np = Number(d.price.toFixed(dgs)), name = d.f === 'sl' ? 'SL' : 'TP', old = d.p[d.f];
    if (window.confirm('ย้าย ' + name + ' ของ ' + d.p.side + ' ' + d.p.symbol + ' ' + d.p.lot + ' lot\nจาก ' + px(old, dgs) + ' เป็น ' + px(np, dgs) + '\n\nยืนยัน?')) { var body = { action: 'modify', ticket: d.p.ticket }; body[d.f] = String(np); act(body, 'ย้าย ' + name + ' ของ #' + d.p.ticket + ' แล้ว'); }
  }, true);

  function confirmText(i, S) {
    return (S.cfg.kind === 'Live' ? '⚠ บัญชีจริง ' : 'บัญชีเดโม ') + S.label + '\n\nส่ง ' + i.side + ' ' + i.symbol + ' ' + i.lot + ' lot\n' +
      (i.kind === 'market' ? 'ราคาตลาด ≈ ' + px(i.price, i.digits) : (i.kind === 'limit' ? 'Limit' : 'Stop') + ' ที่ ' + px(i.price, i.digits)) + '\n' +
      'SL ' + (i.sl ? px(i.sl, i.digits) + ' (เสีย ' + smoney(i.sl_money) + (i.risk_pct != null ? ' = ' + i.risk_pct + '% ของ equity' : '') + ')' : 'ไม่ตั้ง') + '\n' +
      'TP ' + (i.tp ? px(i.tp, i.digits) + ' (ได้ ' + smoney(i.tp_money) + ')' : 'ไม่ตั้ง') + '\nMargin ' + money(i.margin) +
      (i.warnings.length ? '\n\n' + i.warnings.map(function (w) { return '⚠ ' + w; }).join('\n') : '') + (i.kind === 'market' ? '\n\nราคาจริงคือราคาตลาด ณ ตอนส่ง อาจต่างจากที่เห็นเมื่อตลาดวิ่งเร็ว (โบรกเกอร์ไม่มีเพดาน slippage)' : '') + '\n\nยืนยันส่งคำสั่ง?';
  }
  function submit(side) {
    if (busy) return; var did = autoFill(side); if (did.length) redraw();
    var S = OLY.S, b = read(); b.side = side; b.kind = kindFor(side, b); b.action = 'open'; b.dry = true; say((did.length ? 'ใส่ ' + did.join(' และ ') + ' ให้อัตโนมัติแล้ว · ' : '') + 'กำลังตรวจคำสั่ง…');
    busy = true;
    post(b).then(function (d) {
      if (!d.ok) { busy = false; say(d.error || 'ตรวจคำสั่งไม่ผ่าน', 'bad'); return; }
      if (!confirm((did.length ? 'ℹ ' + did.join(' และ ') + ' ใส่ให้อัตโนมัติจากความผันผวน (ATR H1) · ยกเลิกแล้วแก้ช่องได้\n\n' : '') + confirmText(d.info, S))) { busy = false; say('ยกเลิกแล้ว ไม่ได้ส่งคำสั่ง'); return; }
      b.dry = false; b.rid = rid(); say('กำลังส่งคำสั่ง…');
      post(b).then(function (r) {
        busy = false;
        if (r.ok) { say('✓ ' + (r.info ? r.info.side + ' ' + r.info.symbol + ' ' + r.info.lot + ' lot' : '') + ' สำเร็จ · ราคา ' + px(r.price, dg(b.symbol)) + ' · #' + (r.deal || r.order), 'ok'); after(); }
        else say(r.error || 'ส่งคำสั่งไม่สำเร็จ', 'bad');
      });
    });
  }
  function after() { if (OLY.reload) OLY.reload(); setTimeout(function () { if (OLY.reload) OLY.reload(); }, 2500); }
  function posOf(t) { return (OLY.S.positions || []).filter(function (p) { return String(p.ticket) === String(t); })[0]; }
  function act(body, okMsg) {
    if (busy) return; busy = true; body.rid = body.action === 'modify' || body.action === 'cancel' ? undefined : rid();
    post(body).then(function (r) { busy = false; if (r.ok) { say('✓ ' + okMsg, 'ok'); after(); } else { say(r.error || 'ไม่สำเร็จ', 'bad'); window.alert(r.error || 'ไม่สำเร็จ'); } });
  }
  function closeAll() {
    var n = (OLY.S.positions || []).length; if (!n) { say('ไม่มีไม้เปิดอยู่'); return; }
    var t = window.prompt('จะปิด ' + n + ' ไม้ทั้งหมดในบัญชี ' + OLY.S.label + ' ที่ราคาตลาดตอนนี้\nพิมพ์ CLOSE เพื่อยืนยัน');
    if (t === null) return; if (t.trim().toUpperCase() !== 'CLOSE') { say('ยกเลิก: ไม่ได้พิมพ์ CLOSE'); return; }
    act({ action: 'closeall' }, 'ปิดทุกไม้แล้ว');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-oact]'); if (!b || !on()) return; var a = b.dataset.oact, t = b.dataset.t;
    if (a === 'close') {
      var p = posOf(t); if (!p) return;
      if (confirm('ปิดไม้ ' + p.side + ' ' + p.symbol + ' ' + p.lot + ' lot ที่ราคาตลาด\nกำไร/ขาดทุนตอนนี้ ' + smoney(p.profit) + '\n\nยืนยัน?')) act({ action: 'close', ticket: +t }, 'ปิดไม้ #' + t + ' แล้ว');
    } else if (a === 'half') {
      var q = posOf(t); if (!q) return; var info = SYMS[q.symbol] || { step: 0.01, min: 0.01 }, h = Math.floor(q.lot / 2 / info.step + 1e-9) * info.step; h = Math.round(h * 1e8) / 1e8;
      if (h < info.min - 1e-9 || q.lot - h < info.min - 1e-9) { window.alert('lot น้อยเกินกว่าจะปิดครึ่งหนึ่ง'); return; }
      if (confirm('ปิดบางส่วน ' + h + ' จาก ' + q.lot + ' lot ของ ' + q.side + ' ' + q.symbol + ' ที่ราคาตลาด\n\nยืนยัน?')) act({ action: 'close', ticket: +t, volume: h }, 'ปิดบางส่วน #' + t + ' แล้ว');
    } else if (a === 'be') {
      var z = posOf(t); if (!z) return;
      if (confirm('เลื่อน SL ของ ' + z.side + ' ' + z.symbol + ' มาที่ราคาเข้า ' + px(z.open_price, dg(z.symbol)) + '\n(ถ้าราคากลับมาถึง จะปิดที่ราคาเข้า ไม่ขาดทุน ไม่รวมสเปรด/ค่าธรรมเนียม)\n\nยืนยัน?')) act({ action: 'modify', ticket: +t, sl: String(z.open_price) }, 'เลื่อน SL ของ #' + t + ' มาที่ราคาเข้าแล้ว');
    } else if (a === 'sltp') {
      var r = posOf(t); if (!r) return;
      var sl = window.prompt('SL ใหม่ของ ' + r.side + ' ' + r.symbol + ' (ราคา) · เว้นว่าง = ไม่เปลี่ยน · 0 = ลบ SL', r.sl || ''); if (sl === null) return;
      var tp = window.prompt('TP ใหม่ (ราคา) · เว้นว่าง = ไม่เปลี่ยน · 0 = ลบ TP', r.tp || ''); if (tp === null) return;
      act({ action: 'modify', ticket: +t, sl: sl.trim(), tp: tp.trim() }, 'แก้ SL/TP ของ #' + t + ' แล้ว');
    } else if (a === 'cancel') {
      if (confirm('ยกเลิกออเดอร์ค้าง #' + t + '?')) act({ action: 'cancel', ticket: +t }, 'ยกเลิกออเดอร์ #' + t + ' แล้ว');
    }
  });
})();
