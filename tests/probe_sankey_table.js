// The sankey data as a table beside the diagrams: same chains, same totals as the two charts.
// The app lives in a closure, so the expected totals are read off the charts' own root labels
// ("FFF (36)" / "FFF ($1.06M)") - if the table and the picture disagree, one of them is a lie.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.evaluate(() => setMapMode('investment'));   // the panel (and the table) only exist in this mode
  await p.waitForTimeout(6500);

  const read = () => p.evaluate(() => {
    const t = document.getElementById('sankeyTable');
    const head = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => ({
      tds: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()),
      num: [...tr.querySelectorAll('td.num')].map(td => td.textContent.trim())
    }));
    const body = rows.filter(r => !/^Total$/.test(r.tds[0]));
    const money = (s) => s === '\u2014' ? 0 : Number(s.replace(/[$,]/g, ''));
    const rootOf = (id) => { const el = document.querySelector('#' + id + ' g text'); return el ? el.textContent : ''; };
    // "FFF (36)" -> 36 ; "FFF ($1.06M)" -> 1060000
    const valueOf = (label) => {
      const m = label.match(/\(\$?([\d.]+)([kM]?)/);
      if (!m) { return NaN; }
      return parseFloat(m[1]) * (m[2] === 'M' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
    };
    const orgRoot = rootOf('chartSankey'), amtRoot = rootOf('chartSankeyAmount');
    const tRect = t.getBoundingClientRect();
    const orgRect = document.getElementById('chartSankey').getBoundingClientRect();
    const panelRect = document.getElementById('bottomPanel').getBoundingClientRect();
    return {
      head, body, cols: [...document.querySelectorAll('#sankeyCols select')].map(s => s.value).filter(Boolean),
      total: rows.filter(r => /^Total$/.test(r.tds[0])).map(r => r.num),
      orgRoot, amtRoot, wantOrgs: valueOf(orgRoot), wantUsd: valueOf(amtRoot),
      orgSum: body.reduce((a, r) => a + Number(r.num[0]), 0),
      usdSum: body.reduce((a, r) => a + money(r.num[1]), 0),
      shareSum: body.reduce((a, r) => a + parseFloat(r.num[2]), 0),
      inPanel: document.getElementById('bottomPanel').contains(t),
      rightOfChart: tRect.left >= orgRect.right - 1,
      sameRow: tRect.top < orgRect.bottom && tRect.bottom > orgRect.top,
      visible: tRect.width > 100 && tRect.height > 50
    };
  });

  const r = await read();
  const fits = await p.evaluate(() => { const t = document.getElementById('sankeyTable'); return t.scrollWidth <= t.parentElement.clientWidth + 2; });
  ok('the table fits the panel width (no clipped columns)', fits);
  ok('table sits beside the diagrams (right of the org chart, same row, in the panel)', r.inPanel && r.rightOfChart && r.sameRow, JSON.stringify({ inPanel: r.inPanel, right: r.rightOfChart, row: r.sameRow }));
  ok('it is inside the Investment Map panel only', await p.evaluate(() => getComputedStyle(document.getElementById('bottomPanel')).display === 'flex'));
  ok('table is rendered with rows', r.visible && r.body.length > 1, 'rows=' + r.body.length);
  ok('header = selected columns + Organizations/Amount/Share', JSON.stringify(r.head) === JSON.stringify(r.cols.concat(['Organizations', 'Amount (USD)', 'Share'])), JSON.stringify(r.head));
  ok('one row per distinct chain (no duplicates)', new Set(r.body.map(x => x.tds.slice(0, r.cols.length).join('|'))).size === r.body.length, 'rows=' + r.body.length);
  ok('Organizations column sums to the org chart root', r.orgSum === r.wantOrgs, r.orgSum + ' vs ' + r.orgRoot);
  ok('Amount column sums to the amount chart root', Math.abs(r.usdSum - r.wantUsd) <= r.wantUsd * 0.01, '$' + r.usdSum.toLocaleString('en-US') + ' vs ' + r.amtRoot);
  ok('Share column sums to 100%', Math.abs(r.shareSum - 100) < 0.6, r.shareSum.toFixed(1) + '%');
  const shoutyCells = r.body.map(x => x.tds[r.cols.indexOf('District')]).filter(v => v && v.length > 3 && v === v.toUpperCase());
  ok('district names are title case, not shouting', r.cols.indexOf('District') < 0 || shoutyCells.length === 0, JSON.stringify(shoutyCells.slice(0, 3)));
  ok('the top district reads in title case', r.cols.indexOf('District') < 0 || /^[A-Z][a-z]/.test(r.body[0].tds[r.cols.indexOf('District')]), r.body[0].tds[1]);
  ok('a totals row echoes both columns', r.total.length === 1 && r.total[0][0] === String(r.orgSum) && r.total[0][1] === '$' + r.usdSum.toLocaleString('en-US'), JSON.stringify(r.total));

  // change the first flow column: header + rows follow, the totals do not move
  await p.evaluate(() => { const s = document.querySelector('#sankeyCols select[data-col="1"]'); s.value = 'Grant type'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(1600);
  const r2 = await read();
  ok('changing a column updates the header', r2.head[0] === 'Grant type', JSON.stringify(r2.head));
  ok('changing a column updates the rows', JSON.stringify(r2.body.map(x => x.tds[0])) !== JSON.stringify(r.body.map(x => x.tds[0])), '');
  ok('totals survive a column change', r2.orgSum === r.wantOrgs && Math.abs(r2.usdSum - r.wantUsd) <= r.wantUsd * 0.01, JSON.stringify({ orgs: r2.orgSum, usd: Math.round(r2.usdSum) }));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await p.screenshot({ path: '/tmp/sankey_table.jpg', type: 'jpeg', quality: 85 });
  await b.close();
})();
