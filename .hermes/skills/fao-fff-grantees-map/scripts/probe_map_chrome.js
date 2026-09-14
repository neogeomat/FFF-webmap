// Probe the map's startup chrome and the zoom-driven basemap swap.
//   cd <repo> && python3 -m http.server 6115 --directory Webmap
//   cp ~/.hermes/skills/web-mapping/fao-fff-grantees-map/scripts/probe_map_chrome.js ~/pw-check/
//   cd ~/pw-check && node probe_map_chrome.js
// Exits non-zero on a page error or a failed assertion. Config via env: BASE, SEARCH.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:6115';
const SEARCH = process.env.SEARCH || 'AFFON';   // any org WITH geometry (appears in the left DataTable)

const failures = [];
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failures.push(name);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.grantee-cluster', { timeout: 30000 });
  await page.waitForTimeout(5000);

  // one snapshot: tiles + switcher radio + boundary path counts + the pill states
  const snap = () => page.evaluate(() => ({
    tiles: document.querySelectorAll('img.leaflet-tile').length,
    bg: getComputedStyle(document.getElementById('map')).backgroundColor,
    radio: Array.from(document.querySelectorAll('.leaflet-control-layers-base label'))
      .filter(l => (l.querySelector('input') || {}).checked)
      .map(l => l.innerText.trim())[0] || null,
    paths: {
      district: (document.querySelector('.leaflet-pane_District-pane') || { querySelectorAll: () => [] }).querySelectorAll('path').length,
      province: (document.querySelector('.leaflet-pane_Province-pane') || { querySelectorAll: () => [] }).querySelectorAll('path').length,
      localLevel: (document.querySelector('.leaflet-pane_LocalLevel-pane') || { querySelectorAll: () => [] }).querySelectorAll('path').length
    },
    nearestPinToCentre: (function () {
      const m = document.getElementById('map').getBoundingClientRect();
      const cx = m.left + m.width / 2, cy = m.top + m.height / 2;
      let best = null;
      document.querySelectorAll('.org-pin-wrap').forEach(el => {
        const r = el.getBoundingClientRect(); if (!r.width) return;
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (best === null || d < best) best = Math.round(d);
      });
      return best;
    })()
  }));

  // --- startup: plain light-green canvas, District/Province drawn, Local Level off
  const start = await snap();
  check('startup: no tiles (empty L.gridLayer base, not L.tileLayer(""))', start.tiles === 0, start.tiles);
  check('startup: light-green canvas', start.bg === 'rgb(232, 245, 233)', start.bg);
  check('startup: District 77 + Province 7 drawn, Local Level 0',
        start.paths.district === 77 && start.paths.province === 7 && start.paths.localLevel === 0, start.paths);
  check('startup: switcher radio = No background', /No background/i.test(start.radio || ''), start.radio);

  // --- anchor: the left-panel row click lands on a KNOWN zoom (z13), where the satellite is already on
  await page.evaluate(() => document.querySelectorAll('#leftPanel .panel-toggle-btn')
    .forEach(b => { if (b.closest('.map-panel').classList.contains('collapsed')) b.click(); }));
  await page.waitForTimeout(900);
  await page.fill('#leftPanel .dataTables_filter input', SEARCH);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const r = document.querySelector('#leftPanel tbody tr');
    if (r && !r.querySelector('.dataTables_empty')) r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(3200);
  const anchor = await snap();
  check('row click centres its pin (nearest pin to map centre <= 40px)', anchor.nearestPinToCentre !== null && anchor.nearestPinToCentre <= 40, anchor.nearestPinToCentre);
  check('at the z13 anchor the satellite is on (tiles > 0)', anchor.tiles > 0, anchor.tiles);
  check('at the z13 anchor the radio says Satellite', /Satellite/i.test(anchor.radio || ''), anchor.radio);

  // --- one step OUT of the anchor must swap back to the plain canvas ...
  await page.click('.leaflet-control-zoom-out');
  await page.waitForTimeout(2400);
  const out = await snap();
  check('one zoom-out clears the tiles', out.tiles === 0, out.tiles);
  check('one zoom-out restores the No background radio', /No background/i.test(out.radio || ''), out.radio);

  // --- ... and stepping back IN must bring it back (a one-way handler passes without this)
  await page.click('.leaflet-control-zoom-in');
  await page.waitForTimeout(2400);
  const back = await snap();
  check('zooming back in returns the satellite', back.tiles > 0, back.tiles);

  // --- filter bar collapses on a click OUTSIDE its box, stays open for a pill inside it
  const barState = () => page.evaluate(() => {
    const bar = document.getElementById('granteeFilterBar');
    return { collapsed: bar.classList.contains('collapsed'), label: document.getElementById('filterToggle').textContent.trim() };
  });
  if ((await barState()).collapsed) { await page.click('#filterToggle'); await page.waitForTimeout(700); }
  check('filter bar opens on the toggle', !(await barState()).collapsed, (await barState()).label);
  await page.evaluate(() => { const l = document.querySelector('#granteeFilterBar .gf-value'); if (l) l.click(); });
  await page.waitForTimeout(500);
  check('clicking a PILL keeps the bar open', !(await barState()).collapsed, (await barState()).label);
  const box = await page.evaluate(() => { const r = document.getElementById('granteeFilterBar').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  // pick a point that is provably outside the bar: an expanded bar covers ~700x364 at top-centre,
  // so a naive "empty map" click can land on a pill and read as a broken handler
  const x = Math.round(Math.min(box.x, box.x + box.w) - 40);
  const y = Math.round(box.y + box.h + 120);
  await page.mouse.click(x, y);
  await page.waitForTimeout(800);
  const closed = await barState();
  check('click outside (' + x + ',' + y + ') collapses the bar', closed.collapsed, closed.label);

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  if (failures.length) { console.log('\nFAILED: ' + failures.length + ' -> ' + failures.join('; ')); process.exit(1); }
  console.log('\nALL CHECKS PASSED');
})();
