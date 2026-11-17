/* Chart tools for the olympus dashboard (read-only): TradingView-style drawing tools, indicator library (overlays + sub-panes),
   chart types, compare symbol, screenshot, fullscreen, right-click alerts. Plugs into chart.js through OLY.chartApi hooks. */
(function () {
  'use strict';
  var OLY = window.OLY, A = OLY && OLY.chartApi; if (!A) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = OLY.esc, LS = A.LS, P = A.P, TFSEC = A.TFSEC, px = A.px;
  var CH = null, WRAP = null, uidn = 0;
  function uid() { return Date.now().toString(36) + (uidn++).toString(36); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function svg(path, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }

  // =================================================================== coordinates (time/price <-> pixels, bar index based so it works on any TF)
  function rows() { return CH ? CH.data : []; }
  function tfs() { return TFSEC[P.tf] || 3600; }
  function idxOfTime(t) {
    var d = rows(), n = d.length; if (!n) return 0;
    if (t <= d[0][0]) return (t - d[0][0]) / tfs();
    if (t >= d[n - 1][0]) return n - 1 + (t - d[n - 1][0]) / tfs();
    var lo = 0, hi = n - 1; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (d[m][0] <= t) lo = m; else hi = m - 1; }
    return lo + (t - d[lo][0]) / (d[lo + 1][0] - d[lo][0]);
  }
  function timeOfIdx(i) {
    var d = rows(), n = d.length; if (!n) return 0;
    if (i <= 0) return d[0][0] + i * tfs();
    if (i >= n - 1) return d[n - 1][0] + (i - (n - 1)) * tfs();
    var lo = Math.floor(i); return d[lo][0] + (i - lo) * (d[lo + 1][0] - d[lo][0]);
  }
  function xOf(t) { return CH.chart.timeScale().logicalToCoordinate(idxOfTime(t)); }
  function yOf(p) { return CH.candles.priceToCoordinate(p); }
  function pOfY(y) { return CH.candles.coordinateToPrice(y); }
  function pointAt(x, y, magnet) {
    var l = CH.chart.timeScale().coordinateToLogical(x), p = pOfY(y); if (l == null || p == null) return null;
    if (magnet) {
      var i = clamp(Math.round(l), 0, rows().length - 1), r = rows()[i], best = null;
      if (r) { [r[1], r[2], r[3], r[4]].forEach(function (v) { var yy = yOf(v); if (yy != null && Math.abs(yy - y) < 24 && (!best || Math.abs(yy - y) < best.d)) best = { d: Math.abs(yy - y), v: v }; }); l = i; if (best) p = best.v; }
    }
    return { t: timeOfIdx(l), p: p };
  }

  // =================================================================== drawings
  var DR = LS.get('oly-draw2', {}), TOOL = 'cursor', CUR = null, SEL = null, MAGNET = LS.get('oly-magnet', false), HIDE = false, UNDO = [], REDO = [], DRAG = null, LASTCOLOR = LS.get('oly-dcolor', '#2a78d6');
  var COLORS = ['#2a78d6', '#e8890c', '#0f8a55', '#c8372f', '#9b5de5', '#e5489b', '#8892a0', '#c99700'];
  var TOOLS = [
    { id: 'cursor', name: 'เคอร์เซอร์: เลือก/ย้ายเส้น (Esc)', pts: 0, icon: '<path d="M5 3l12 7-5 1.5L9.5 17z"/>' },
    { id: 'trend', name: 'เส้นเทรนด์ (คลิก 2 จุด)', pts: 2, icon: '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>' },
    { id: 'ray', name: 'เส้นรังสี (ลากต่อไปทางขวา)', pts: 2, icon: '<path d="M4 18L21 7"/><circle cx="4" cy="18" r="2"/><circle cx="11" cy="13.6" r="1.4"/>' },
    { id: 'arrow', name: 'ลูกศร', pts: 2, icon: '<path d="M4 20L19 5M19 5h-7M19 5v7"/>' },
    { id: 'hline', name: 'เส้นแนวนอน (คลิก 1 จุด)', pts: 1, icon: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2.2"/>' },
    { id: 'vline', name: 'เส้นแนวตั้ง', pts: 1, icon: '<path d="M12 3v18"/><circle cx="12" cy="12" r="2.2"/>' },
    { id: 'rect', name: 'สี่เหลี่ยม', pts: 2, icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
    { id: 'fib', name: 'Fibonacci Retracement', pts: 2, icon: '<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/>' },
    { id: 'measure', name: 'วัดระยะ (ราคา / % / จำนวนแท่ง)', pts: 2, icon: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/>' },
    { id: 'text', name: 'ข้อความ', pts: 1, icon: '<path d="M5 6h14M12 6v14M9 20h6"/>' }
  ];
  var DEFW = { trend: 2, ray: 2, arrow: 2, hline: 1.5, vline: 1.5, rect: 1.5, fib: 1, measure: 1, text: 1 };
  var FIB = [[0, '#8892a0'], [0.236, '#e5489b'], [0.382, '#e8890c'], [0.5, '#0f8a55'], [0.618, '#2a78d6'], [0.786, '#9b5de5'], [1, '#8892a0']];

  function list() { return DR[P.symbol] || (DR[P.symbol] = []); }
  function persist() { LS.set('oly-draw2', DR); }
  function snap() { UNDO.push(JSON.stringify(list())); if (UNDO.length > 60) UNDO.shift(); REDO = []; }
  function undo() { if (!UNDO.length) return; REDO.push(JSON.stringify(list())); DR[P.symbol] = JSON.parse(UNDO.pop()); SEL = null; persist(); dirty = true; props(); }
  function redo() { if (!REDO.length) return; UNDO.push(JSON.stringify(list())); DR[P.symbol] = JSON.parse(REDO.pop()); SEL = null; persist(); dirty = true; props(); }
  function byId(id) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function setTool(t) {
    TOOL = t; CUR = null; if (t !== 'cursor') SEL = null;
    Array.prototype.forEach.call(WRAP ? WRAP.querySelectorAll('.dwtb [data-tool]') : [], function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    if (CH) CH.el.style.cursor = t === 'cursor' ? '' : 'crosshair';
    if (hitEl) hitEl.style.pointerEvents = 'none'; dirty = true; props();
  }
  function finalize(s) {
    s.id = uid(); s.color = LASTCOLOR; s.w = DEFW[s.type] || 1.5;
    if (s.type === 'text') { var tx = window.prompt('ข้อความที่จะวางบนกราฟ', ''); if (!tx) { setTool('cursor'); return; } s.text = tx; }
    snap(); list().push(s); persist(); SEL = s.id; setTool('cursor'); SEL = s.id; props();
  }
  function deleteSel() { if (!SEL) return; snap(); DR[P.symbol] = list().filter(function (s) { return s.id !== SEL; }); SEL = null; persist(); dirty = true; props(); }

  // ---- geometry of one shape in pixels (null when it cannot be placed)
  function geom(s) {
    var g = []; for (var i = 0; i < s.pts.length; i++) { var x = xOf(s.pts[i].t), y = yOf(s.pts[i].p); if (x == null || y == null) return null; g.push({ x: x, y: y }); }
    return g;
  }
  function plotSize() { var ts = CH.chart.timeScale(); return { w: ts.width(), h: cv.clientHeight - (ts.height ? ts.height() : 26) }; }
  function segDist(px_, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px_ - a.x) * dx + (py - a.y) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px_ - (a.x + t * dx), py - (a.y + t * dy));
  }
  function rayEnd(a, b, w, h) {
    var dx = b.x - a.x, dy = b.y - a.y; if (!dx && !dy) return b; var tt = 1e6;
    if (dx > 0) tt = Math.min(tt, (w + 20 - a.x) / dx); else if (dx < 0) tt = Math.min(tt, (-20 - a.x) / dx);
    if (dy > 0) tt = Math.min(tt, (h + 20 - a.y) / dy); else if (dy < 0) tt = Math.min(tt, (-20 - a.y) / dy);
    return { x: a.x + dx * tt, y: a.y + dy * tt };
  }
  function hit(s, x, y) {
    var g = geom(s); if (!g) return null; var ps = plotSize(), i;
    for (i = 0; i < g.length; i++) if (Math.hypot(x - g[i].x, y - g[i].y) < 9) return { kind: 'handle', i: i };
    var body = false;
    switch (s.type) {
      case 'trend': case 'arrow': body = segDist(x, y, g[0], g[1]) < 6; break;
      case 'ray': body = segDist(x, y, g[0], rayEnd(g[0], g[1], ps.w, ps.h)) < 6; break;
      case 'hline': body = Math.abs(y - g[0].y) < 6; break;
      case 'vline': body = Math.abs(x - g[0].x) < 6; break;
      case 'rect': case 'measure': { var x1 = Math.min(g[0].x, g[1].x), x2 = Math.max(g[0].x, g[1].x), y1 = Math.min(g[0].y, g[1].y), y2 = Math.max(g[0].y, g[1].y); body = x > x1 - 5 && x < x2 + 5 && y > y1 - 5 && y < y2 + 5 && (s.type === 'measure' || Math.min(x - x1, x2 - x, y - y1, y2 - y) < 7 || (x > x1 && x < x2 && y > y1 && y < y2)); break; }
      case 'fib': { var fx1 = Math.min(g[0].x, g[1].x), fx2 = Math.max(g[0].x, g[1].x); if (x > fx1 - 4 && x < fx2 + 4) FIB.forEach(function (f) { var yy = g[1].y + (g[0].y - g[1].y) * f[0]; if (Math.abs(y - yy) < 5) body = true; }); break; }
      case 'text': { var w = (s.text || '').length * 7 + 10; body = x > g[0].x - 4 && x < g[0].x + w && y > g[0].y - 16 && y < g[0].y + 6; break; }
    }
    return body ? { kind: 'body' } : null;
  }
  function topHit(x, y) {
    var l = list(); for (var i = l.length - 1; i >= 0; i--) { var h = hit(l[i], x, y); if (h) { h.shape = l[i]; return h; } }
    return null;
  }

  // ---- canvas rendering
  var cv = null, ctx = null, hitEl = null, dirty = true, lastSig = '', raf = 0, mouse = null;
  function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function label(text, x, y, bg, fg, align) {
    ctx.font = '11px IBM Plex Mono, monospace'; var w = ctx.measureText(text).width + 10, bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, y - 9, w, 18, 4); else ctx.rect(bx, y - 9, w, 18); ctx.fill();
    ctx.fillStyle = fg || '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 5, y);
  }
  function drawShape(s, preview) {
    var g = geom(s); if (!g) return; var ps = plotSize(), c = s.color, dg = CH.digits;
    ctx.save(); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = s.w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; if (preview) ctx.setLineDash([5, 4]);
    switch (s.type) {
      case 'trend': ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); ctx.lineTo(g[1].x, g[1].y); ctx.stroke(); break;
      case 'ray': { var e = rayEnd(g[0], g[1], ps.w, ps.h); ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); ctx.lineTo(e.x, e.y); ctx.stroke(); break; }
      case 'arrow': { ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); ctx.lineTo(g[1].x, g[1].y); ctx.stroke(); var an = Math.atan2(g[1].y - g[0].y, g[1].x - g[0].x), hs = 10 + s.w * 2; ctx.beginPath(); ctx.moveTo(g[1].x, g[1].y); ctx.lineTo(g[1].x - hs * Math.cos(an - 0.45), g[1].y - hs * Math.sin(an - 0.45)); ctx.lineTo(g[1].x - hs * Math.cos(an + 0.45), g[1].y - hs * Math.sin(an + 0.45)); ctx.closePath(); ctx.fill(); break; }
      case 'hline': ctx.beginPath(); ctx.moveTo(0, g[0].y); ctx.lineTo(ps.w, g[0].y); ctx.stroke(); label(px(s.pts[0].p, dg), ps.w - 4, g[0].y, c, '#fff', 'right'); break;
      case 'vline': ctx.beginPath(); ctx.moveTo(g[0].x, 0); ctx.lineTo(g[0].x, ps.h); ctx.stroke(); break;
      case 'rect': { var rx = Math.min(g[0].x, g[1].x), ry = Math.min(g[0].y, g[1].y), rw = Math.abs(g[1].x - g[0].x), rh = Math.abs(g[1].y - g[0].y); ctx.fillStyle = rgba(c, 0.13); ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh); break; }
      case 'fib': {
        var x1 = Math.min(g[0].x, g[1].x), x2 = Math.max(g[0].x, g[1].x), pa = s.pts[0].p, pb = s.pts[1].p, ys = [];
        FIB.forEach(function (f) { ys.push(g[1].y + (g[0].y - g[1].y) * f[0]); });
        for (var i = 0; i < FIB.length - 1; i++) { ctx.fillStyle = rgba(FIB[i][1], 0.07); ctx.fillRect(x1, Math.min(ys[i], ys[i + 1]), x2 - x1, Math.abs(ys[i + 1] - ys[i])); }
        FIB.forEach(function (f, k) {
          ctx.strokeStyle = f[1]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, ys[k]); ctx.lineTo(x2, ys[k]); ctx.stroke();
          ctx.fillStyle = f[1]; ctx.font = '11px IBM Plex Mono, monospace'; ctx.textBaseline = 'bottom'; ctx.fillText(f[0] + '  (' + px(pb + (pa - pb) * f[0], dg) + ')', x1 + 4, ys[k] - 2);
        });
        ctx.strokeStyle = c; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); ctx.lineTo(g[1].x, g[1].y); ctx.stroke(); break;
      }
      case 'measure': {
        var up = s.pts[1].p >= s.pts[0].p, mc = up ? '#0f8a55' : '#c8372f', mx = Math.min(g[0].x, g[1].x), my = Math.min(g[0].y, g[1].y), mw = Math.abs(g[1].x - g[0].x), mh = Math.abs(g[1].y - g[0].y);
        ctx.fillStyle = rgba(mc, 0.12); ctx.fillRect(mx, my, mw, mh); ctx.strokeStyle = mc; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); ctx.lineTo(g[1].x, g[1].y); ctx.stroke();
        var dp = s.pts[1].p - s.pts[0].p, bars = Math.round(idxOfTime(s.pts[1].t) - idxOfTime(s.pts[0].t)), secs = Math.abs(s.pts[1].t - s.pts[0].t), dur = secs >= 86400 ? (secs / 86400).toFixed(1) + ' วัน' : (secs / 3600).toFixed(1) + ' ชม.';
        label((dp >= 0 ? '+' : '−') + px(Math.abs(dp), dg) + '  (' + (dp >= 0 ? '+' : '−') + Math.abs(dp / s.pts[0].p * 100).toFixed(2) + '%)  ·  ' + Math.abs(bars) + ' แท่ง  ·  ' + dur, mx + mw / 2, up ? my - 14 : my + mh + 14, mc, '#fff', 'center'); break;
      }
      case 'text': label(s.text || '', g[0].x, g[0].y, rgba(c, 0.92), '#fff', 'left'); break;
    }
    ctx.restore();
    if (!preview && SEL === s.id && TOOL === 'cursor') {
      g.forEach(function (p) { ctx.fillStyle = '#fff'; ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9); ctx.fill(); ctx.stroke(); });
    }
  }
  function draw() {
    if (!CH || !cv) return; var W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); if (HIDE) return;
    var ps = plotSize(); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, ps.w, ps.h); ctx.clip();
    list().forEach(function (s) { drawShape(s, false); }); if (CUR) drawShape(CUR, true); ctx.restore();
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (OLY.page !== 'chart' || !CH || !cv || !cv.isConnected) return;
    var r = CH.chart.timeScale().getVisibleLogicalRange(), sig = [r && r.from, r && r.to, yOf(1000), yOf(2000), cv.clientWidth, cv.clientHeight, rows().length, SEL, TOOL, HIDE].join('|');
    if (sig !== lastSig || dirty) { lastSig = sig; dirty = false; try { draw(); } catch (e) { console.error(e); } }
  }

  // ---- interaction
  function relXY(e) { var r = CH.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function inPlot(p) { var ps = plotSize(); return p.x >= 0 && p.y >= 0 && p.x <= ps.w && p.y <= ps.h; }
  function onWrapMove(e) {
    if (!CH || DRAG) return; var p = relXY(e); mouse = p;
    if (TOOL !== 'cursor' || CUR || !inPlot(p)) { hitEl.style.pointerEvents = 'none'; return; }
    var h = topHit(p.x, p.y); hitEl.style.pointerEvents = h ? 'auto' : 'none'; hitEl.style.cursor = h ? (h.kind === 'handle' ? 'pointer' : 'move') : '';
  }
  function onHitDown(e) {
    var p = relXY(e), h = topHit(p.x, p.y); if (!h) return; e.preventDefault(); e.stopPropagation();
    SEL = h.shape.id; props(); snap();
    var l0 = CH.chart.timeScale().coordinateToLogical(p.x), p0 = pOfY(p.y);
    DRAG = { id: SEL, kind: h.kind, i: h.i, l0: l0, p0: p0, orig: JSON.parse(JSON.stringify(h.shape.pts)), moved: false };
    dirty = true;
  }
  function onDocMove(e) {
    if (!DRAG || !CH) return; var p = relXY(e), s = byId(DRAG.id); if (!s) return; DRAG.moved = true;
    if (DRAG.kind === 'handle') { var pt = pointAt(p.x, p.y, MAGNET); if (pt) s.pts[DRAG.i] = pt; }
    else {
      var l = CH.chart.timeScale().coordinateToLogical(p.x), pr = pOfY(p.y); if (l == null || pr == null) return;
      var dl = l - DRAG.l0, dp = pr - DRAG.p0;
      s.pts = DRAG.orig.map(function (o) { return { t: timeOfIdx(idxOfTime(o.t) + dl), p: o.p + dp }; });
    }
    dirty = true;
  }
  function onDocUp() { if (!DRAG) return; if (DRAG.moved) persist(); else UNDO.pop(); DRAG = null; dirty = true; hitEl.style.pointerEvents = 'none'; }
  function onChartClick(p) {
    if (!p.point) return;
    if (TOOL === 'cursor') { if (SEL) { SEL = null; props(); dirty = true; } return; }
    var pt = pointAt(p.point.x, p.point.y, MAGNET); if (!pt) return;
    var def = TOOLS.filter(function (t) { return t.id === TOOL; })[0];
    if (def.pts === 1) finalize({ type: TOOL, pts: [pt] });
    else if (!CUR) { CUR = { type: TOOL, pts: [pt, { t: pt.t, p: pt.p }], color: LASTCOLOR, w: DEFW[TOOL] || 1.5 }; dirty = true; }
    else { CUR.pts[1] = pt; var s = CUR; CUR = null; finalize(s); }
  }
  function onChartMove(p) {
    if (!CUR || !p.point) return; var pt = pointAt(p.point.x, p.point.y, MAGNET); if (pt) { CUR.pts[1] = pt; dirty = true; }
  }
  function onKey(e) {
    if (OLY.page !== 'chart' || !CH) return; var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.key === 'Escape') { if (CUR || TOOL !== 'cursor') setTool('cursor'); else { SEL = null; props(); dirty = true; } closeMenus(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && SEL) { e.preventDefault(); deleteSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (!e.ctrlKey && !e.altKey && !e.metaKey && e.altKey === false) { var map = { t: 'trend', r: 'ray', h: 'hline', v: 'vline', f: 'fib', m: 'measure' }; if (map[e.key.toLowerCase()] && e.shiftKey) setTool(map[e.key.toLowerCase()]); }
  }

  // ---- floating properties bar for the selected shape
  function props() {
    var el = $('#dwprops'); if (!el) return; var s = SEL && byId(SEL);
    if (!s) { el.style.display = 'none'; return; } el.style.display = 'flex';
    el.innerHTML = COLORS.map(function (c) { return '<button class="sc' + (c === s.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>'; }).join('') +
      '<span class="sep"></span>' + [1, 2, 3].map(function (w) { return '<button class="wd' + (Math.round(s.w) === w ? ' on' : '') + '" data-w="' + w + '"><i style="height:' + w + 'px"></i></button>'; }).join('') +
      '<span class="sep"></span><button class="del" title="ลบ (Delete)">' + svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 16) + '</button>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-c]'), function (b) { b.onclick = function () { snap(); s.color = b.dataset.c; LASTCOLOR = s.color; LS.set('oly-dcolor', LASTCOLOR); persist(); dirty = true; props(); }; });
    Array.prototype.forEach.call(el.querySelectorAll('[data-w]'), function (b) { b.onclick = function () { snap(); s.w = +b.dataset.w; persist(); dirty = true; props(); }; });
    $('.del', el).onclick = deleteSel;
  }

  // =================================================================== indicators
  function nz(v) { return v != null && isFinite(v); }
  function smaA(v, n) { var o = [], s = 0, c = 0; for (var i = 0; i < v.length; i++) { if (nz(v[i])) { s += v[i]; c++; } if (i >= n && nz(v[i - n])) { s -= v[i - n]; c--; } o.push(i >= n - 1 && c === n ? s / n : null); } return o; }
  function emaA(v, n) { var a = 2 / (n + 1), o = [], p = null, k = 0; for (var i = 0; i < v.length; i++) { if (!nz(v[i])) { o.push(null); continue; } p = p == null ? v[i] : a * v[i] + (1 - a) * p; k++; o.push(k >= n ? p : null); } return o; }
  function wmaA(v, n) { var o = [], den = n * (n + 1) / 2; for (var i = 0; i < v.length; i++) { if (i < n - 1) { o.push(null); continue; } var s = 0; for (var k = 0; k < n; k++) s += v[i - k] * (n - k); o.push(s / den); } return o; }
  function stdA(v, n) { var m = smaA(v, n), o = []; for (var i = 0; i < v.length; i++) { if (m[i] == null) { o.push(null); continue; } var s = 0; for (var k = 0; k < n; k++) s += Math.pow(v[i - k] - m[i], 2); o.push(Math.sqrt(s / n)); } return o; }
  function rmaA(v, n) { var o = [], p = null, s = 0, c = 0; for (var i = 0; i < v.length; i++) { if (!nz(v[i])) { o.push(null); continue; } if (p == null) { s += v[i]; c++; if (c === n) { p = s / n; o.push(p); } else o.push(null); } else { p = (p * (n - 1) + v[i]) / n; o.push(p); } } return o; }
  function trA(h, l, c) { return h.map(function (x, i) { return i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]; }); }
  function atrA(R, n) { return rmaA(trA(R.h, R.l, R.c), n); }
  function rsiA(c, n) { var g = [null], ls = [null]; for (var i = 1; i < c.length; i++) { var d = c[i] - c[i - 1]; g.push(Math.max(d, 0)); ls.push(Math.max(-d, 0)); } var ag = rmaA(g, n), al = rmaA(ls, n); return ag.map(function (x, i) { return x == null || al[i] == null ? null : (al[i] === 0 ? 100 : 100 - 100 / (1 + x / al[i])); }); }
  function donA(h, l, n, incl) { var up = [], lo = []; for (var i = 0; i < h.length; i++) { var a = incl ? i - n + 1 : i - n, b = incl ? i : i - 1; if (a < 0) { up.push(null); lo.push(null); continue; } var mx = -1e18, mn = 1e18; for (var k = a; k <= b; k++) { if (h[k] > mx) mx = h[k]; if (l[k] < mn) mn = l[k]; } up.push(mx); lo.push(mn); } return [up, lo]; }
  function hhA(v, n, f) { return v.map(function (_, i) { if (i < n - 1) return null; var m = f === 'max' ? -1e18 : 1e18; for (var k = i - n + 1; k <= i; k++) m = f === 'max' ? Math.max(m, v[k]) : Math.min(m, v[k]); return m; }); }
  function vwapA(R) {
    if (tfs() >= 86400) return R.c.map(function () { return null; });
    var o = [], pv = 0, vv = 0, day = null;
    for (var i = 0; i < R.c.length; i++) { var d = Math.floor(R.t[i] / 86400); if (d !== day) { day = d; pv = 0; vv = 0; } var tp = (R.h[i] + R.l[i] + R.c[i]) / 3, v = R.v[i] || 1; pv += tp * v; vv += v; o.push(pv / vv); }
    return o;
  }
  function superA(R, n, m) {
    var atr = atrA(R, n), up = [], dn = [], fu = null, fl = null, tr = 1;
    for (var i = 0; i < R.c.length; i++) {
      if (atr[i] == null) { up.push(null); dn.push(null); continue; }
      var hl2 = (R.h[i] + R.l[i]) / 2, bu = hl2 + m * atr[i], bl = hl2 - m * atr[i];
      fu = (fu == null || bu < fu || R.c[i - 1] > fu) ? bu : fu; fl = (fl == null || bl > fl || R.c[i - 1] < fl) ? bl : fl;
      if (tr === 1 && R.c[i] < fl) tr = -1; else if (tr === -1 && R.c[i] > fu) tr = 1;
      up.push(tr === 1 ? fl : null); dn.push(tr === -1 ? fu : null);
    }
    return [up, dn];
  }
  function stochA(R, k, d, s) { var hh = hhA(R.h, k, 'max'), ll = hhA(R.l, k, 'min'), raw = R.c.map(function (c, i) { return hh[i] == null || hh[i] === ll[i] ? null : (c - ll[i]) / (hh[i] - ll[i]) * 100; }), K = smaA(raw, s); return [K, smaA(K, d)]; }
  function cciA(R, n) { var tp = R.c.map(function (c, i) { return (R.h[i] + R.l[i] + c) / 3; }), m = smaA(tp, n); return tp.map(function (v, i) { if (m[i] == null) return null; var s = 0; for (var k = 0; k < n; k++) s += Math.abs(tp[i - k] - m[i]); var md = s / n; return md ? (v - m[i]) / (0.015 * md) : 0; }); }
  function macdA(c, f, s, g) { var a = emaA(c, f), b = emaA(c, s), m = a.map(function (x, i) { return x == null || b[i] == null ? null : x - b[i]; }), sg = emaA(m, g), h = m.map(function (x, i) { return x == null || sg[i] == null ? null : x - sg[i]; }); return [m, sg, h]; }

  var CAT = {
    sma: { name: 'SMA (เส้นค่าเฉลี่ย)', pane: false, params: [['n', 'ช่วง', 20]], color: '#9aa7b8', out: function (R, p) { return [{ d: smaA(R.c, p.n) }]; } },
    ema: { name: 'EMA (เส้นค่าเฉลี่ยถ่วงน้ำหนักเลขชี้กำลัง)', pane: false, params: [['n', 'ช่วง', 20]], color: '#4b93ea', out: function (R, p) { return [{ d: emaA(R.c, p.n) }]; } },
    wma: { name: 'WMA', pane: false, params: [['n', 'ช่วง', 20]], color: '#c99700', out: function (R, p) { return [{ d: wmaA(R.c, p.n) }]; } },
    bb: { name: 'Bollinger Bands', pane: false, params: [['n', 'ช่วง', 20], ['k', 'ส่วนเบี่ยงเบน', 2]], color: '#4f6bed', out: function (R, p) { var m = smaA(R.c, p.n), s = stdA(R.c, p.n); return [{ d: m.map(function (x, i) { return x == null ? null : x + p.k * s[i]; }) }, { d: m, dash: 2 }, { d: m.map(function (x, i) { return x == null ? null : x - p.k * s[i]; }) }]; } },
    don: { name: 'Donchian Channel (ไม่รวมแท่งปัจจุบัน แบบที่ Hermes ใช้)', pane: false, params: [['n', 'ช่วง', 20]], color: '#8d9bb0', out: function (R, p) { var x = donA(R.h, R.l, p.n, false); return [{ d: x[0] }, { d: x[1] }]; } },
    vwap: { name: 'VWAP (รีเซ็ตรายวัน ใช้ tick volume, เฉพาะ TF ต่ำกว่า D1)', pane: false, params: [], color: '#e5489b', out: function (R) { return [{ d: vwapA(R) }]; } },
    st: { name: 'Supertrend', pane: false, params: [['n', 'ATR', 10], ['m', 'ตัวคูณ', 3]], color: '#0f8a55', out: function (R, p) { var x = superA(R, p.n, p.m); return [{ d: x[0], color: '#0f8a55' }, { d: x[1], color: '#c8372f' }]; } },
    rsi: { name: 'RSI', pane: true, params: [['n', 'ช่วง', 14]], color: '#9b5de5', levels: [30, 70], range: [0, 100], out: function (R, p) { return [{ d: rsiA(R.c, p.n) }]; } },
    macd: { name: 'MACD', pane: true, params: [['f', 'เร็ว', 12], ['s', 'ช้า', 26], ['g', 'Signal', 9]], color: '#2a78d6', levels: [0], out: function (R, p) { var x = macdA(R.c, p.f, p.s, p.g); return [{ d: x[2], hist: true }, { d: x[0] }, { d: x[1], color: '#e8890c' }]; } },
    stoch: { name: 'Stochastic', pane: true, params: [['k', '%K', 14], ['d', '%D', 3], ['s', 'Smooth', 3]], color: '#2a78d6', levels: [20, 80], range: [0, 100], out: function (R, p) { var x = stochA(R, p.k, p.d, p.s); return [{ d: x[0] }, { d: x[1], color: '#e8890c' }]; } },
    atr: { name: 'ATR', pane: true, params: [['n', 'ช่วง', 14]], color: '#e8890c', out: function (R, p) { return [{ d: atrA(R, p.n) }]; } },
    cci: { name: 'CCI', pane: true, params: [['n', 'ช่วง', 20]], color: '#0e9f8e', levels: [-100, 100], out: function (R, p) { return [{ d: cciA(R, p.n) }]; } }
  };
  var BOTS = {};
  var INDS = LS.get('oly-inds2', null);
  if (!INDS) {   // first run: carry over the old toggle chips
    INDS = []; var lg = P.ind || {};
    if (lg.ema200) INDS.push(mk('ema', { n: 200 })); if (lg.sma50) INDS.push(mk('sma', { n: 50 })); if (lg.sma200) INDS.push(mk('sma', { n: 200 }));
    if (lg.don20) INDS.push(mk('don', { n: 20 })); if (lg.don55) INDS.push(mk('don', { n: 55 }));
    LS.set('oly-inds2', INDS);
  }
  function mk(id, params, color, extra) {
    var o = { uid: uid(), id: id, params: {}, color: color || CAT[id].color, on: true };
    CAT[id].params.forEach(function (q) { o.params[q[0]] = params && params[q[0]] != null ? params[q[0]] : q[2]; });
    if (extra) for (var k in extra) o[k] = extra[k]; return o;
  }
  function saveInds() { LS.set('oly-inds2', INDS); }
  function indTitle(o) { var c = CAT[o.id], ps = c.params.map(function (q) { return o.params[q[0]]; }).join(', '); return c.name.split(' (')[0] + (ps ? ' (' + ps + ')' : ''); }

  var LIVEI = {}, PANES = [], SYNC = false;
  function RS() { var d = rows(); return { t: d.map(function (r) { return r[0]; }), o: d.map(function (r) { return r[1]; }), h: d.map(function (r) { return r[2]; }), l: d.map(function (r) { return r[3]; }), c: d.map(function (r) { return r[4]; }), v: d.map(function (r) { return r[5]; }) }; }
  function pointsOf(R, d) { var o = []; for (var i = 0; i < d.length; i++) o.push(nz(d[i]) ? { time: R.t[i], value: d[i] } : { time: R.t[i] }); return o; }
  function pickColor(o, spec, k) { return spec.color || (k === 0 || !CAT[o.id].pane ? o.color : o.color); }
  function removeInd(uidv) {
    var L = LIVEI[uidv]; if (!L) return;
    if (L.pane) { try { L.pane.chart.remove(); } catch (e) {} L.pane.el.remove(); PANES = PANES.filter(function (p) { return p !== L.pane; }); }
    else L.series.forEach(function (s) { try { CH.chart.removeSeries(s); } catch (e) {} });
    delete LIVEI[uidv];
  }
  function buildInd(o, R) {
    var c = CAT[o.id]; if (!c) return; var outs = c.out(R, o.params), L = { series: [], outs: outs, pane: null }; LIVEI[o.uid] = L;
    var chart = CH.chart;
    if (c.pane) {
      var el = document.createElement('div'); el.className = 'dwpane'; el.innerHTML = '<div class="dwph"><b></b><span class="val"></span><span class="acts"><button data-a="eye" title="ซ่อน/แสดง">' + svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 14) + '</button><button data-a="set" title="ตั้งค่า">' + svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', 14) + '</button><button data-a="x" title="ลบ">' + svg('<path d="M6 6l12 12M18 6L6 18"/>', 14) + '</button></span></div><div class="dwpc"></div>';
      WRAP.appendChild(el); $('b', el).textContent = indTitle(o);
      var T = A.theme(), pc = $('.dwpc', el);
      var pch = LightweightCharts.createChart(pc, { width: pc.clientWidth, height: 130, layout: { background: { type: 'solid', color: T.bg }, textColor: T.ink, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 }, grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } }, rightPriceScale: { borderColor: T.line, minimumWidth: 72, scaleMargins: { top: 0.12, bottom: 0.12 } }, timeScale: { visible: false, rightOffset: 8, barSpacing: 9 }, crosshair: { mode: 0, horzLine: { visible: false, labelVisible: false } }, localization: { timeFormatter: function (t) { return ''; } } });
      L.pane = { chart: pch, el: el, o: o, vals: [], ready: false }; PANES.push(L.pane);
      new ResizeObserver(function () { try { pch.applyOptions({ width: pc.clientWidth }); } catch (e) {} }).observe(pc);
      outs.forEach(function (sp, k) {
        var col = sp.color || o.color, s;
        if (sp.hist) s = pch.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        else s = pch.addLineSeries({ color: col, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: k === 0, crosshairMarkerVisible: false });
        L.series.push(s);
      });
      (c.levels || []).concat(o.levels || []).forEach(function (lv) { L.series[0].createPriceLine({ price: lv, color: 'rgba(136,146,160,.7)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }); });
      el.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'x') { INDS = INDS.filter(function (x) { return x.uid !== o.uid; }); saveInds(); removeInd(o.uid); layoutLegend(); } else if (b.dataset.a === 'eye') { o.on = !o.on; saveInds(); rebuildInds(); } else { openMenu('active'); } };
      pch.subscribeCrosshairMove(function (p) { if (!p.time) { clearCross(); return; } var r = A.rowAt(p.time); if (r) setCross(p.time, 'pane'); });
      pch.timeScale().subscribeVisibleLogicalRangeChange(function (r) { if (SYNC || !r || !L.pane.ready) return; SYNC = true; try { CH.chart.timeScale().setVisibleLogicalRange(r); } catch (e) {} SYNC = false; });
    } else {
      outs.forEach(function (sp, k) {
        var s = chart.addLineSeries({ color: sp.color || o.color, lineWidth: k === 1 && o.id === 'bb' ? 1 : 1.5, lineStyle: sp.dash || (o.dash ? 2 : 0), priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        L.series.push(s);
      });
    }
    outs.forEach(function (sp, k) {
      if (sp.hist) L.series[k].setData(R.t.map(function (t, i) { var v = sp.d[i]; return nz(v) ? { time: t, value: v, color: v >= 0 ? 'rgba(15,138,85,.6)' : 'rgba(200,55,47,.6)' } : { time: t }; }));
      else L.series[k].setData(pointsOf(R, sp.d));
    });
  }
  function rebuildInds() {
    if (!CH || !rows().length) return; Object.keys(LIVEI).forEach(removeInd); var R = RS();
    INDS.forEach(function (o) { if (o.on && CAT[o.id]) buildInd(o, R); });
    var mainR = CH.chart.timeScale().getVisibleLogicalRange(); SYNC = true; if (mainR) PANES.forEach(function (p) { try { p.chart.timeScale().setVisibleLogicalRange(mainR); } catch (e) {} }); SYNC = false;
    setTimeout(function () { PANES.forEach(function (p) { p.ready = true; }); }, 80);
    layoutLegend(); draw1();
  }
  function refreshInds() {
    if (!CH || !rows().length) return; var R = RS(), n = R.t.length - 1;
    INDS.forEach(function (o) {
      var L = LIVEI[o.uid]; if (!L) return; var outs = CAT[o.id].out(R, o.params); L.outs = outs;
      outs.forEach(function (sp, k) { var v = sp.d[n], pt = nz(v) ? (sp.hist ? { time: R.t[n], value: v, color: v >= 0 ? 'rgba(15,138,85,.6)' : 'rgba(200,55,47,.6)' } : { time: R.t[n], value: v }) : { time: R.t[n] }; try { L.series[k].update(pt); } catch (e) {} });
    });
  }
  function draw1() { dirty = true; }

  // ---- values at the crosshair (legend of overlays + pane headers)
  function fmtv(v) { return v == null ? '–' : Math.abs(v) >= 1000 ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }) : Number(v).toFixed(Math.abs(v) < 10 ? 3 : 2); }
  function setCross(t, from) {
    var d = rows(), i = idxOfTime(t); i = clamp(Math.round(i), 0, d.length - 1); var il = $('#indleg');
    INDS.forEach(function (o) {
      var L = LIVEI[o.uid]; if (!L) return; var txt = L.outs.map(function (sp) { return fmtv(sp.d[i]); }).join('  ');
      if (L.pane) { $('.val', L.pane.el).textContent = txt; if (from !== 'pane' || true) { try { if (typeof L.pane.chart.setCrosshairPosition === 'function' && from === 'main') { var v0 = L.outs[0].d[i]; if (nz(v0)) L.pane.chart.setCrosshairPosition(v0, d[i][0], L.series[0]); } } catch (e) {} } }
      else if (il) { var e = il.querySelector('[data-u="' + o.uid + '"] .val'); if (e) e.textContent = txt; }
    });
    if (from === 'pane') { try { if (typeof CH.chart.setCrosshairPosition === 'function') CH.chart.setCrosshairPosition(d[i][4], d[i][0], CH.candles); } catch (e) {} }
  }
  function clearCross() { try { if (CH.chart.clearCrosshairPosition) CH.chart.clearCrosshairPosition(); PANES.forEach(function (p) { p.chart.clearCrosshairPosition && p.chart.clearCrosshairPosition(); }); } catch (e) {} }
  function layoutLegend() {
    var il = $('#indleg'); if (!il) return;
    il.innerHTML = INDS.filter(function (o) { return !CAT[o.id].pane; }).map(function (o) {
      return '<div class="il' + (o.on ? '' : ' off') + '" data-u="' + o.uid + '"><i style="background:' + o.color + '"></i><b>' + esc(indTitle(o)) + '</b><span class="val"></span><button data-a="eye" title="ซ่อน/แสดง">' + svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 12) + '</button><button data-a="set" title="ตั้งค่า">' + svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 12) + '</button><button data-a="x" title="ลบ">' + svg('<path d="M6 6l12 12M18 6L6 18"/>', 12) + '</button></div>';
    }).join('');
    Array.prototype.forEach.call(il.querySelectorAll('.il'), function (row) {
      row.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; var o = INDS.filter(function (x) { return x.uid === row.dataset.u; })[0]; if (!o) return;
        if (b.dataset.a === 'x') { INDS = INDS.filter(function (x) { return x !== o; }); saveInds(); removeInd(o.uid); layoutLegend(); }
        else if (b.dataset.a === 'eye') { o.on = !o.on; saveInds(); rebuildInds(); } else openMenu('active'); };
    });
  }

  // ---- indicator menu (add / active / bot presets)
  var MENUTAB = 'add';
  function closeMenus() { var m = $('#indmenu'); if (m) m.style.display = 'none'; var c = $('#ctxmenu'); if (c) c.remove(); }
  function openMenu(tab) { var m = $('#indmenu'); if (!m) return; if (tab) MENUTAB = tab; if (m.style.display === 'block' && !tab) { m.style.display = 'none'; return; } m.style.display = 'block'; renderMenu(); }
  function renderMenu() {
    var m = $('#indmenu'); if (!m) return;
    var h = '<div class="mt"><button data-t="add" class="' + (MENUTAB === 'add' ? 'on' : '') + '">เพิ่ม</button><button data-t="active" class="' + (MENUTAB === 'active' ? 'on' : '') + '">ที่ใช้อยู่ (' + INDS.length + ')</button><button data-t="bots" class="' + (MENUTAB === 'bots' ? 'on' : '') + '">ของบอท</button><button data-t="close" class="cl">✕</button></div>';
    if (MENUTAB === 'add') {
      h += '<input id="indq" placeholder="ค้นหา เช่น RSI, MACD, Bollinger" autocomplete="off"><div class="ml" id="indlist"></div>';
    } else if (MENUTAB === 'active') {
      h += '<div class="ml">' + (INDS.length ? INDS.map(function (o) {
        var c = CAT[o.id]; return '<div class="ar" data-u="' + o.uid + '"><input type="color" value="' + o.color + '" data-f="color"><b>' + esc(c.name.split(' (')[0]) + '</b>' + c.params.map(function (q) { return '<label>' + esc(q[1]) + '<input type="number" step="any" value="' + o.params[q[0]] + '" data-p="' + q[0] + '"></label>'; }).join('') + '<button data-a="eye" class="' + (o.on ? '' : 'off') + '">' + (o.on ? 'แสดง' : 'ซ่อน') + '</button><button data-a="x">ลบ</button></div>';
      }).join('') : '<div class="s">ยังไม่มีตัวชี้วัด เลือกจากแท็บ "เพิ่ม" หรือ "ของบอท"</div>') + '</div>';
    } else {
      var bl = BOTS[P.symbol] || [];
      h += '<div class="ml">' + (bl.length ? '<div class="s">เพิ่มตัวชี้วัดที่บอทใช้ตัดสินใจจริงของตลาดนี้ (ค่าเดียวกับในโค้ด olympus) ดูได้ว่าราคาเข้าใกล้เงื่อนไขเข้าไม้หรือยัง</div>' + bl.map(function (b, i) { return '<button class="bt" data-b="' + i + '"><i style="background:' + A.sc(b.m) + '"></i>' + esc(b.title) + '</button>'; }).join('') : '<div class="s">ตลาดนี้ไม่มีบอทของ olympus</div>') + '</div>';
    }
    m.innerHTML = h;
    $('.mt', m).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.t === 'close') { m.style.display = 'none'; return; } MENUTAB = b.dataset.t; renderMenu(); };
    if (MENUTAB === 'add') {
      var q = $('#indq', m), draw_ = function () {
        var f = q.value.trim().toLowerCase(), out = [];
        [['บนกราฟราคา', false], ['แยกหน้าต่างด้านล่าง', true]].forEach(function (g) {
          var ks = Object.keys(CAT).filter(function (k) { return CAT[k].pane === g[1] && (!f || CAT[k].name.toLowerCase().indexOf(f) >= 0 || k.indexOf(f) >= 0); });
          if (ks.length) out.push('<h4>' + g[0] + '</h4>' + ks.map(function (k) { return '<button class="ci" data-k="' + k + '">' + esc(CAT[k].name) + '</button>'; }).join(''));
        });
        $('#indlist', m).innerHTML = out.join('') || '<div class="s">ไม่พบ</div>';
        Array.prototype.forEach.call($('#indlist', m).querySelectorAll('.ci'), function (b) { b.onclick = function () { INDS.push(mk(b.dataset.k)); saveInds(); rebuildInds(); MENUTAB = 'active'; renderMenu(); }; });
      };
      q.oninput = draw_; draw_(); q.focus();
    } else if (MENUTAB === 'active') {
      Array.prototype.forEach.call(m.querySelectorAll('.ar'), function (row) {
        var o = INDS.filter(function (x) { return x.uid === row.dataset.u; })[0]; if (!o) return;
        row.onchange = function (e) { var t = e.target; if (t.dataset.f === 'color') o.color = t.value; else if (t.dataset.p) { var v = parseFloat(t.value); if (isFinite(v) && v > 0) o.params[t.dataset.p] = v; } saveInds(); rebuildInds(); };
        row.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'x') { INDS = INDS.filter(function (x) { return x !== o; }); saveInds(); rebuildInds(); renderMenu(); } else if (b.dataset.a === 'eye') { o.on = !o.on; saveInds(); rebuildInds(); renderMenu(); } };
      });
    } else {
      Array.prototype.forEach.call(m.querySelectorAll('.bt'), function (b) {
        b.onclick = function () {
          var bot = BOTS[P.symbol][+b.dataset.b], col = A.sc(bot.m);
          bot.add.forEach(function (a) { var ex = {}; if (a[2] === 'dash') ex.dash = true; else if (a[2]) ex.levels = a[2]; var o = mk(a[0], a[1], col, ex); if (!INDS.some(function (x) { return x.id === o.id && JSON.stringify(x.params) === JSON.stringify(o.params); })) INDS.push(o); });
          saveInds(); rebuildInds(); MENUTAB = 'active'; renderMenu();
        };
      });
    }
  }

  // =================================================================== compare, screenshot, fullscreen, chart type
  var CMP = null;
  function setCompare(sym) {
    if (CMP) { try { CH.chart.removeSeries(CMP); } catch (e) {} CMP = null; }
    P.cmp = sym || ''; A.saveP(); if (!sym || sym === P.symbol) return;
    fetch('/api/chart?symbol=' + sym + '&tf=' + P.tf + '&count=3000').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || !CH || P.cmp !== sym) return; var d = rows(), m = {}; d.forEach(function (r) { m[r[0]] = r[4]; });
      var first = null; for (var i = 0; i < j.candles.length; i++) if (m[j.candles[i][0]] != null) { first = i; break; } if (first == null) return;
      var k = m[j.candles[first][0]] / j.candles[first][4];
      CMP = CH.chart.addLineSeries({ color: '#8e44ad', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: A.NICE[sym] + ' (ปรับให้เริ่มที่ราคาเดียวกัน)', crosshairMarkerVisible: false });
      CMP.setData(j.candles.slice(first).map(function (r) { return { time: r[0], value: r[4] * k }; }));
    });
  }
  function screenshot() {
    if (!CH || !CH.chart.takeScreenshot) return; var shot = CH.chart.takeScreenshot(), out = document.createElement('canvas'); out.width = shot.width; out.height = shot.height;
    var o = out.getContext('2d'); o.drawImage(shot, 0, 0); if (!HIDE && cv) o.drawImage(cv, 0, 0, shot.width, shot.height);
    out.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'olympus_' + A.NICE[P.symbol].replace(/\W+/g, '') + '_' + P.tf + '_' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.png'; document.body.appendChild(a); a.click(); a.remove(); });
  }
  function fullscreen() { var w = WRAP; if (!w) return; if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen(); }
  document.addEventListener('fullscreenchange', function () {
    if (!CH || !WRAP) return; var full = document.fullscreenElement === WRAP; WRAP.classList.toggle('full', full);
    var panes = PANES.length * 132, h = full ? Math.max(300, window.innerHeight - panes - 4) : Math.max(480, Math.min(720, window.innerHeight - 330));
    CH.chart.applyOptions({ height: h }); dirty = true;
  });

  // =================================================================== wiring on every chart build
  var keyBound = false;
  A.hooks.built.push(function (ch) {
    CH = ch; WRAP = $('.chwrap'); if (!WRAP) return;
    if (typeof LightweightCharts === 'undefined') return;
    PANES.forEach(function (p) { try { p.chart.remove(); } catch (e) {} }); PANES = []; LIVEI = {}; CMP = null; CUR = null; SEL = null; DRAG = null; UNDO = []; REDO = [];
    WRAP.classList.add('tb');
    // left toolbar
    var tb = document.createElement('div'); tb.className = 'dwtb';
    tb.innerHTML = TOOLS.map(function (t) { return '<button data-tool="' + t.id + '" title="' + esc(t.name) + '" class="' + (t.id === TOOL ? 'on' : '') + '">' + svg(t.icon) + '</button>'; }).join('') +
      '<span class="sep"></span><button id="dwmag" title="Magnet: จับราคา OHLC ของแท่งที่ใกล้ที่สุด" class="' + (MAGNET ? 'on' : '') + '">' + svg('<path d="M6 3v9a6 6 0 0012 0V3h-4v9a2 2 0 01-4 0V3z"/>') + '</button>' +
      '<button id="dwhide" title="ซ่อน/แสดงเส้นที่วาดทั้งหมด">' + svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>') + '</button>' +
      '<button id="dwundo" title="ย้อนกลับ (Ctrl+Z)">' + svg('<path d="M9 7L4 12l5 5M4 12h10a5 5 0 010 10h-3"/>') + '</button>' +
      '<button id="dwclear" title="ลบเส้นที่วาดทั้งหมดของตลาดนี้">' + svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>') + '</button>';
    WRAP.appendChild(tb);
    tb.onclick = function (e) { var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.id === 'dwmag') { MAGNET = !MAGNET; LS.set('oly-magnet', MAGNET); b.classList.toggle('on', MAGNET); }
      else if (b.id === 'dwhide') { HIDE = !HIDE; b.classList.toggle('on', HIDE); dirty = true; }
      else if (b.id === 'dwundo') undo();
      else if (b.id === 'dwclear') { if (list().length && window.confirm('ลบเส้นที่วาดทั้งหมดของ ' + A.NICE[P.symbol] + ' (' + list().length + ' รายการ)?')) { snap(); DR[P.symbol] = []; persist(); SEL = null; props(); dirty = true; } } };
    // overlay canvas + hit layer + props bar + indicator legend + menu
    cv = document.createElement('canvas'); cv.className = 'dwcv'; ctx = cv.getContext('2d'); WRAP.appendChild(cv);
    hitEl = document.createElement('div'); hitEl.className = 'dwhit'; WRAP.appendChild(hitEl);
    var pr = document.createElement('div'); pr.id = 'dwprops'; pr.className = 'dwprops'; pr.style.display = 'none'; WRAP.appendChild(pr);
    var il = document.createElement('div'); il.id = 'indleg'; il.className = 'indleg'; WRAP.appendChild(il);
    var mn = document.createElement('div'); mn.id = 'indmenu'; mn.className = 'indmenu'; mn.style.display = 'none'; WRAP.appendChild(mn);
    function place() { cv.style.left = hitEl.style.left = CH.el.offsetLeft + 'px'; cv.style.top = hitEl.style.top = CH.el.offsetTop + 'px'; cv.style.width = hitEl.style.width = CH.el.clientWidth + 'px'; cv.style.height = hitEl.style.height = CH.el.clientHeight + 'px'; }
    place(); new ResizeObserver(function () { place(); dirty = true; }).observe(CH.el);
    // toolbar chips: indicators, chart type, compare, screenshot, fullscreen
    var cx = $('#chx');
    if (cx) {
      cx.innerHTML = '<button id="xind" class="on2">ตัวชี้วัด</button><select id="xtype" title="ชนิดกราฟ"><option value="candle">แท่งเทียน</option><option value="ha">Heikin Ashi</option><option value="bars">แท่ง OHLC</option><option value="line">เส้น</option><option value="area">พื้นที่</option></select>' +
        '<select id="xcmp" title="เทียบกับตลาดอื่น"><option value="">เทียบกับ…</option>' + A.SYMS.filter(function (s) { return s !== P.symbol; }).map(function (s) { return '<option value="' + s + '">' + A.NICE[s] + '</option>'; }).join('') + '</select>' +
        '<button id="xshot" title="บันทึกภาพกราฟเป็น PNG">ภาพ</button><button id="xfull" title="เต็มจอ">เต็มจอ</button>';
      $('#xtype').value = P.ctype; $('#xtype').onchange = function () { P.ctype = this.value; A.saveP(); A.rebuild(); };
      if (P.cmp && P.cmp !== P.symbol) $('#xcmp').value = P.cmp; $('#xcmp').onchange = function () { setCompare(this.value); };
      $('#xind').onclick = function (e) { e.stopPropagation(); openMenu(); }; $('#xshot').onclick = screenshot; $('#xfull').onclick = fullscreen;
    }
    // chart events
    CH.chart.subscribeClick(onChartClick); CH.chart.subscribeCrosshairMove(function (p) { onChartMove(p); if (p.time) setCross(p.time, 'main'); else clearCross(); });
    CH.chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) { if (SYNC || !r) return; SYNC = true; PANES.forEach(function (p) { try { p.chart.timeScale().setVisibleLogicalRange(r); } catch (e) {} }); SYNC = false; dirty = true; });
    WRAP.addEventListener('mousemove', onWrapMove); WRAP.addEventListener('mouseleave', function () { if (!DRAG && hitEl) hitEl.style.pointerEvents = 'none'; });
    hitEl.addEventListener('mousedown', onHitDown);
    CH.el.addEventListener('contextmenu', function (e) {
      e.preventDefault(); closeMenus(); var p = relXY(e), price = pOfY(p.y); if (price == null) return;
      var m2 = document.createElement('div'); m2.id = 'ctxmenu'; m2.className = 'ctxmenu'; var wr = WRAP.getBoundingClientRect(); m2.style.left = (e.clientX - wr.left) + 'px'; m2.style.top = (e.clientY - wr.top) + 'px';
      m2.innerHTML = '<button data-a="alert">🔔 ตั้งแจ้งเตือนที่ราคา ' + px(price, CH.digits) + '</button><button data-a="hline">เส้นแนวนอนที่ราคานี้</button>' + (OLY.orderOn && OLY.orderOn() && OLY.ticketSet ? '<button data-a="tk-sl">ตั้งเป็น SL ในช่องส่งคำสั่ง</button><button data-a="tk-tp">ตั้งเป็น TP ในช่องส่งคำสั่ง</button><button data-a="tk-price">ตั้งเป็นราคาออเดอร์ค้าง</button>' : '') + (SEL ? '<button data-a="del">ลบเส้นที่เลือก</button>' : '');
      WRAP.appendChild(m2);
      m2.onclick = function (ev) { var b = ev.target.closest('button'); if (!b) return; if (b.dataset.a.indexOf('tk-') === 0) { OLY.ticketSet(b.dataset.a.slice(3), price); m2.remove(); return; } if (b.dataset.a === 'alert') A.addAlert(Math.round(price / CH.point) * CH.point); else if (b.dataset.a === 'hline') { var pt = pointAt(p.x, p.y, false); if (pt) { snap(); var s = { type: 'hline', pts: [pt], id: uid(), color: LASTCOLOR, w: 1.5 }; list().push(s); persist(); SEL = s.id; props(); dirty = true; } } else deleteSel(); m2.remove(); };
    });
    document.addEventListener('click', function (e) { var m = $('#indmenu'); if (m && m.style.display === 'block' && !e.target.closest('#indmenu') && !e.target.closest('#xind')) m.style.display = 'none'; var c = $('#ctxmenu'); if (c && !e.target.closest('#ctxmenu')) c.remove(); });
    if (!keyBound) { keyBound = true; document.addEventListener('keydown', onKey); document.addEventListener('mousemove', onDocMove); document.addEventListener('mouseup', onDocUp); }
    // migrate the old single-line tool
    var old = LS.get('oly-hlines', null); if (old && old.length) { old.forEach(function (h) { (DR[h.symbol] || (DR[h.symbol] = [])).push({ id: uid(), type: 'hline', pts: [{ t: Math.floor(Date.now() / 1000), p: h.price }], color: '#8892a0', w: 1.5 }); }); persist(); }
    LS.set('oly-hlines', []);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); dirty = true; props();
  });
  A.hooks.data.push(function () { rebuildInds(); if (P.cmp) setCompare(P.cmp); dirty = true; });
  A.hooks.live.push(function () { refreshInds(); dirty = true; });
})();
