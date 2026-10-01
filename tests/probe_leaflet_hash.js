// Leaflet-hash deep links: the URL hash tracks zoom/lat/lng, and a load WITH a hash restores
// that view instead of being clobbered by the startup setBounds() fit.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
const BASE = 'http://localhost:6115/';
const HASH_RE = /^#\d+\/-?\d+(\.\d+)?\/-?\d+(\.\d+)?$/;
const num = s => parseFloat(s);

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  const read = () => p.evaluate(() => {
    const m = window.layer_Nepal && window.layer_Nepal._map;
    const c = m && m.getCenter();
    return { hash: location.hash, libLoaded: typeof L.Hash === 'function',
             zoom: m ? m.getZoom() : null, lat: c ? +c.lat.toFixed(4) : null, lng: c ? +c.lng.toFixed(4) : null };
  });
  const load = async url => { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
                              await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
                              await p.waitForTimeout(3500); };

  // 1. Bare load: hash absent -> the startup fit runs, then the plugin records the view.
  await load(BASE);
  const bare = await read();
  ok('L.Hash is defined (leaflet-hash.js loads before js/map.js)', bare.libLoaded, JSON.stringify(bare));
  ok('the startup fit still runs without a hash', bare.zoom <= 8, `zoom=${bare.zoom}`);
  ok('the view is written into the URL hash', HASH_RE.test(bare.hash), bare.hash);
  ok('the hash zoom matches the map zoom', bare.hash && num(bare.hash.slice(1).split('/')[0]) === bare.zoom,
     `${bare.hash} vs zoom=${bare.zoom}`);

  // 2. Moving the map updates the hash.
  const target = { lat: 28.2, lng: 84.0, zoom: 11 };
  await p.evaluate(t => { const m = window.layer_Nepal._map; m.setView([t.lat, t.lng], t.zoom, { animate: false }); }, target);
  await p.waitForTimeout(900);
  const moved = await read();
  const parts = moved.hash.replace('#', '').split('/').map(num);
  ok('panning/zooming rewrites the hash', parts[0] === target.zoom && Math.abs(parts[1] - target.lat) < 0.01 && Math.abs(parts[2] - target.lng) < 0.01,
     `${moved.hash} vs ${JSON.stringify(target)}`);
  ok('hash and map agree after the move', moved.zoom === target.zoom && Math.abs(moved.lat - target.lat) < 0.01,
     JSON.stringify({ moved, target }));

  // 3. Reloading WITH that hash restores it (startup fit must NOT overwrite it).
  const deepLink = BASE + moved.hash;
  await load(deepLink);
  const restored = await read();
  ok('a hashed URL restores zoom/lat/lng instead of the startup fit',
     restored.zoom === target.zoom && Math.abs(restored.lat - target.lat) < 0.01 && Math.abs(restored.lng - target.lng) < 0.01,
     `${deepLink} -> ${JSON.stringify(restored)}`);
  ok('the restored view is still reflected in the hash', HASH_RE.test(restored.hash), restored.hash);

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
