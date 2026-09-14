// The three modes must stay mutually exclusive and Evolution must still work after the women-mode change.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  let fail = 0;
  const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); };
  const state = () => p.evaluate(() => ({
    evo: document.body.classList.contains('map-mode-evolution'),
    women: document.body.classList.contains('map-mode-women'),
    tab: (document.querySelector('.mm-tab.active') || {}).getAttribute ? document.querySelector('.mm-tab.active').getAttribute('data-mode') : null,
    stored: localStorage.getItem('fff.mapMode'),
    evoTableVisible: (() => { const t = document.getElementById('tab-evolution'); return !!t && getComputedStyle(t).display !== 'none'; })(),
    aggVisible: (() => { const t = document.getElementById('tab-aggregate'); return !!t && getComputedStyle(t).display !== 'none'; })(),
    pins: document.querySelectorAll('.org-pin-wrap').length,
    clusters: document.querySelectorAll('.grantee-cluster').length
  }));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5000);

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="evolution"]').click());
  await p.waitForTimeout(2000);
  const e = await state();
  ok('evolution: evo class only', e.evo && !e.women, JSON.stringify(e));
  ok('evolution: tab active + persisted', e.tab === 'evolution' && e.stored === 'evolution', '');
  ok('evolution: evo table visible', e.evoTableVisible, '');
  ok('evolution: aggregate tab hidden', !e.aggVisible, '');

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="overview"]').click());
  await p.waitForTimeout(2000);
  const o = await state();
  ok('overview: no mode classes, all orgs', !o.evo && !o.women && o.tab === 'overview' && o.pins + o.clusters > 0, JSON.stringify({ tab: o.tab, pins: o.pins, clusters: o.clusters }));
  ok('overview: aggregate tab back', o.aggVisible, '');

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="women"]').click());
  await p.waitForTimeout(2000);
  const w = await state();
  ok('women: women class only', w.women && !w.evo, '');
  ok('women: evo table hidden', !w.evoTableVisible, '');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  await b.close(); process.exit(fail ? 1 : 0);
})();
