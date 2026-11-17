/* Language switch (ไทย / English). The dashboard is written in Thai; in English mode every piece of text that reaches the page is run
   through the phrase table in i18n_en.js (longest phrase first), including text that arrives later from the server. Thai mode does nothing. */
(function () {
  'use strict';
  var LANG = 'th'; try { LANG = localStorage.getItem('dash-lang') || 'th'; } catch (e) {}
  var D = window.OLY_EN || {}, TH = /[฀-๿]/, RUN = /[฀-๿][฀-๿.]*/g;
  var keys = Object.keys(D).filter(function (k) { return k.length > 3; }).sort(function (a, b) { return b.length - a.length; });
  var RX = keys.length ? new RegExp(keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g') : null;
  var CACHE = {};
  function tr(s) {
    if (LANG !== 'en' || !s || !TH.test(s)) return s;
    if (CACHE[s] !== undefined) return CACHE[s];
    var t = s.trim(), out;
    if (D[t] !== undefined) out = s.replace(t, D[t]);
    else {
      out = RX ? s.replace(RX, function (m) { return D[m]; }) : s;
      if (TH.test(out)) out = out.replace(RUN, function (m) { return D[m] !== undefined ? D[m] : (D[m.replace(/\.$/, '')] !== undefined ? D[m.replace(/\.$/, '')] : m); });   // short words only as whole runs
    }
    if (s.length < 400) CACHE[s] = out;
    return out;
  }
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  function fix(el) {
    if (el.nodeType === 3) { if (TH.test(el.nodeValue)) { var v = tr(el.nodeValue); if (v !== el.nodeValue) el.nodeValue = v; } return; }
    if (el.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(el.tagName)) return;
    var all = [el].concat(Array.prototype.slice.call(el.querySelectorAll('[title],[placeholder],[aria-label]')));
    all.forEach(function (x) { ATTRS.forEach(function (a) { var v = x.getAttribute && x.getAttribute(a); if (v && TH.test(v)) { var nv = tr(v); if (nv !== v) x.setAttribute(a, nv); } }); });
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = w.nextNode())) if (TH.test(n.nodeValue) && !/^(SCRIPT|STYLE)$/.test(n.parentNode.tagName)) list.push(n);
    list.forEach(function (x) { var nv = tr(x.nodeValue); if (nv !== x.nodeValue) x.nodeValue = nv; });
  }
  function set(l) { try { localStorage.setItem('dash-lang', l); } catch (e) {} location.reload(); }
  window.OLY_I18N = { lang: LANG, tr: tr, set: set };

  function addSwitch() {
    if (document.getElementById('langsw')) return;
    var host = document.querySelector('.side .brand') || document.querySelector('.side') || document.body, d = document.createElement('div');
    d.id = 'langsw'; d.className = 'langsw';
    d.innerHTML = '<button data-l="th" class="' + (LANG === 'th' ? 'on' : '') + '" title="ภาษาไทย">ไทย</button><button data-l="en" class="' + (LANG === 'en' ? 'on' : '') + '" title="English">EN</button>';
    d.onclick = function (e) { var b = e.target.closest('button'); if (b && b.dataset.l !== LANG) set(b.dataset.l); };
    host.appendChild(d);
  }
  function start() {
    addSwitch();
    if (LANG !== 'en') return;
    document.documentElement.lang = 'en';
    fix(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') fix(m.target);
        else if (m.type === 'attributes') { var v = m.target.getAttribute(m.attributeName); if (v && TH.test(v)) { var nv = tr(v); if (nv !== v) m.target.setAttribute(m.attributeName, nv); } }
        else Array.prototype.forEach.call(m.addedNodes, fix);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    ['alert', 'confirm', 'prompt'].forEach(function (f) { var o = window[f]; window[f] = function (a, b) { return o.call(window, tr(String(a)), b); }; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
