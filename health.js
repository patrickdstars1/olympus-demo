/* Health summary (the badge in the top strip + its checklist), the risk-in-dollars card, strategy-unlock table, and the PIN lock client. */
(function () {
  'use strict';
  var OLY = window.OLY; if (!OLY) return;
  var esc = OLY.esc, money = OLY.money, $ = function (s) { return document.querySelector(s); };
  var DD_LINES = [[15, 'ลดขนาดไม้เหลือครึ่งหนึ่ง'], [25, 'ลดขนาดไม้เหลือ ¼'], [32, 'Kill Switch: ปิดไม้และหยุดเทรด']];
  var VBAD = ['stale', 'stopped', 'noea', 'disconnected'];

  // =================================================================== checklist
  function checks(S) {
    var c = [], add = function (st, name, text) { c.push({ st: st, name: name, text: text }); };
    if (!S || !S.ok || !S.account) { add('bad', 'อ่านบัญชี', (S && S.error) || 'อ่านข้อมูลจาก MT5 ไม่ได้'); return c; }
    var t = S.terminal || {}, vps = S.vps, log = S.log || {}, live = S.cfg && S.cfg.kind === 'Live';
    add(t.connected === false ? 'bad' : 'ok', 'เชื่อมต่อโบรกเกอร์', t.connected === false ? 'MT5 ไม่ได้ต่อ server บอทเทรดไม่ได้' : 'MT5 ต่อ server อยู่');
    if (S.cfg && S.cfg.manual) {
      if (S.cfg.bot_name) add(t.algo ? 'ok' : 'bad', 'บอท ' + S.cfg.bot_name, t.algo ? 'Algo Trading เปิดอยู่ (บัญชีทดสอบ ' + S.cfg.bot_name + ' ไม่ใช่ olympus)' : 'Algo Trading ปิดอยู่ บอทจะไม่เทรด');
      else add('ok', 'โหมดเทรดมือ', 'บัญชีนี้ไม่มีบอทและไม่ใช้ VPS จึงไม่ตรวจ Algo / VPS / log ของ olympus');
    } else if (vps) {
      var vt = vps.state;
      add(VBAD.indexOf(vt) >= 0 ? 'bad' : (vt === 'ok' ? 'ok' : 'warn'), 'บอทบน VPS', vps.text);
      add(t.algo && live ? 'bad' : 'ok', 'ไม่มีบอทซ้อนกัน', t.algo && live ? 'Algo Trading ในเครื่องนี้เปิดอยู่พร้อม VPS: อาจเปิดไม้ซ้อน ปิดทันที' : 'Algo ในเครื่องนี้ปิด (ถูกต้อง เพราะรันบน VPS)');
    } else {
      add(t.algo ? (log.init ? 'ok' : 'warn') : 'bad', 'บอททำงาน', !t.algo ? 'Algo Trading ปิดอยู่ บอทจะไม่เทรด' : (log.init ? 'Algo เปิด และพบ olympus ใน log' : 'ไม่พบ olympus ใน log'));
    }
    var ev = (log.events || [])[(log.events || []).length - 1];
    if (!(S.cfg && S.cfg.manual)) add(ev ? 'bad' : 'ok', 'Kill Switch / การหยุด', ev ? ev.text : 'ไม่มีเหตุการณ์หยุดบอท');
    if (!(S.cfg && S.cfg.manual)) add((log.errors || []).length ? 'warn' : 'ok', 'error ใน log', (log.errors || []).length ? 'พบ ' + log.errors.length + ' รายการ ล่าสุด: ' + log.errors[log.errors.length - 1] : 'ไม่มี');
    var d = OLY.ddNow();
    add(d.dd >= 25 ? 'bad' : d.dd >= 15 ? 'warn' : 'ok', 'Drawdown', 'DD ' + OLY.pct(d.dd) + ' จากจุดสูงสุด ' + money(d.peak) + ((S.cfg && S.cfg.manual) ? '' : d.dd >= 15 ? ' (บอทลดขนาดไม้แล้ว)' : ' (ลดไม้ที่ 15%)'));
    var stop = S.cfg && S.cfg.stop_equity, eq = S.account.equity;
    if (stop) add(eq <= stop ? 'bad' : eq <= stop * 1.1 ? 'warn' : 'ok', 'เส้นหยุดตามแผน', 'Equity ' + money(eq) + ' · เส้นหยุด ' + money(stop, 0) + ' (ห่าง ' + money(eq - stop) + ')');
    var nosl = (S.positions || []).filter(function (p) { return !p.sl; });
    add(nosl.length ? ((S.cfg && S.cfg.manual) ? 'warn' : 'bad') : 'ok', 'Stop Loss', nosl.length ? nosl.length + ' ไม้ไม่มี SL' : ((S.positions || []).length ? 'ทุกไม้มี SL' : 'ไม่มีไม้เปิดอยู่'));
    var age = Date.now() / 1000 - S.ts;
    add(age > 300 ? 'warn' : 'ok', 'ข้อมูลสด', age > 300 ? 'ข้อมูลเก่า ' + OLY.ago(S.ts) : 'อัปเดต ' + OLY.ago(S.ts));
    return c;
  }
  var ICON = { ok: '✓', warn: '!', bad: '✕' };
  OLY.healthBadge = function () {
    var S = OLY.S; if (!S) return '';
    var c = checks(S), bad = c.filter(function (x) { return x.st === 'bad'; }).length, warn = c.filter(function (x) { return x.st === 'warn'; }).length;
    var cls = bad ? 'bad' : warn ? 'warn' : 'ok', tip = bad ? bad + ' เรื่องต้องดูด่วน' : warn ? warn + ' เรื่องควรดู' : 'ระบบทำงานปกติ';
    if (OLY.healthOpen) renderPanel(c);
    return '<a class="health ' + cls + '" id="hl" title="' + tip + ' · กดดูรายละเอียด">' + ICON[cls] + '</a>';   // header: icon only, the words live in the status card
  };
  var SVG = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17.2v.1"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'
  };
  // status card: big symbol + plain words, shown at the top of the overview page
  OLY.statusCard = function () {
    var S = OLY.S; if (!S || !S.ok || !S.account) return '';
    var c = checks(S), bads = c.filter(function (x) { return x.st === 'bad'; }), warns = c.filter(function (x) { return x.st === 'warn'; });
    var cls = bads.length ? 'bad' : warns.length ? 'warn' : 'ok';
    var title = bads.length ? bads.length + ' เรื่องต้องดูด่วน' : warns.length ? warns.length + ' เรื่องควรดู' : 'ทุกอย่างปกติ';
    var sub = cls === 'ok' ? 'ตรวจ ' + c.length + ' รายการ ผ่านทั้งหมด · MT5 เชื่อมต่อและข้อมูลสด' : bads.concat(warns).map(function (x) { return '<span class="chip ' + x.st + '">' + esc(x.name) + '</span>'; }).join('');
    return '<div class="card statuscard ' + cls + '"><div class="sicon">' + SVG[cls] + '</div><div class="stxt"><div class="stitle">' + title + '</div><div class="ssub">' + sub + '</div></div><button class="btn hlopen" type="button">ดูเช็กลิสต์</button></div>';
  };
  function renderPanel(c) {
    var p = $('#hlpanel'); if (!p) { p = document.createElement('div'); p.id = 'hlpanel'; document.body.appendChild(p); }
    p.innerHTML = '<h3>เช็กลิสต์สถานะ <small>' + esc((OLY.S && OLY.S.label) || '') + '</small></h3>' + c.map(function (x) { return '<div class="hr ' + x.st + '"><i>' + ICON[x.st] + '</i><b>' + esc(x.name) + '</b><span>' + esc(x.text) + '</span></div>'; }).join('');
    p.style.display = 'block';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#hl, .hlopen');
    if (b) { OLY.healthOpen = !OLY.healthOpen; var p = $('#hlpanel'); if (OLY.healthOpen) renderPanel(checks(OLY.S)); else if (p) p.style.display = 'none'; return; }
    if (OLY.healthOpen && !e.target.closest('#hlpanel')) { OLY.healthOpen = false; var q = $('#hlpanel'); if (q) q.style.display = 'none'; }
  });

  // =================================================================== risk card (dollars) + strategy unlock table
  OLY.riskCard = function () {
    var S = OLY.S; if (!S || !S.ok || !S.account) return '';
    var a = S.account, d = OLY.ddNow(), eq = a.equity, stop = S.cfg && S.cfg.stop_equity;
    var man = !!(S.cfg && S.cfg.manual);   // no olympus DD guard on hand-traded / ares accounts
    var rows = (man ? [] : DD_LINES).map(function (l) {
      var lvl = d.peak * (1 - l[0] / 100), gap = eq - lvl, reached = eq <= lvl;
      return '<tr class="' + (reached ? 'hit' : '') + '"><td>DD ' + l[0] + '%</td><td>' + l[1] + '</td><td class="n">' + money(lvl) + '</td><td class="n">' + (reached ? '<b class="down">ถึงแล้ว</b>' : 'ห่างอีก ' + money(gap) + ' (' + OLY.pct(gap / eq * 100) + ')') + '</td></tr>';
    });
    if (stop) rows.push('<tr class="' + (eq <= stop ? 'hit' : '') + '"><td>เส้นหยุด</td><td>หยุดและทบทวนตามแผนทดลอง</td><td class="n">' + money(stop, 0) + '</td><td class="n">' + (eq <= stop ? '<b class="down">ถึงแล้ว</b>' : 'ห่างอีก ' + money(eq - stop) + ' (' + OLY.pct((eq - stop) / eq * 100) + ')') + '</td></tr>');
    var pos = S.positions || [], withSl = pos.filter(function (p) { return p.sl; }), openRisk = withSl.reduce(function (s, p) { return s + p.risk; }, 0), noSl = pos.length - withSl.length;
    var h = '<div class="card riskcard"><h2>ความเสี่ยงเป็นดอลลาร์ <small>จุดสูงสุด ' + money(d.peak) + ' · DD ตอนนี้ ' + OLY.pct(d.dd) + '</small></h2><div class="tbl"><table><thead><tr><th>เส้น</th><th>เกิดอะไรขึ้น</th><th class="n">Equity ที่ระดับนี้</th><th class="n">เหลือระยะอีก</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    h += '<div class="kv"><span>ถ้า SL ทุกไม้ที่เปิดอยู่โดนพร้อมกัน</span><span>' + (pos.length ? (noSl ? '<b class="down">มี ' + noSl + ' ไม้ไม่มี SL คำนวณไม่ได้</b>' : '−' + money(openRisk) + ' → เหลือ ' + money(eq - openRisk) + ' (' + OLY.pct(openRisk / eq * 100) + ' ของทุน)') : 'ไม่มีไม้เปิดอยู่') + '</span>' +
      '<span>Margin ที่ใช้อยู่</span><span>' + (a.margin ? money(a.margin) + ' · Margin level ' + (a.margin_level ? OLY.pct(a.margin_level, 0) : '–') : 'ไม่มี') + '</span></div>';
    var lv = OLY.getLevels && OLY.getLevels();
    if (lv && lv.strategies && !man) {
      var list = lv.strategies.filter(function (s) { return !s.error && s.min_risk_pct != null; }).map(function (s) { return { s: s, need: lv.equity * s.min_risk_pct / 3 }; }).sort(function (x, y) { return x.need - y.need; });
      h += '<h2 style="margin-top:6px">ทุนที่ปลดล็อกแต่ละกลยุทธ์ <small>lot ขั้นต่ำต้องเสี่ยงไม่เกิน 3% ของทุน (ประมาณ ขยับตามความผันผวน)</small></h2><div class="tbl"><table><thead><tr><th>กลยุทธ์</th><th>สถานะ</th><th class="n">ทุนที่ต้องมี</th><th class="n">ขาดอีก</th></tr></thead><tbody>' +
        list.map(function (x) {
          var ok = x.s.eligible, col = OLY.chartApi ? OLY.chartApi.sc(x.s.magic) : '#888';
          return '<tr><td><i class="sw ' + (/apollo/.test(x.s.name) ? 'sq' : 'ar') + '" style="--c:' + col + '"></i>' + esc(x.s.name) + '</td><td>' + (ok ? '<span class="badge">เทรดได้</span>' : '<span class="badge live">ทุนไม่พอ</span>') + '</td><td class="n">≈ ' + money(x.need, 0) + '</td><td class="n">' + (ok ? '–' : money(x.need - lv.equity, 0)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return h + '</div>';
  };

  // =================================================================== PIN lock client: activity pings + auto-reload when locked
  var pinOn = false, lastTouch = 0, origFetch = window.fetch;
  window.fetch = function () {
    return origFetch.apply(this, arguments).then(function (r) { if (r.status === 401 && pinOn) { r.clone().json().then(function (j) { if (j && j.locked) location.reload(); }).catch(function () {}); } return r; });
  };
  function ping() {
    if (!pinOn || Date.now() - lastTouch < 20000) return; lastTouch = Date.now();
    origFetch('/api/pin/touch', { method: 'POST', headers: { 'X-Dash': '1' } }).catch(function () {});
  }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) { window.addEventListener(ev, ping, { passive: true }); });
  origFetch('/api/whoami').then(function (r) { return r.json(); }).then(function (j) { pinOn = !!j.pin; OLY.pinOn = pinOn; var b = $('#lockbtn'); if (b) b.style.display = pinOn ? '' : 'none'; }).catch(function () {});
  OLY.refreshPin = function (on) { pinOn = !!on; OLY.pinOn = pinOn; var b = $('#lockbtn'); if (b) b.style.display = pinOn ? '' : 'none'; };
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#lockbtn')) origFetch('/api/pin/lock', { method: 'POST', headers: { 'X-Dash': '1' } }).then(function () { location.reload(); });
  });
})();
