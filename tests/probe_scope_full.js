// Full verification: scoped aggregates (pie/bar/investment/sankey) + PIP precedence + national totals.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/polyfill|ERR_NAME_NOT_RESOLVED|ERR_ABORTED|Failed to load resource/i.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 100)); });
  let fail = 0;
  const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); };

  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5500);

  const st = () => p.evaluate(() => {
    const inv = window.chartInvestment ? { labels: window.chartInvestment.data.labels, loa: window.chartInvestment.data.datasets[0].data, dbg: window.chartInvestment.data.datasets[1].data } : null;
    return {
      overview: ((document.getElementById('aggOverview') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      // The bottom panel's own header label: the sankey updates on a polygon click, so it must name the polygon.
      scopeLabel: ((document.getElementById('sankeyScopeLabel') || {}).textContent || '').trim(),
      pie: window.chartPie ? { labels: window.chartPie.data.labels, data: window.chartPie.data.datasets[0].data } : null,
      bar: window.chartBar ? { labels: window.chartBar.data.labels, data: window.chartBar.data.datasets[0].data } : null,
      inv: inv,
      sankey: { rects: document.querySelectorAll('#chartSankey rect').length, links: document.querySelectorAll('#chartSankey path').length, labels: Array.from(document.querySelectorAll('#chartSankey text')).map(t => t.textContent),
        // grouped by column so a check can target one stage (0 FFF, 1 Province, 2 District, 3 Palika)
        cols: (() => { const t = Array.from(document.querySelectorAll('#chartSankey g > text')).map(el => ({ t: el.textContent, x: Math.round(+el.getAttribute('x')) }));
          const xs = [...new Set(t.map(o => o.x))].sort((a, b) => a - b); return xs.map(x => t.filter(o => o.x === x).map(o => o.t)); })() },
      rightCollapsed: document.getElementById('rightPanel').classList.contains('collapsed'),
      // It must sit OUTSIDE the scrolling .panel-content, else the charts scrolling push the area name away.
      scopeBarOutsideScroller: !document.querySelector('#bottomPanel .panel-content').contains(document.getElementById('sankeyScopeLabel'))
    };
  });

  const national = await st();
  ok('national overview', /All Nepal/.test(national.overview) && /36 organizations/.test(national.overview), national.overview);
  ok('national pie = 36 (LoA 26 / DBG 10)', national.pie.data.reduce((a, x) => a + x, 0) === 36, JSON.stringify(national.pie));
  ok('national bar has commodities', national.bar.labels.length >= 8, JSON.stringify(national.bar.labels.slice(0, 3)) + '…');
  ok('sankey rendered (nodes+links)', national.sankey.rects >= 4 && national.sankey.links >= 3, JSON.stringify({ rects: national.sankey.rects, links: national.sankey.links }));
  ok('sankey root is FFF', national.sankey.labels.some(t => /^FFF \(36\)/.test(t)), JSON.stringify(national.sankey.labels.slice(0, 4)));
  // Province names come from point-in-polygon: Province.geojson stores 3 provinces as bare STATE_CODE
  // numbers, so a regression shows up as a node called "2" or "5" instead of Madhesh / Lumbini.
  ok('sankey provinces are names, not state codes', !national.sankey.labels.some(t => /^[1-7] \(\d+\)$/.test(t)), JSON.stringify(national.sankey.labels.filter(t => /^\(?\d/.test(t))));
  ok('every marker resolved to a province (no Unassigned)', !national.sankey.cols[1].some(t => /^Unassigned \(/.test(t)), JSON.stringify(national.sankey.cols[1]));

  // Authoritative totals (previously carried by data/investment_by_enterprise.json, since deleted):
  // the page must reproduce them from the geocsv alone.
  const EXPECT = { 'Integrated': [916886, 268189], 'Forest-based': [336226, 283021], 'Farm-based': [195089, 288846] };
  const cmp = await p.evaluate(() => {
    const c = window.chartInvestment;
    const by = {};
    c.data.labels.forEach((l, i) => { by[l] = { loa: c.data.datasets[0].data[i], dbg: c.data.datasets[1].data[i] }; });
    const total = Object.keys(by).reduce((a, k) => a + by[k].loa + by[k].dbg, 0);
    return { by: by, total: Math.round(total) };
  });
  const invOk = Object.keys(EXPECT).every(k => cmp.by[k] &&
    Math.abs(cmp.by[k].loa - EXPECT[k][0]) <= 2 && Math.abs(cmp.by[k].dbg - EXPECT[k][1]) <= 2);
  ok('investment per class == authoritative totals', invOk, JSON.stringify(cmp.by));
  ok('investment total == 2,288,256 USD', Math.abs(cmp.total - 2288256) <= 2, String(cmp.total));

  // --- district scope: click just off a visible pin, inside its district ---
  const pin = await p.evaluate(() => {
    const el = document.querySelector('.org-pin-wrap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2 + 26, y: r.y + r.height / 2 + 8 };
  });
  await p.mouse.click(pin.x, pin.y);
  await p.waitForTimeout(1500);
  const dis = await st();
  ok('district scope set', /^District — /.test(dis.overview), dis.overview);
  ok('bottom panel names the scoped polygon', dis.overview.indexOf(dis.scopeLabel) === 0, 'label=' + dis.scopeLabel + ' overview=' + dis.overview);
  ok('scope bar is outside the scrolling panel content', dis.scopeBarOutsideScroller === true, '');
  ok('district investment <= national', dis.inv.loa.reduce((a, x) => a + x, 0) <= cmp.total + 1, JSON.stringify(dis.inv.labels));
  ok('district sankey re-rendered', dis.sankey.rects >= 3, JSON.stringify({ rects: dis.sankey.rects, labels: dis.sankey.labels.slice(0, 3) }));
  ok('right panel auto-opened', dis.rightCollapsed === false, '');
  await p.screenshot({ path: '/tmp/scope_district.jpg', type: 'jpeg', quality: 78 });

  // click again = clear
  await p.mouse.click(pin.x, pin.y);
  await p.waitForTimeout(1200);
  const cleared = await st();
  ok('click again clears to national', /All Nepal/.test(cleared.overview) && cleared.pie.data.reduce((a, x) => a + x, 0) === 36, cleared.overview);
  ok('bottom panel label resets to national', /^All Nepal/.test(cleared.scopeLabel), cleared.scopeLabel);

  // --- province scope: turn the District pill off, click the same point ---
  await p.evaluate(() => {
    const cb = Array.from(document.querySelectorAll('.gf-boundary')).find(c => c.dataset.layer === 'layer_District');
    if (cb && cb.checked) cb.closest('label.gf-value').click();
  });
  await p.waitForTimeout(800);
  await p.mouse.click(pin.x, pin.y);
  await p.waitForTimeout(1400);
  const prov = await st();
  ok('province scope when district layer off', /^Province — /.test(prov.overview) && !/^\D*— \d+ /.test(prov.overview), prov.overview);

  // --- local level scope: turn District off, Local Level on, click inside a palika ---
  await p.evaluate(() => {
    const cb = Array.from(document.querySelectorAll('.gf-boundary')).find(c => c.dataset.layer === 'layer_LocalLevel');
    if (cb && !cb.checked) cb.closest('label.gf-value').click();
  });
  await p.waitForTimeout(1400);
  let palikaHit = null, palikaBox = null;
  // Zoom to one palika first: the two-row layout fits ALL of Nepal in the (now smaller) map box, so a
  // palika is a few pixels wide at the national view and a click cannot land inside its rings.
  await p.evaluate(() => {
    const map = window.layer_LocalLevel._map;
    let first = null;
    window.layer_LocalLevel.eachLayer(l => { if (!first) first = l; });
    if (first && map) { map.fitBounds(first.getBounds(), { maxZoom: 12 }); }
  });
  await p.waitForTimeout(1800);
  // then pick a palika whose centre is clear of the panels (left 300px, right panel ~1050+, bottom panel)
  const palikaInfo = await p.evaluate(() => {
    const mapBox = document.getElementById('map').getBoundingClientRect();
    const paths = document.querySelectorAll('.leaflet-pane_LocalLevel-pane path');
    let best = null;
    for (const el of paths) {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const clear = cx > 320 && cx < 900 && cy > 150 && cy < mapBox.bottom - 40 && r.width > 8 && r.height > 8;
      if (clear && (!best || r.width * r.height > best.w * best.h)) { best = { x: r.x, y: r.y, w: r.width, h: r.height }; }
    }
    return best;
  });
  palikaBox = palikaInfo;
  if (palikaInfo) {
    outer:
    for (let fx = 0.25; fx <= 0.75; fx += 0.25) {
      for (let fy = 0.25; fy <= 0.75; fy += 0.25) {
        await p.mouse.click(palikaInfo.x + palikaInfo.w * fx, palikaInfo.y + palikaInfo.h * fy);
        await p.waitForTimeout(900);
        const s = await st();
        if (/^Local Level — /.test(s.overview)) { palikaHit = s.overview; break outer; }
      }
    }
  }
  ok('local level scope reachable', !!palikaHit, palikaHit || ('no palika hit; box=' + JSON.stringify(palikaBox)));
  const pal = await st();
  ok('bottom panel follows the palika scope', pal.overview.indexOf(pal.scopeLabel) === 0, 'label=' + pal.scopeLabel + ' overview=' + pal.overview);

  await p.screenshot({ path: '/tmp/scope_palika.jpg', type: 'jpeg', quality: 78 });
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
