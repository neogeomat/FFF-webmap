// Legend side/ownership + pie colours + LoA/DBG bar.
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

  const state = () => p.evaluate(() => {
    const l = document.getElementById('commodityLegend');
    const ls = getComputedStyle(l);
    const rp = document.getElementById('rightPanel'), lp = document.getElementById('leftPanel');
    return { left: Math.round(parseFloat(ls.left)), right: ls.right, bottom: Math.round(parseFloat(ls.bottom)),
             leftCollapsed: lp.classList.contains('collapsed'), rightCollapsed: rp.classList.contains('collapsed') };
  });
  const clickToggle = id => p.evaluate(i => document.getElementById(i).querySelector('.panel-toggle-btn').click(), id);

  // 1. default: all panels collapsed
  let s0 = await state();
  ok('legend sits at the screen edge when the left panel is collapsed', s0.left <= 20, JSON.stringify(s0));

  // 2. open the LEFT panel -> legend moves right, past it
  await clickToggle('leftPanel'); await p.waitForTimeout(600);
  const s1 = await state();
  ok('legend moves right when the LEFT panel opens', s1.left >= 290, JSON.stringify(s1));

  // 3. open the RIGHT panel -> legend must NOT move
  await clickToggle('rightPanel'); await p.waitForTimeout(600);
  const s2 = await state();
  ok('legend does not move when the RIGHT panel opens', s2.left === s1.left, JSON.stringify({ before: s1.left, after: s2.left }));

  // 4. close the LEFT panel -> legend returns to the edge, even with the right panel open
  await clickToggle('leftPanel'); await p.waitForTimeout(600);
  const s3 = await state();
  ok('legend follows the LEFT panel back to the edge', s3.left <= 20 && s3.rightCollapsed === false, JSON.stringify(s3));

  // 5. pie colours: sample the canvas for FAO blue and orange
  const cols = await p.evaluate(() => {
    const near = (r, g, b2, t, tol) => Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b2 - t[2]) <= tol;
    const count = (el, target, tol) => {
      const c = el.getContext('2d'); const d = c.getImageData(0, 0, el.width, el.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200 && near(d[i], d[i + 1], d[i + 2], target, tol)) n++; }
      return n;
    };
    const dark = (() => { const el = document.getElementById('chartPie'); const c = el.getContext('2d');
      const d = c.getImageData(0, 0, el.width, el.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200 && d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) n++; } return n; })();
    return { blue: count(document.getElementById('chartPie'), [0, 112, 182], 14),
             orange: count(document.getElementById('chartPie'), [230, 126, 34], 14), dark };
  });
  ok('pie has FAO-blue pixels (LoA slice)', cols.blue > 300, JSON.stringify(cols));
  ok('pie has orange pixels (DBG slice)', cols.orange > 100, JSON.stringify(cols));

  // 6. the LoA/DBG bar mirrors the pie
  const bars = await p.evaluate(() => {
    const pie = window.chartPie, tb = window.chartTypeBar;
    return tb ? { labels: tb.data.labels, data: tb.data.datasets[0].data, colors: tb.data.datasets[0].backgroundColor,
                  pieLabels: pie.data.labels, pieData: pie.data.datasets[0].data,
                  pieColors: pie.data.datasets[0].backgroundColor, rects: tb.getDatasetMeta(0).data.length } : null;
  });
  ok('LoA/DBG bar chart exists', !!bars, JSON.stringify(bars && bars.labels));
  ok('bar mirrors the pie labels and counts', !!bars && JSON.stringify(bars.labels) === JSON.stringify(bars.pieLabels) && JSON.stringify(bars.data) === JSON.stringify(bars.pieData), JSON.stringify(bars));
  ok('bar and pie share the LoA/DBG colours', !!bars && JSON.stringify(bars.colors) === JSON.stringify(bars.pieColors) && bars.colors.indexOf('#0070b6') >= 0, JSON.stringify(bars && bars.colors));

  // 7. scoped update: click a district polygon (via the pin's district) and re-check both charts
  const pin = await p.evaluate(() => { const r = document.querySelector('.org-pin-wrap').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.click(pin.x + pin.w + 26, pin.y + pin.h / 2);
  await p.waitForTimeout(1400);
  const sc = await p.evaluate(() => ({
    overview: document.getElementById('aggOverview').innerText.split('\n')[0],
    pie: window.chartPie.data.datasets[0].data, bar: window.chartTypeBar.data.datasets[0].data,
    labels: window.chartTypeBar.data.labels, colors: window.chartTypeBar.data.datasets[0].backgroundColor
  }));
  ok('scope click updates the type charts', /^District|^Province|^Local Level/.test(sc.overview) && sc.pie.reduce((a, x) => a + x, 0) < 36, JSON.stringify(sc));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await p.evaluate(() => { document.querySelector('#rightPanel .panel-content').scrollTop = 0; });
  await p.screenshot({ path: '/tmp/legend_pie.png' });
  await b.close();
})();
