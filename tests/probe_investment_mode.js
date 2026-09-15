// "Investment map" mode: the bottom panel is the Investment Map and only exists in that mode.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const warns = []; p.on('console', m => { if (/sankey redraw failed/.test(m.text())) { warns.push(m.text()); } });
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(6000);
  await p.evaluate(() => setMapMode('overview'));   // start from a known mode
  await p.waitForTimeout(700);

  const st = () => p.evaluate(() => {
    const bp = document.getElementById('bottomPanel');
    const map = document.getElementById('map');
    const r = bp.getBoundingClientRect(), mr = map.getBoundingClientRect();
    const m = window.layer_Nepal && window.layer_Nepal._map, nb = window.layer_Nepal && window.layer_Nepal.getBounds();
    return {
      mode: (document.body.className.match(/map-mode-\w+/) || [''])[0],
      modeClass: document.body.classList.contains('map-mode-investment'),
      display: getComputedStyle(bp).display,
      hidden: bp.offsetParent === null,
      panelH: Math.round(r.height), panelPct: Math.round(100 * r.height / window.innerHeight),
      mapH: Math.round(mr.height), overlap: Math.round(mr.bottom - r.top),
      header: (bp.querySelector('.panel-header') || {}).textContent,
      sankey: document.querySelectorAll('#chartSankey rect').length,
      nepalFits: !!(m && nb && m.getBounds().contains(nb))
    };
  });
  const tab = (mode) => p.evaluate(m => { document.querySelector('.mm-tab[data-mode="' + m + '"]').click(); }, mode);

  const tabs = await p.evaluate(() => [...document.querySelectorAll('.mm-tab')].map(t => ({ mode: t.getAttribute('data-mode'), label: t.textContent.trim() })));
  ok('an "Investment map" mode tab exists', tabs.some(t => t.mode === 'investment' && /^Investment map$/.test(t.label)), JSON.stringify(tabs.map(t => t.mode)));

  const overview = await st();
  ok('panel is fully hidden outside Investment map mode', overview.display === 'none' && overview.hidden, JSON.stringify({ display: overview.display, hidden: overview.hidden }));
  ok('the map takes the whole height when the panel is hidden', overview.mapH >= 900, 'mapH=' + overview.mapH);

  await tab('investment'); await p.waitForTimeout(1200);
  const inv = await st();
  ok('Investment map activates the mode class', inv.modeClass && inv.mode === 'map-mode-investment', inv.mode);
  ok('the panel expands (visible, ~half the page)', inv.display === 'flex' && !inv.hidden && inv.panelPct >= 45 && inv.panelPct <= 60, JSON.stringify({ pct: inv.panelPct, display: inv.display }));
  ok('the panel header is renamed Investment Map', /^Investment Map$/.test(inv.header || ''), inv.header);
  ok('the two sankeys are drawn', inv.sankey > 5, 'rects=' + inv.sankey);
  ok('map and panel do not overlap in this mode', inv.overlap <= 1, JSON.stringify({ overlap: inv.overlap, mapH: inv.mapH }));
  ok('Nepal still fits the reduced map', inv.nepalFits);

  await tab('women'); await p.waitForTimeout(900);
  const women = await st();
  ok('women mode hides the panel again', women.display === 'none' && women.mapH >= 900, JSON.stringify({ display: women.display, mapH: women.mapH }));

  await tab('investment'); await p.waitForTimeout(900);
  ok('coming back re-expands it', (await st()).display === 'flex');

  await tab('overview'); await p.waitForTimeout(900);
  const back = await st();
  ok('returning to Map View hides it and frees the map', back.display === 'none' && back.mapH >= 900, JSON.stringify({ mapH: back.mapH }));

  ok('entering the mode redraws without a cross-scope warning', warns.length === 0, warns.slice(0, 2).join(' | '));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await tab('investment'); await p.waitForTimeout(1200);
  await p.screenshot({ path: '/tmp/investment_mode.jpg', type: 'jpeg', quality: 85 });
  await b.close();
})();
