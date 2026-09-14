// Sankey province/palika values come from point-in-polygon (not the geocsv columns):
//  - Province.geojson stores 3 provinces as bare STATE_CODE numbers, so they must be name-mapped.
//  - projectLocalLevels.geojson gives the palika without a ward suffix, so one palika stays one node.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  let fail = 0;
  const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); };
  const labels = () => p.evaluate(() => [...document.querySelectorAll('#chartSankey text')].map(t => t.textContent.trim()));
  const overview = () => p.evaluate(() => ((document.getElementById('aggOverview') || {}).innerText || '').replace(/\s+/g, ' ').trim());

  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5500);

  // Two sankeys: amount (USD) above organizations, both in the bottom panel.
  const two = await p.evaluate(() => {
    const amt = document.getElementById('chartSankeyAmount');
    const org = document.getElementById('chartSankey');
    return {
      both: !!amt && !!org,
      amountFirst: amt && org ? amt.getBoundingClientRect().x < org.getBoundingClientRect().x : false,   // side by side
      sameRow: amt && org ? Math.abs(amt.getBoundingClientRect().y - org.getBoundingClientRect().y) < 4 : false,
      inBottom: !!document.getElementById('bottomPanel').contains(amt),
      amountLabels: amt ? [...amt.querySelectorAll('text')].slice(0, 2).map(t => t.textContent.trim()) : []
    };
  });
  ok('amount sankey sits left of the org sankey, same row, in the bottom panel', two.both && two.amountFirst && two.sameRow && two.inBottom, JSON.stringify(two));
  ok('amount sankey is in USD', /^FFF \(\$/.test(two.amountLabels[0] || ''), JSON.stringify(two.amountLabels));

  // Hovering a cluster is popup-only: it must not rewrite the bottom panel (that is the CLICK target).
  const hover = await p.evaluate(() => {
    const c = document.querySelector('.grantee-cluster');
    if (!c) return null;
    const before = document.getElementById('aggregate').innerHTML;
    c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return before;
  });
  await p.waitForTimeout(700);
  ok('cluster hover leaves the bottom panel alone',
     hover === null || (await p.evaluate(b => document.getElementById('aggregate').innerHTML === b, hover)), '');

  const nat = await labels();
  ok('national sankey renders', nat.length >= 8, JSON.stringify(nat.slice(0, 3)));
  ok('no bare state codes as provinces', !nat.some(t => /^[1-7] \(\d+\)$/.test(t)), JSON.stringify(nat.filter(t => /^\d/.test(t))));
  ok('no Unassigned province', !nat.some(t => /^Unassigned \(/.test(t)), '');
  ok('province names present (Bagmati/Gandaki/Lumbini/Madhesh)', ['Bagmati', 'Gandaki'].every(n => nat.some(t => t.startsWith(n + ' ('))), JSON.stringify(nat.slice(0, 4)));

  // Zoom to Kabhrepalanchok and click its polygon. The grantee LIST is gone from the UI, so drive the map
  // through its own Leaflet instance (window.layer_District._map) instead of a list row.
  const found = await p.evaluate(() => {
    let hit = null;
    window.layer_District.eachLayer(l => { if (/KABHREPALANCHOK/i.test((l.feature.properties || {}).DISTRICT || '')) hit = l; });
    if (!hit) return null;
    const map = window.layer_District._map, c = hit.getBounds().getCenter();
    map.setView(c, 11);
    return { lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3) };
  });
  ok('Kabhrepalanchok polygon found and zoomed to', !!found, JSON.stringify(found));
  await p.waitForTimeout(1600);
  await p.mouse.click(700, 300);   // map centre-ish: clear of the right (340px) and bottom (350px) panels
  await p.waitForTimeout(1800);

  const ov = await overview();
  ok('district scope is KABHREPALANCHOK', /District — KABHREPALANCHOK/.test(ov), ov);
  const dis = await labels();
  ok('province node from pip', dis.some(t => /^Bagmati \(2\)$/.test(t)), JSON.stringify(dis));
  ok('district node from pip', dis.some(t => /^KABHREPALANCHOK \(2\)$/.test(t)), '');
  // Both orgs sit in different wards of the same palika: with pip they must share ONE node.
  const palika = dis.filter(t => /^Panauti \(\d+\)$/.test(t));
  ok('wards merged into one palika node', palika.length === 1 && /\(2\)/.test(palika[0]), JSON.stringify(dis.filter(t => /Panauti/i.test(t))));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(fail ? 'FAILURES: ' + fail : 'ALL PASS');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
