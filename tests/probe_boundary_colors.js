// Boundary layer colours must be mutually distinct - a layer that shares a colour with the one
// underneath it is invisible (reported twice: green Chure on the green project-area districts,
// and again for the district fill). Reads the RENDERED stroke/fill off the SVG, not the options.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
const SAME = (a, b) => a && b && a === b;
const rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(4000);
  // District + Local Level start OFF (user rule): enable both so every layer paints.
  for (const l of ['layer_District', 'layer_LocalLevel']) {
    await p.evaluate(sel => { const cb = document.querySelector(`.gf-boundary[data-layer="${sel}"]`);
                              if (cb && !cb.checked) cb.closest('label.gf-value').click(); }, l);
  }
  await p.waitForTimeout(1200);

  const seen = await p.evaluate(() => {
    const out = {};
    ['District', 'LocalLevel', 'Province', 'Chure', 'Nepal'].forEach(function(name) {
      const pane = document.querySelector('.leaflet-pane_' + name + '-pane');
      const paths = pane ? Array.prototype.slice.call(pane.querySelectorAll('path')) : [];
      const strokes = {}, fills = {};
      paths.forEach(function(el) {
        const s = getComputedStyle(el).stroke, f = getComputedStyle(el).fill;
        if (s && s !== 'none') strokes[s] = (strokes[s] || 0) + 1;
        if (f && f !== 'none') fills[f] = (fills[f] || 0) + 1;
      });
      out[name] = { paths: paths.length,
                    strokes: Object.keys(strokes).sort((a, c) => strokes[c] - strokes[a]),
                    fills: Object.keys(fills).sort((a, c) => fills[c] - fills[a]),
                    fillOpacity: paths[0] ? parseFloat(getComputedStyle(paths[0])['fill-opacity']) : null };
    });
    return out;
  });

  Object.entries(seen).forEach(([n, v]) => ok(`${n} is on the map and painted`, v.paths > 0, JSON.stringify(v).slice(0, 150)));

  // The reported bug: whichever layer keeps the green, the one underneath it must not share it.
  const districtColors = seen.District.fills.concat(seen.District.strokes);
  ok('the project-area district fill is not green',
     !districtColors.some(c => c === rgb('#27ae60') || c === rgb('#1e8449')),
     JSON.stringify(seen.District));
  ok('the Chure green does not collide with any district colour',
     !districtColors.includes(seen.Chure.strokes[0]),
     `${seen.Chure.strokes[0]} vs ${JSON.stringify(districtColors)}`);
  ok('Chure is hatched, not a flat fill', /url\(/.test(seen.Chure.fills[0] || ''),
     JSON.stringify(seen.Chure.fills));
  const pat = await p.evaluate(() => { const el = document.querySelector('#chureHatch');
                                       return el ? el.tagName + ':' + el.getAttribute('patternUnits') : null; });
  ok('the #chureHatch SVG pattern is defined for the Chure fill to resolve',
     pat === 'pattern:userSpaceOnUse', String(pat));

  // One stroke colour per layer, and no two layers sharing it.
  const missing = Object.entries(seen).filter(([, v]) => v.strokes.length === 0).map(([n]) => n);
  ok('every boundary layer has a stroke colour', missing.length === 0, JSON.stringify(missing));

  const primary = {};
  Object.entries(seen).forEach(([n, v]) => { primary[n] = v.strokes[0]; });
  const dupes = [];
  const names = Object.keys(primary);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (SAME(primary[names[i]], primary[names[j]])) dupes.push(`${names[i]}=${names[j]} (${primary[names[i]]})`);
    }
  }
  ok('no two boundary layers share a stroke colour', dupes.length === 0,
     `${JSON.stringify(primary)} dupes=${JSON.stringify(dupes)}`);

  // The hatch must also carry over the forest overlay, which is a solid rgb(34,139,34) fill.
  const contrast = await p.evaluate(() => {
    const hex = s => [1, 3, 5].map(i => parseInt(s.substr(i, 2), 16));
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                       return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0] + 0.05) / (l[1] + 0.05); };
    const hatch = hex(document.querySelector('#chureHatch line').getAttribute('stroke'));
    // live-sample the forest overlay's own image, so a regenerated PNG re-measures
    const img = window.layer_Forest.getElement();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let forest = null;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) { forest = [d[i], d[i + 1], d[i + 2]]; break; } }
    return { hatch, forest, vsForest: forest ? ratio(hatch, forest) : null, vsWhite: ratio(hatch, [255, 255, 255]) };
  });
  ok('the hatch reads over the forest overlay (>= 2:1)', contrast.vsForest !== null && contrast.vsForest >= 2,
     `hatch=rgb(${contrast.hatch}) forest=rgb(${contrast.forest}) ratio=${contrast.vsForest && contrast.vsForest.toFixed(2)}`);
  ok('the hatch reads over the white canvas (>= 3:1)', contrast.vsWhite >= 3, `ratio=${contrast.vsWhite.toFixed(2)}`);

  // A resolved url(#…) is NOT proof the hatch paints, and "the band is invisible" is the exact
  // complaint that started this. Isolate the Chure pane, screenshot its own box, count the hatch -
  // then repeat with the pattern swapped for a solid fill, so "hatched" is measured, not assumed.
  // Match on the hatch's own dark green: rgb(34,139,34) (forest) and the greys are far outside it.
  const clip = await p.evaluate(() => {
    document.querySelectorAll('.leaflet-pane').forEach(el => {
      if (el.classList.contains('leaflet-map-pane') || el.classList.contains('leaflet-pane_Chure-pane')) return;
      el.style.display = 'none';
    });
    const r = document.querySelector('.leaflet-pane_Chure-pane path').getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    return { x, y, width: Math.max(1, Math.min(Math.ceil(r.width), vw - x)), height: Math.max(1, Math.min(Math.ceil(r.height), vh - y)) };
  });
  const measure = async () => {
    const buf = await p.screenshot({ clip });
    return p.evaluate(async b64 => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let green = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 11) < 50 && Math.abs(d[i + 1] - 61) < 50 && Math.abs(d[i + 2] - 31) < 50) green++;
      }
      return { px: c.width * c.height, green };
    }, buf.toString('base64'));
  };
  const hatch = await measure();
  await p.evaluate(() => { const el = document.querySelector('.leaflet-pane_Chure-pane path');
                           el.dataset.hatchFill = el.getAttribute('fill'); el.setAttribute('fill', '#0b3d1f'); });
  const flat = await measure();
  await p.evaluate(() => { const el = document.querySelector('.leaflet-pane_Chure-pane path');
                           el.setAttribute('fill', el.dataset.hatchFill);
                           document.querySelectorAll('.leaflet-pane').forEach(x => { x.style.display = ''; }); });

  ok('the hatch actually paints (pixels in the hatch colour inside the Chure box)', hatch.green > 0,
     `green=${hatch.green}/${hatch.px}px`);
  ok('it is a hatch, not a flat fill (a solid fill would cover much more)',
     hatch.green < flat.green * 0.6, `hatch=${hatch.green}px vs flat=${flat.green}px`);

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
