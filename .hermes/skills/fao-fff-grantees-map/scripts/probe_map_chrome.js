// Probe the map's startup chrome, the zoom-driven basemap swap and the Layers panel's filters.
//   cd <repo> && python3 -m http.server 6115 --directory Webmap
//   cp ~/.hermes/skills/web-mapping/fao-fff-grantees-map/scripts/probe_map_chrome.js ~/pw-check/
//   cd ~/pw-check && node probe_map_chrome.js
// Exits non-zero on a page error or a failed assertion. Config via env: BASE, DISTRICT.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:6115';
const DISTRICT = process.env.DISTRICT || 'KABHREPALANCHOK';  // polygon used as the z13 anchor

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
  await page.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 30000 });
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
    markers: document.querySelectorAll('.org-pin-wrap, .grantee-cluster').length
  }));

  // --- startup: plain light-green canvas, District/Province drawn, Local Level off
  const start = await snap();
  check('startup: no tiles (empty L.gridLayer base, not L.tileLayer(""))', start.tiles === 0, start.tiles);
  check('startup: light-green canvas', start.bg === 'rgb(232, 245, 233)', start.bg);
  check('startup: District 77 + Province 7 drawn, Local Level 0',
        start.paths.district === 77 && start.paths.province === 7 && start.paths.localLevel === 0, start.paths);
  check('startup: switcher radio = No background', /No background/i.test(start.radio || ''), start.radio);

  // --- anchor: a district polygon centre at z13. The left-panel list and its row-click zoom were removed,
  // so drive the map through the boundary layer every build exposes (a layer instance always has _map).
  const anchored = await page.evaluate((district) => {
    let hit = null;
    window.layer_District.eachLayer(l => {
      if (!hit && new RegExp(district, 'i').test((l.feature.properties || {}).DISTRICT || '')) hit = l;
    });
    if (!hit) return null;
    const c = hit.getBounds().getCenter();
    window.layer_District._map.setView(c, 13);
    return { lat: c.lat, lng: c.lng };
  }, DISTRICT);
  check('anchor: district polygon found and centred at z13', !!anchored, anchored);
  await page.waitForTimeout(3200);
  const anchor = await snap();
  check('anchor: markers still render at z13', anchor.markers > 0, anchor.markers);
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

  // --- the filters live INSIDE the collapsed left "Layers" panel (the floating bar + #filterToggle are gone);
  //     the panel's own toggle is the only show/hide.
  const panelState = () => page.evaluate(() => ({
    collapsed: document.getElementById('leftPanel').classList.contains('collapsed'),
    filtersInside: !!document.querySelector('#leftPanel .panel-content #granteeFilterBar'),
    title: (document.querySelector('#leftPanel .panel-header') || {}).textContent ?
           document.querySelector('#leftPanel .panel-header').textContent.trim() : null
  }));
  const p0 = await panelState();
  check('startup: the left panel is collapsed', p0.collapsed === true, p0);
  check('the filters live inside the Layers panel', p0.filtersInside === true, p0);
  check('the left panel is titled Layers', p0.title === 'Layers', p0.title);
  await page.evaluate(() => document.querySelector('#leftPanel .panel-toggle-btn').click());
  await page.waitForTimeout(900);
  check('the panel toggle opens it', (await panelState()).collapsed === false);

  // --- a pill still filters. Count MEMBERS (pins + the numbers inside cluster labels): orgs absorbed into an
  //     existing cluster leave the icon count unchanged, so icons alone read as "the filter does nothing".
  const members = () => page.evaluate(() => {
    let n = document.querySelectorAll('.org-pin-wrap').length;
    document.querySelectorAll('.grantee-cluster').forEach(c => {
      const m = (c.innerText || '').match(/\d+/);
      if (m) n += parseInt(m[0], 10);
    });
    return n;
  });
  const before = await members();
  await page.evaluate(() => { const l = document.querySelector('#leftPanel .gf-type label.gf-value'); if (l) l.click(); });
  await page.waitForTimeout(1600);
  const after = await members();
  check('unchecking a Type pill filters members (' + before + ' -> ' + after + ')', before > 0 && after < before, { before, after });
  await page.evaluate(() => { const l = document.querySelector('#leftPanel .gf-type label.gf-value'); if (l) l.click(); });
  await page.waitForTimeout(1200);
  check('re-checking the pill restores every member', (await members()) === before, { before, now: await members() });

  check('no page errors', errs.length === 0, errs);
  await browser.close();
  if (failures.length) { console.log('\nFAILED: ' + failures.length + ' -> ' + failures.join('; ')); process.exit(1); }
  console.log('\nALL CHECKS PASSED');
})();
