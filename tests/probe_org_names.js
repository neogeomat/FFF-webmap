// Display names are tidied at render time (cleanOrgName): drop the redundant bracketed tail, keep anything
// the bracket genuinely adds. Reads the tooltips off every marker in the cluster group, so no zooming.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(6000);

  const labels = await p.evaluate(() => {
    const map = window.map && window.map.getContainer ? window.map : null;
    return new Promise(resolve => {
      const found = [];
      const walk = (l) => { if (l && l.getTooltip) { const t = l.getTooltip(); if (t) { found.push(String(t.getContent())); } } };
      const scan = (grp) => { if (grp && grp.eachLayer) { grp.eachLayer(l => walk(l)); } };
      // the marker-cluster group is the only map layer that owns 30+ tooltip markers
      const scanMap = (m) => { m.eachLayer(l => { if (l.eachLayer) { const before = found.length; scan(l); if (found.length - before > 20) { return; } } }); };
      scanMap(window.layer_District._map);
      resolve(found.map(s => s.replace(/<[^>]*>/g, '').trim()));
    });
  });

  const has = (sub) => labels.some(l => l.includes(sub));
  ok('every marker label is readable', labels.length >= 30, 'labels=' + labels.length);
  ok('no label still carries the district in brackets', !labels.some(l => /\((?:Makawanpur|Makwanpur|Kathmandu|Rupandehi|Dhanusha|Nawalpur)\)$/i.test(l)), labels.filter(l => /\([^)]*\)$/.test(l)).join(' | ').slice(0, 160));
  ok('the SHOUTED duplicate is replaced by the richer form', has('Shree Shivashakti Krishi Sahakari, Limited') && !labels.some(l => /^SHREE SHIVASHAKTI KRISHI SAHAKARI/.test(l)), '');
  ok('an alias-repeat bracket is dropped (Shivnagar)', has('Shivnagar Samudayik Ban Upabhokta Samuha') && !labels.some(l => /Shivnagar[^|]*\(Shiv Nagar CFUG\)/.test(l)), '');
  ok('an alias-repeat bracket is dropped (Shankarnagar)', has('Shankarnagar Samudayek Van Upabhokta Samuha') && !labels.some(l => /Shankarnagar[^|]*\(Shankarnagar CFUG\)/.test(l)), '');
  ok('a real acronym bracket survives (NFGF)', has('(National Farmer Group Federation)'), '');
  ok('a real acronym bracket survives (AFFON)', has('(Association of Family Forest Owners Nepal)'), '');
  const shouty = labels.filter(l => l.length > 3 && l === l.toUpperCase());
  ok('no label is left shouting in capitals', shouty.length === 0, JSON.stringify(shouty.slice(0, 3)));
  ok('a shouted name was title-cased, not mangled (acronyms keep their caps)', !labels.some(l => /^Kemlipur/.test(l)) || labels.some(l => /C\.F\.U\.G\./.test(l)), '');
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
