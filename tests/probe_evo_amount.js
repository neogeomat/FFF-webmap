// Evolution mode: the Grant amount column must be filled and consistent with the summary.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/polyfill|tile|ERR_NAME_NOT_RESOLVED|aborted/i.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  await p.goto('http://localhost:6115/index.html', { waitUntil: 'load' });
  await p.waitForSelector('.org-pin-wrap', { timeout: 30000 });
  await p.waitForTimeout(5500);
  // enter evolution mode
  await p.evaluate(() => document.querySelector('.mm-tab[data-mode="evolution"]').click());
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#evoTable tbody tr')].map(tr => {
      const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
      return { year: c[0], newGrantees: +c[1], amount: c[4] };
    });
    const summary = document.getElementById('evoSummary').innerText.replace(/\n/g, ' ');
    const intro = document.querySelector('#tab-evolution .evo-intro').innerText;
    const header = [...document.querySelectorAll('#evoTable thead th')].map(t => t.innerText.trim());
    return { rows, summary, intro, header, bodyEvo: document.body.classList.contains('map-mode-evolution') };
  });
  const parse = s => s === '—' ? 0 : Number(String(s).replace(/[^0-9]/g, '')) || 0;
  const colSum = r.rows.reduce((a, x) => a + parse(x.amount), 0);
  const sumM = r.summary.match(/Grant amount:\s*\$([0-9,]+)/);
  const summaryAmt = sumM ? Number(sumM[1].replace(/,/g, '')) : null;
  const filled = r.rows.filter(x => parse(x.amount) > 0);
  console.log('rows:', JSON.stringify(r.rows));
  console.log('column sum:', colSum, '| summary:', summaryAmt);
  ok('evolution mode active with a filled amount column', r.bodyEvo && r.rows.length >= 5 && filled.length >= 1, JSON.stringify(filled.map(x => x.year)));
  ok('column has no empty cells (numbers or em-dash)', r.rows.every(x => x.amount !== ''), JSON.stringify(r.rows.map(x => x.amount)));
  ok('summary shows a Grant amount', summaryAmt !== null && summaryAmt > 0, r.summary.slice(0, 160));
  // each row is rounded to the dollar, so the column can drift a few dollars from the summary
  ok('summary equals the column sum (within rounding)', summaryAmt !== null && Math.abs(summaryAmt - colSum) <= r.rows.length, JSON.stringify({ summaryAmt, colSum }));
  ok('total is sane (<= 2,288,256 USD, > 1M)', colSum > 1e6 && colSum <= 2288257, String(colSum));
  ok('every year with new grantees has an amount', r.rows.filter(x => x.newGrantees > 0 && parse(x.amount) === 0).length === 0,
     JSON.stringify(r.rows.filter(x => x.newGrantees > 0 && parse(x.amount) === 0)));
  ok('header says USD', r.header.some(h => /Grant amount \(USD\)/.test(h)), JSON.stringify(r.header));
  ok('intro no longer claims the data is missing', !/data not available/i.test(r.intro), r.intro.slice(0, 120));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await p.screenshot({ path: '/tmp/evo_amount.png' });
  await b.close();
})();
