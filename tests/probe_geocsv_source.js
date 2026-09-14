// Single-source probe: the page must build itself from data/Grantees.combined.geocsv alone.
// Grantees.geojson + grantees_attributes.json are retired (deleted) - a missing request is the only
// way to prove the dependency is really gone (a leftover fetch on an error path, a stale builder
// reference or a half-reverted edit all look fine in a diff; the browser is the witness).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [], reqs = [];
  p.on('request', r => { try { reqs.push(new URL(r.url()).pathname); } catch (e) {} });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/polyfill|ERR_NAME_NOT_RESOLVED|ERR_ABORTED|Failed to load resource/i.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 100)); });
  let fail = 0;
  const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); };
  const count = re => reqs.filter(u => re.test(u)).length;

  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5000);

  ok('never requests the retired Grantees.geojson', count(/Grantees\.geojson$/) === 0, 'hits=' + count(/Grantees\.geojson$/));
  ok('never requests the retired grantees_attributes.json', count(/grantees_attributes\.json$/) === 0, 'hits=' + count(/grantees_attributes\.json$/));
  ok('fetches the geocsv exactly once', count(/Grantees\.combined\.geocsv$/) === 1, 'hits=' + count(/Grantees\.combined\.geocsv$/));
  ok('no longer loads the leaflet-ajax plugin', count(/leaflet-ajax/) === 0, 'hits=' + count(/leaflet-ajax/));

  const shown = await p.evaluate(() => {
    const members = Array.from(document.querySelectorAll('.grantee-cluster')).reduce((a, c) => a + (parseInt(c.textContent.trim(), 10) || 0), 0);
    const pins = document.querySelectorAll('.org-pin-wrap').length;
    return { pins, members, total: pins + members };
  });
  ok('36 grantees render from the geocsv', shown.total === 36, JSON.stringify(shown));

  const money = await p.evaluate(() => {
    const c = window.chartInvestment;
    if (!c) return null;
    const sum = c.data.datasets.reduce((a, d) => a + d.data.reduce((x, y) => x + y, 0), 0);
    const pie = window.chartPie ? window.chartPie.data.datasets[0].data.reduce((a, x) => a + x, 0) : 0;
    return { total: Math.round(sum), pieOrgs: pie };
  });
  ok('money chart totals 2,288,256 USD', money && Math.abs(money.total - 2288256) <= 2, JSON.stringify(money));
  ok('LoA/DBG pie covers all 36 orgs', money && money.pieOrgs === 36, JSON.stringify(money && money.pieOrgs));

  // Evolution table is fed by the same parse (attrsFromCsv) instead of grantees_attributes.json.
  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="evolution"]').click());
  await p.waitForTimeout(2500);
  const evo = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#evoTable tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim()));
    const amts = rows.map(r => r[r.length - 1]).map(s => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0);
    return { rows: rows.length, sum: Math.round(amts.reduce((a, x) => a + x, 0)), first: rows[0] };
  });
  ok('evolution amounts sum to the same 2,288,256 USD', Math.abs(evo.sum - 2288256) <= 10, JSON.stringify({ rows: evo.rows, sum: evo.sum }));
  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="women"]').click());
  await p.waitForTimeout(2000);
  const women = await p.evaluate(() => {
    const members = Array.from(document.querySelectorAll('.grantee-cluster')).reduce((a, c) => a + (parseInt(c.textContent.trim(), 10) || 0), 0);
    return document.querySelectorAll('.org-pin-wrap').length + members;
  });
  ok('women mode still finds 13 women-led orgs', women === 13, 'shown=' + women);
  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="overview"]').click());
  await p.waitForTimeout(1500);

  // Card contents: records (women/restoration) arrive through the *_json columns of the same file.
  // real Playwright hovers - the popup is driven by Leaflet's mouseover, synthetic events don't
  // always reach it (the same reason the docs say to click via page.evaluate, not dispatch).
  const cards = [];
  for (const pin of (await p.$$('.org-pin-wrap')).slice(0, 5)) {
    await pin.hover();
    await p.waitForTimeout(350);
    cards.push(await p.evaluate(() => {
      const pop = document.querySelector('.info-hover-popup');
      return pop && getComputedStyle(pop).display !== 'none' ? pop.innerText.replace(/\s+/g, ' ') : '';
    }));
    await p.mouse.move(700, 860);
    await p.waitForTimeout(150);
  }
  const nonEmpty = cards.filter(t => t.length > 40);
  // Only the first hover after moving the pointer away shows the card - verified identical on the
  // pre-geocsv tree (HEAD, served on :6117), so it is a pre-existing quirk of the mouseout grace
  // timer, not a data regression. Assert one full card and its contents.
  ok('a hover card renders with the geocsv records', nonEmpty.length >= 1, 'cards=' + nonEmpty.length + '/' + cards.length);
  ok('cards carry a Restoration row (restoration_json)', nonEmpty.some(t => /Restoration/i.test(t)), '');
  ok('cards carry an Enterprise Classification row', nonEmpty.some(t => /Enterprise Classification/i.test(t)), '');
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
