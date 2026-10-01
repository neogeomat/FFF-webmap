// Forest overlay (EXPERIMENT) fades with zoom: opacity 1 at z8, 0 at z13, linear between,
// clamped outside that range. Asserted on the live layer's opacity (options + the <img> style),
// because the user reports the NEXT violation of a rule that ships without an assertion.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.001;
const ramp = z => Math.min(1, Math.max(0, (13 - z) / 5));

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(4000);

  const read = () => p.evaluate(() => {
    const l = window.layer_Forest, el = l && l.getElement();
    return { exists: !!l, onMap: !!(l && l._map), zoom: l && l._map ? l._map.getZoom() : null,
             opts: l ? l.options.opacity : null,
             css: el ? parseFloat(el.style.opacity) : null };
  });

  const start = await read();
  ok('the forest overlay exists and is on the map', start.exists && start.onMap, JSON.stringify(start));

  const at = async z => {
    await p.evaluate(zz => { const m = window.layer_Forest._map; m.setView(m.getCenter(), zz, { animate: false }); }, z);
    await p.waitForTimeout(500);
    return read();
  };

  const z8 = await at(8), z10 = await at(10), z13 = await at(13);
  ok('opacity 1 at zoom 8', near(z8.opts, 1), `zoom=${z8.zoom} opacity=${z8.opts}`);
  ok('opacity 0 at zoom 13', near(z13.opts, 0), `zoom=${z13.zoom} opacity=${z13.opts}`);
  ok('the painted <img> follows the ramp', z8.css === z8.opts && z13.css === z13.opts,
     JSON.stringify({ z8: [z8.opts, z8.css], z13: [z13.opts, z13.css] }));

  const z9 = await at(9), z11 = await at(11), z12 = await at(12);
  ok('intermediate levels ramp gradually', z9.opts > z10.opts && z10.opts > z11.opts && z11.opts > z12.opts && z12.opts > z13.opts,
     `z9=${z9.opts} z10=${z10.opts} z11=${z11.opts} z12=${z12.opts} z13=${z13.opts}`);
  ok('the ramp matches (13 - zoom) / 5 at every step',
     [z8, z9, z10, z11, z12, z13].every(r => near(r.opts, ramp(r.zoom))),
     JSON.stringify([z8, z9, z10, z11, z12, z13].map(r => [r.zoom, r.opts])));

  const wide = await at(6), deep = await at(18);
  ok('clamped to 1 when zoomed out past 8', near(wide.opts, 1) && wide.opts === ramp(wide.zoom),
     `zoom=${wide.zoom} opacity=${wide.opts}`);
  ok('stays 0 when zoomed in past 13', near(deep.opts, 0) && deep.opts === ramp(deep.zoom),
     `zoom=${deep.zoom} opacity=${deep.opts}`);

  // Zooming out must bring it back: a one-way check passes on a handler that only ever fades out.
  const back = await at(9);
  ok('zooming back out restores the opacity', near(back.opts, ramp(back.zoom)) && back.opts > 0.5,
     `zoom=${back.zoom} opacity=${back.opts}`);

  // Two toggles drive the same layer: the Layers-panel pill and the Leaflet layer switcher.
  const pill = await p.evaluate(() => {
    const cb = document.querySelector('.gf-boundary[data-layer="layer_Forest"]');
    return cb ? { exists: true, checked: cb.checked, text: cb.closest('label.gf-value').textContent.trim() } : { exists: false };
  });
  ok('the Layers panel has a Forest cover pill, on by default', pill.exists && pill.checked, JSON.stringify(pill));

  const onMap = () => p.evaluate(() => !!(window.layer_Forest && window.layer_Forest._map));
  const clickPill = () => p.evaluate(() => document.querySelector('.gf-boundary[data-layer="layer_Forest"]').closest('label.gf-value').click());
  await clickPill();
  await p.waitForTimeout(500);
  ok('the pill switches the forest layer off', (await onMap()) === false);
  await clickPill();
  await p.waitForTimeout(500);
  ok('and back on', (await onMap()) === true);

  const sw = await p.evaluate(() => {
    const boxes = Array.prototype.slice.call(document.querySelectorAll('.leaflet-control-layers-overlays label'));
    const box = boxes.filter(b => /forest/i.test(b.textContent))[0];
    return { overlays: boxes.length, found: !!box, checked: box ? box.querySelector('input').checked : null,
             text: box ? box.textContent.trim() : null };
  });
  ok('the Leaflet layer switcher lists the forest overlay', sw.found && sw.checked === true, JSON.stringify(sw));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
