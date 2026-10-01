// Info panel + the auto-open preference.
// User rules: (1) the right panel is renamed Info and appears ONLY in Evolution mode,
// (2) the Layers tab sits flush and rides the bottom strip, (3) clicking a polygon must
// not ALWAYS open the Info panel - auto-open is a toggle.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(4000);
  // Districts are OFF by default (user rule): this probe clicks district polygons, so enable first.
  await p.evaluate(() => {
    const cb = document.querySelector('.gf-boundary[data-layer="layer_District"]');
    if (cb && !cb.checked) cb.closest('label.gf-value').click();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#mapModeTabs .mm-tab[data-mode="investment"]').click());
  await p.waitForTimeout(2200);
  await p.evaluate(() => ['leftPanel', 'rightPanel'].forEach(id => document.getElementById(id).classList.remove('collapsed')));
  await p.waitForTimeout(800);

  const disp = id => p.evaluate(i => getComputedStyle(document.getElementById(i)).display, id);
  const geo = () => p.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const lp = r('leftPanel'), lt = r('leftPanelToggle'), bp = r('bottomPanel');
    return { bpTop: Math.round(bp.top), ltTop: Math.round(lt.top),
             gapL: Math.round(lt.left - lp.right), lpBottom: Math.round(lp.bottom) };
  });

  // 1. Investment mode: the Info panel (and its tab) is hidden; the Layers tab sits flush.
  ok('Info panel hidden outside Evolution mode', await disp('rightPanel') === 'none', await disp('rightPanel'));
  const before = await geo();
  ok('no gap on the Layers toggle', before.gapL <= 1, JSON.stringify({ gapL: before.gapL }));

  // 2. Drag the bottom panel up: the Layers tab rides with it.
  const bar = await p.evaluate(() => { const r = document.getElementById('bottomResize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 3 }; });
  await p.mouse.move(bar.x, bar.y); await p.mouse.down();
  await p.mouse.move(bar.x, bar.y - 240, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  const after = await geo();
  ok('the Layers tab moves with the strip', after.ltTop < before.ltTop - 50, JSON.stringify({ before: before.ltTop, after: after.ltTop }));
  ok('Info panel still hidden after the drag', await disp('rightPanel') === 'none', await disp('rightPanel'));

  // 3. Evolution mode: the Info panel appears, toggle labeled Info.
  await p.evaluate(() => document.querySelector('#mapModeTabs .mm-tab[data-mode="evolution"]').click());
  await p.waitForTimeout(2200);
  ok('Info panel appears in Evolution mode', await disp('rightPanel') !== 'none', await disp('rightPanel'));
  const infoLabel = await p.evaluate(() => document.querySelector('#rightPanelToggle .gf-label').textContent.trim());
  ok('the toggle is labeled Info', infoLabel === 'Info', infoLabel);

  // 4. The auto-open preference (in Evolution, where the panel can open).
  const pill = () => p.evaluate(() => { const c = document.getElementById('autoOpenAggregate'); return c ? { exists: true, checked: c.checked, flag: window.autoOpenAggregate } : { exists: false }; });
  ok('the auto-open pill exists and defaults on', (await pill()).exists && (await pill()).checked === true, JSON.stringify(await pill()));

  // Find a spot inside a project district that is NOT on a marker (marker clicks are ignored by design).
  const spot = await p.evaluate(() => {
    const l = window.layer_District; let poly = null;
    l.eachLayer(function(x) { if (!poly && x.feature.properties.project_area === 'y') { poly = x.getBounds().getCenter(); } });
    l._map.setView([poly.lat, poly.lng], 9);
    return poly;
  });
  await p.waitForTimeout(1300);
  // A visible point inside a project district that is NOT on a marker (marker clicks are ignored by
  // design). Re-located before each click: dragging the panel resizes the map, so a stale point can fall
  // off-screen or land on a pin.
  const locate = () => p.evaluate(() => {
    const r = document.getElementById('map').getBoundingClientRect();
    const x0 = r.left + 20, x1 = r.right - 20, y0 = r.top + 20, y1 = r.bottom - 20;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let rad = 0; rad <= 220; rad += 20) {
      for (let a = 0; a < 360; a += 30) {
        const x = cx + rad * Math.cos(a * Math.PI / 180), y = cy + rad * Math.sin(a * Math.PI / 180);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const el = document.elementFromPoint(x, y), cls = el && el.className ? el.className.toString() : '';
        if (el && !/pin|marker|cluster|tooltip|control/i.test(cls)) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  });
  const clickSpot = await locate();
  ok('an empty spot inside a district polygon is clickable', !!clickSpot, JSON.stringify(clickSpot));

  const state = () => p.evaluate(() => ({ collapsed: document.getElementById('rightPanel').classList.contains('collapsed'),
                                          scope: (document.getElementById('aggOverview').textContent || '').trim().slice(0, 32) }));
  const scoped = s => /District|Province|Local Level/.test(s);

  // OFF: the click still scopes the charts, the panel stays shut.
  await p.evaluate(() => document.querySelector('#autoOpenAggregate').closest('label.gf-value').click());
  await p.waitForTimeout(250);
  await p.evaluate(() => document.getElementById('rightPanel').classList.add('collapsed'));
  await p.mouse.click(clickSpot.x, clickSpot.y);
  await p.waitForTimeout(1400);
  const off = await state();
  ok('auto-open OFF: clicking scopes the charts', scoped(off.scope), JSON.stringify(off));
  ok('auto-open OFF: the panel stays collapsed', off.collapsed === true, JSON.stringify(off));

  // ON: a fresh polygon click opens it again.
  await p.evaluate(() => document.querySelector('#autoOpenAggregate').closest('label.gf-value').click());
  await p.waitForTimeout(250);
  ok('the pill flips the flag back on', (await pill()).flag === true, JSON.stringify(await pill()));
  // A second click on the SAME polygon toggles the scope OFF (by design), so pan to a DIFFERENT project
  // district first - then the click is a fresh scope and must open the panel again.
  await p.evaluate(() => {
    const l = window.layer_District; const m = l._map; const seen = [];
    l.eachLayer(function(x) { if (x.feature.properties.project_area === 'y') { seen.push(x); } });
    // the one after the currently-viewed district, so the click lands on a different polygon
    const cur = m.getCenter();
    let best = seen[0], bestD = Infinity;
    seen.forEach(function(x) { const c = x.getBounds().getCenter(); const d = m.distance(cur, c); if (d > 1000 && d < bestD) { bestD = d; best = x; } });
    m.setView(best.getBounds().getCenter(), 9);
  });
  await p.waitForTimeout(1400);
  const spot2 = await locate();
  ok('a second district is clickable for the ON case', !!spot2, JSON.stringify(spot2));
  await p.evaluate(() => document.getElementById('rightPanel').classList.add('collapsed'));
  await p.mouse.click(spot2.x, spot2.y);
  await p.waitForTimeout(1400);
  const on = await state();
  ok('auto-open ON: the panel opens again', on.collapsed === false && scoped(on.scope), JSON.stringify(on));

  // 5. Overview mode: a polygon click still scopes the charts, but the panel stays hidden.
  await p.evaluate(() => document.querySelector('#mapModeTabs .mm-tab[data-mode="overview"]').click());
  await p.waitForTimeout(1400);
  ok('Info panel hidden back in overview', await disp('rightPanel') === 'none', await disp('rightPanel'));
  // Pan to yet another project district: re-clicking the same polygon would clear the scope (by design).
  await p.evaluate(() => {
    const l = window.layer_District; const m = l._map; const seen = [];
    l.eachLayer(function(x) { if (x.feature.properties.project_area === 'y') { seen.push(x); } });
    const cur = m.getCenter();
    let best = seen[0], bestD = Infinity;
    seen.forEach(function(x) { const c = x.getBounds().getCenter(); const d = m.distance(cur, c); if (d > 1000 && d < bestD) { bestD = d; best = x; } });
    m.setView(best.getBounds().getCenter(), 9);
  });
  await p.waitForTimeout(1400);
  const spot3 = await locate();
  await p.mouse.click(spot3.x, spot3.y);
  await p.waitForTimeout(1400);
  const ov = await state();
  ok('overview click scopes the charts', scoped(ov.scope), JSON.stringify(ov));
  ok('overview click cannot open the hidden panel', await disp('rightPanel') === 'none', await disp('rightPanel'));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
