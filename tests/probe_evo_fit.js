const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  await p.goto('http://localhost:6115/index.html', { waitUntil: 'load' });
  await p.waitForSelector('.org-pin-wrap', { timeout: 30000 });
  await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="evolution"]').click());
  await p.waitForTimeout(1000);
  const g = await p.evaluate(() => {
    const t = document.getElementById('evoTable');
    const pr = document.getElementById('rightPanel').getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    const cells = [...t.querySelectorAll('tbody tr:first-child td')].map(td => ({ txt: td.innerText.trim(), right: Math.round(td.getBoundingClientRect().right) }));
    return { tableOverflow: t.scrollWidth - t.clientWidth, tableRight: Math.round(tr.right), panelRight: Math.round(pr.right), cells, headerLast: [...t.querySelectorAll('thead th')].pop().innerText.trim() };
  });
  console.log(JSON.stringify(g));
  ok('evolution table does not overflow its panel', g.tableOverflow <= 1, 'scrollWidth-clientWidth=' + g.tableOverflow);
  ok('table stays inside the panel', g.tableRight <= g.panelRight + 1, JSON.stringify({ tableRight: g.tableRight, panelRight: g.panelRight }));
  ok('amount cell is inside the panel and shows dollars', /\$|—/.test(g.cells[4].txt) && g.cells[4].right <= g.panelRight, JSON.stringify(g.cells[4]));
  ok('header reads Grant amount (USD)', /Grant amount \(USD\)/.test(g.headerLast), g.headerLast);
  await p.screenshot({ path: '/tmp/evo_amount2.png' });
  await b.close();
})();
