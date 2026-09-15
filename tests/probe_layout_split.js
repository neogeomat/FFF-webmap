// Two-row page layout: map on top, bottom panel a separate resizable block below (legend hidden).
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // the charts refresh from a DIFFERENT script scope through window._sankeyRefresh - a cross-scope slip
  // shows up here as a swallowed console warn, not as a error, so assert on it explicitly.
  const warns = []; p.on('console', m => { if (/sankey redraw failed/.test(m.text())) { warns.push(m.text()); } });
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(6000);
  // The bottom panel is the Investment Map: it only exists in that mode, so open it like a user would.
  await p.evaluate(() => setMapMode('investment'));
  await p.waitForTimeout(1300);

  const geom = () => p.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
    const map = document.getElementById('map'), bp = document.getElementById('bottomPanel');
    const leg = document.getElementById('commodityLegend');
    const m = window.layer_Nepal && window.layer_Nepal._map, nb = window.layer_Nepal && window.layer_Nepal.getBounds();
    return {
      vh: window.innerHeight, map: rect(map), panel: rect(bp),
      panelPct: Math.round(100 * bp.getBoundingClientRect().height / window.innerHeight),
      overlap: Math.round(map.getBoundingClientRect().bottom - bp.getBoundingClientRect().top),
      siblings: map.parentElement === bp.parentElement,
      position: getComputedStyle(bp).position,
      bottomH: getComputedStyle(document.documentElement).getPropertyValue('--bottom-h').trim(),
      legendHidden: !leg || getComputedStyle(leg).display === 'none',
      sankeyMode: document.body.classList.contains('map-mode-investment'),
      nepalFits: !!(m && nb && m.getBounds().contains(nb))
    };
  });
  const barAt = () => p.evaluate(() => { const r = document.getElementById('bottomResize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

  const g0 = await geom();
  ok('legend is hidden', g0.legendHidden);
  ok('Investment map mode is active', g0.sankeyMode === true, '');
  ok('bottom panel is an in-flow block, not an overlay', g0.position === 'static' && g0.siblings);
  ok('bottom panel opens at half the page', Math.abs(g0.panelPct - 50) <= 3, g0.panelPct + '%');
  ok('map and panel do not overlap', g0.overlap <= 0 && g0.map.bottom <= g0.panel.y + 1, JSON.stringify({ mapBottom: g0.map.bottom, panelTop: g0.panel.y }));
  ok('whole Nepal fits the map box', g0.nepalFits);

  // drag the split bar up 140px -> panel taller, map shorter, country still fitted
  const chartPx = () => p.evaluate(() => Math.round(document.getElementById('chartSankey').getBoundingClientRect().height));
  const hBeforeDrag = await chartPx();
  const bar = await barAt();
  await p.mouse.move(bar.x, bar.y); await p.mouse.down();
  await p.mouse.move(bar.x, bar.y - 140, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  const g1 = await geom();
  ok('dragging the bar resizes both boxes', g1.panel.h > g0.panel.h + 100 && g1.map.h < g0.map.h - 100, JSON.stringify({ before: g0.panel.h, after: g1.panel.h, mapBefore: g0.map.h, mapAfter: g1.map.h }));
  ok('drag writes --bottom-h', /^\d+px$/.test(g1.bottomH), g1.bottomH);
  ok('still no overlap after the drag', Math.abs(g1.overlap) <= 1 && g1.map.bottom <= g1.panel.y + 1);
  ok('Nepal re-fits the smaller map box', g1.nepalFits && g1.panelPct >= 55, JSON.stringify({ pct: g1.panelPct, fits: g1.nepalFits }));
  // CI's font metrics differ by a few px, so the margin is loose - what this really pins is "the drag
  // changed the chart height at all" (a broken cross-scope redraw leaves it byte-identical).
  ok('the drag itself re-renders the charts taller', (await chartPx()) > hBeforeDrag + 25, JSON.stringify({ before: hBeforeDrag, after: await chartPx() }));
  ok('no cross-scope sankey redraw warning', warns.length === 0, warns.slice(0, 2).join(' | '));

  // collapse toggle shrinks the panel to its header and gives the space back to the map
  await p.evaluate(() => togglePanel('bottomPanel'));
  await p.waitForTimeout(900);
  const g2 = await geom();
  ok('collapsing the panel shrinks it to its header', g2.panel.h <= 40 && g2.panel.y < g2.vh, JSON.stringify(g2.panel));
  ok('the map takes the freed space back', g2.map.h > g1.map.h + 100 && g2.overlap <= 1, JSON.stringify({ map: g2.map.h, was: g1.map.h }));
  await p.evaluate(() => togglePanel('bottomPanel'));
  await p.waitForTimeout(900);
  const g3 = await geom();
  ok('expanding restores the dragged height', Math.abs(g3.panel.h - g1.panel.h) <= 40, JSON.stringify({ now: g3.panel.h, dragged: g1.panel.h }));

  // the flow charts track the strip height (>= the 460px crossing sweet spot, taller after a drag)
  const chartH = () => p.evaluate(() => Math.round(document.getElementById('chartSankey').getBoundingClientRect().height));
  const baseChartH = await chartH();
  ok('charts are at least the 460px crossing sweet spot', baseChartH >= 460, 'h=' + baseChartH);
  await p.evaluate(() => { document.documentElement.style.setProperty('--bottom-h', '800px'); fitNepal(); });
  await p.evaluate(() => { const s = document.querySelectorAll('#sankeyCols select')[0]; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(900);
  ok('a taller strip draws taller charts', (await chartH()) > baseChartH + 20, JSON.stringify({ before: baseChartH, after: await chartH() }));
  await p.evaluate(() => { document.documentElement.style.removeProperty('--bottom-h'); fitNepal(); });
  await p.waitForTimeout(400);

  // dropdown option order: the three location dimensions sit at the bottom (user request)
  const order = await p.evaluate(() => [...document.querySelectorAll('#sankeyCols select')[0].options].map(o => o.textContent.trim()));
  ok('Province/District/Palika are the last three options', JSON.stringify(order.slice(-3)) === JSON.stringify(['Province', 'District', 'Palika']), JSON.stringify(order));
  const defaults = await p.evaluate(() => [...document.querySelectorAll('#sankeyCols select')].map(s => s.value));
  ok('default chain unchanged', JSON.stringify(defaults) === JSON.stringify(['Province', 'District', 'Palika', '', '', '']), JSON.stringify(defaults));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await p.screenshot({ path: '/tmp/layout_split.jpg', type: 'jpeg', quality: 85 });
  await b.close();
})();
