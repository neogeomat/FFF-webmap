// Women-Led Enterprises map mode: third tab, filters to women-led orgs, mode persists across reload.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  let fail = 0;
  const ok = (name, cond, detail) => { if (!cond) fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '   ' + detail : '')); };
  const isTab = mode => p.evaluate(m => { const t = document.querySelector('.mm-tab.active'); return !!t && t.getAttribute('data-mode') === m; }, mode);

  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5000);

  const shown = () => p.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll('.grantee-cluster')).map(c => parseInt(c.textContent.trim(), 10) || 0);
    const pins = document.querySelectorAll('.org-pin-wrap').length;
    const members = sizes.reduce((a, x) => a + x, 0);
    return {
      pins, clusters: sizes.length, members, total: pins + members,
      names: Array.from(document.querySelectorAll('.org-tip-name')).map(n => n.textContent.trim())
    };
  });

  // Expected women-led set, read off the geocsv (the page's single runtime source): 18 orgs carry
  // women_json records, 13 of them have coordinates (WKT) and therefore render. Regenerate with:
  //   python3 -c "import csv;r=list(csv.DictReader(open('Webmap/data/Grantees.combined.geocsv',encoding='utf-8-sig')));print(sorted({x['org_name_geojson'] for x in r if x['women_json'].strip() and x['WKT'].strip()}))"
  const expNames = [
    'Aadhar Ekata  Mahila Samuha',
    'AFFON (Association of Family Forest Owners Nepal)',
    'Jagaran Community Development Center / Madhyabindu Lemon, Fruits and Vegetable Production Farmer Group',
    'NIWF (National Indigenous Women Forum)',
    'Binayi Samudayik Ban Upobhokta Samu (BSBUS)',
    'Sakriya Mahila Krishi Sahakari Sanstha Limited (SMKSSL)',
    'Himawanti Nepal (HN)                      Risheshwor Mahila Allo Kapada Utpadan Udhyog, located in Thaha Municipality-4, Makwanpur district',
    'Ratu Mahila Samuhik Ban U. Samuh (Ratu Mahila CFUG)',
    'KEMLIPUR C.F.U.G. MI.NA.PA.07 (Kemalipur CFUG)',
    'Samudayak Udhami Mahila Krishi Krishak Samuha',
    'Sana Kishan Krishi Sahakari Sastha',
    'Sundardeep Mahila Machhapalan S.S.L',
    'Coffee Sahakari Sangh Ltd.'
  ];
  const exp = { womenOrgs: 18, rendered: 13 };
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  console.log('expected: ' + exp.womenOrgs + ' women-led orgs with records, ' + exp.rendered + ' with geometry');

  const tabs = await p.evaluate(() => Array.from(document.querySelectorAll('.mm-tab')).map(t => [t.getAttribute('data-mode'), t.textContent.trim()]));
  ok('three map-mode tabs', tabs.length === 3, JSON.stringify(tabs));
  ok('third tab = Women-Led Enterprises', /Women-Led Enterprises/.test(tabs[2] ? tabs[2][1] : ''), '');

  const base = await shown();
  ok('overview shows all 36 rendered orgs', base.total === 36, JSON.stringify({ pins: base.pins, clusters: base.clusters, total: base.total }));

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="women"]').click());
  await p.waitForTimeout(2000);
  const w = await shown();
  ok('women mode shows only women-led orgs', w.total === exp.rendered, 'shown=' + w.total + ' expected=' + exp.rendered + ' ' + JSON.stringify({ pins: w.pins, clusters: w.clusters, members: w.members }));
  ok('body class map-mode-women (and not evolution)', await p.evaluate(() => document.body.classList.contains('map-mode-women') && !document.body.classList.contains('map-mode-evolution')), '');
  ok('women tab is the active tab', await isTab('women'), '');
  ok('mode persisted to localStorage', await p.evaluate(() => localStorage.getItem('fff.mapMode') === 'women'), '');
  ok('no new marker style (.womens-pin)', await p.evaluate(() => document.querySelectorAll('.womens-pin').length === 0), '');
  const stray = w.names.filter(n => !expNames.some(e => norm(e) === norm(n)));
  ok('visible tooltip names all women-led', stray.length === 0, JSON.stringify(stray));

  // composition: clearing the commodity pills must hide everything, never resurrect a non-women org
  await p.waitForTimeout(500);
  const before = await shown();
  await p.evaluate(() => document.getElementById('commClear').click());
  await p.waitForTimeout(1500);
  const cleared = await shown();
  ok('clearing commodities hides all (women gate composes)', cleared.total === 0, 'before=' + before.total + ' after=' + cleared.total);
  await p.evaluate(() => document.getElementById('commSelectAll').click());
  await p.waitForTimeout(1500);
  const restored = await shown();
  ok('select-all restores the women-led set', restored.total === exp.rendered, 'after=' + restored.total + ' expected=' + exp.rendered);
  const stray2 = restored.names.filter(n => !expNames.some(e => norm(e) === norm(n)));
  ok('no non-women org resurrected by pill churn', stray2.length === 0, JSON.stringify(stray2));

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 20000 });
  await p.waitForTimeout(5000);
  const r = await shown();
  ok('mode survives a reload', r.total === exp.rendered && await isTab('women'), 'shown=' + r.total + ' expected=' + exp.rendered);

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="overview"]').click());
  await p.waitForTimeout(2000);
  const back = await shown();
  ok('overview restores all 36 orgs', back.total === 36, JSON.stringify({ pins: back.pins, clusters: back.clusters, total: back.total }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));

  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="women"]').click());
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/women_mode.jpg', type: 'jpeg', quality: 78 });
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
