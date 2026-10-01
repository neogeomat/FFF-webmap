// Display names are tidied at render time (cleanOrgName): drop the redundant bracketed tail, keep anything
// the bracket genuinely adds. Markers carry no permanent tooltips (user request), so names are read off
// the Sankey table with an Organization column - SANKEY_DIMS.Organization returns pr.Name_of_Organization,
// the same cleaned string the tooltips used to show. Full 36-org coverage in one render, no zooming.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(6000);

  // Markers must not render permanent name labels (hover cards still carry the names).
  ok('no permanent marker tooltips', await p.evaluate(() => document.querySelectorAll('.org-tip-name, .leaflet-tooltip').length === 0),
    'tips=' + await p.evaluate(() => document.querySelectorAll('.org-tip-name, .leaflet-tooltip').length));

  // One Organization column: every org gets its own chain row, cells hold the cleaned names.
  await p.evaluate(() => setMapMode('investment'));
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const s = document.querySelector('#sankeyCols select[data-col="4"]');
    s.value = 'Organization'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(3500);
  const labels = await p.evaluate(() => {
    const t = document.getElementById('sankeyTable');
    const head = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
    const ci = head.indexOf('Organization');
    if (ci < 0) return { head, names: [] };
    const names = [...t.querySelectorAll('tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      .filter(tds => tds.length > ci && !/^Total$/.test(tds[0]))
      .map(tds => tds[ci].replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return { head, names: [...new Set(names)] };
  });

  const has = (sub) => labels.names.some(l => l.includes(sub));
  ok('Organization column collected (one name per org)', labels.names.length >= 30, 'names=' + labels.names.length);
  ok('no label still carries the district in brackets', !labels.names.some(l => /\((?:Makawanpur|Makwanpur|Kathmandu|Rupandehi|Dhanusha|Nawalpur)\)$/i.test(l)), labels.names.filter(l => /\([^)]*\)$/.test(l)).join(' | ').slice(0, 160));
  ok('the SHOUTED duplicate is replaced by the richer form', has('Shree Shivashakti Krishi Sahakari, Limited') && !labels.names.some(l => /^SHREE SHIVASHAKTI KRISHI SAHAKARI/.test(l)), '');
  ok('an alias-repeat bracket is dropped (Shivnagar)', has('Shivnagar Samudayik Ban Upabhokta Samuha') && !labels.names.some(l => /Shivnagar[^|]*\(Shiv Nagar CFUG\)/.test(l)), '');
  ok('an alias-repeat bracket is dropped (Shankarnagar)', has('Shankarnagar Samudayek Van Upabhokta Samuha') && !labels.names.some(l => /Shankarnagar[^|]*\(Shankarnagar CFUG\)/.test(l)), '');
  ok('a real acronym bracket survives (NFGF)', has('(National Farmer Group Federation)'), '');
  ok('a real acronym bracket survives (AFFON)', has('(Association of Family Forest Owners Nepal)'), '');
  const shouty = labels.names.filter(l => l.length > 3 && l === l.toUpperCase());
  ok('no label is left shouting in capitals', shouty.length === 0, JSON.stringify(shouty.slice(0, 3)));
  ok('a shouted name was title-cased, not mangled (acronyms keep their caps)', !labels.names.some(l => /^Kemlipur/.test(l)) || labels.names.some(l => /C\.F\.U\.G\./.test(l)), '');
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
