// Exterior mask (EXPERIMENT): everything outside the Nepal boundary is greyed out, so only Nepal
// shows in every base mode. The rule that bites: the mask must NOT be white - the #map canvas is
// #ffffff too, so a white mask makes "outside Nepal" and "inside, no base layer" one flat colour.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(4000);

  const m = await p.evaluate(() => {
    const l = window.layer_OutsideMask;
    const el = l && l.getElement();
    const pane = document.querySelector('.leaflet-pane_OutsideMask-pane');
    return {
      exists: !!l, onMap: !!(l && l._map),
      fillColor: l ? l.options.fillColor : null,
      fillOpacity: l ? l.options.fillOpacity : null,
      interactive: l ? l.options.interactive : null,
      paintedFill: el ? getComputedStyle(el).fill : null,
      hasInteractiveClass: el ? el.classList.contains('leaflet-interactive') : null,
      paneZ: pane ? getComputedStyle(pane).zIndex : null,
      rings: l ? (l.getLatLngs() || []).length : null,   // world ring + Nepal holes
      canvasBg: getComputedStyle(document.getElementById('map')).backgroundColor,
    };
  });

  ok('the exterior mask exists and is on the map', m.exists && m.onMap, JSON.stringify({ exists: m.exists, onMap: m.onMap }));
  ok('it is NOT the same colour as the #map canvas', m.paintedFill !== m.canvasBg,
     `mask=${m.paintedFill} canvas=${m.canvasBg}`);
  ok('it is the documented neutral #dee2e6', m.fillColor === '#dee2e6' && m.paintedFill === 'rgb(222, 226, 230)',
     `option=${m.fillColor} painted=${m.paintedFill}`);
  ok('it is opaque (it has to hide tiles, not tint them)', m.fillOpacity === 1, String(m.fillOpacity));
  ok('it stays below every boundary layer', m.paneZ === '300', `pane z=${m.paneZ}`);
  ok('it never intercepts clicks', m.interactive === false && m.hasInteractiveClass === false,
     `interactive=${m.interactive} class=${m.hasInteractiveClass}`);
  ok('it is a world ring with the Nepal rings punched out', m.rings >= 2, `rings=${m.rings}`);

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
