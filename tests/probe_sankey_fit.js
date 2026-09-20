// The sankey must FIT the strip at every panel height. User report: "the diagrams do not fit the
// available vertical space, some part is always hidden, even when the panel is moved up."
// The failure mode was a JS height measured from inside the scrolling panel-content (one render stale,
// so the chart chased its own size) plus a 460px floor that outgrew a short strip.
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const warns = []; p.on('console', m => { if (m.type() === 'warning' && /renderSankey|sankey.*not defined/i.test(m.text())) warns.push(m.text()); });
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => document.querySelector('#mapModeTabs .mm-tab[data-mode="investment"]').click());
  await p.waitForTimeout(2500);

  const state = () => p.evaluate(() => {
    const pc = document.querySelector('#bottomPanel .panel-content');
    const pr = document.getElementById('bottomPanel').getBoundingClientRect();
    const out = { panelH: Math.round(pr.height), scrollable: Math.round(pc.scrollHeight - pc.clientHeight) };
    for (const id of ['chartSankey', 'chartSankeyAmount']) {
      const svg = document.getElementById(id);
      const rects = [].map.call(svg.querySelectorAll('g > rect'), r => r.getBoundingClientRect());
      const low = rects.length ? Math.max.apply(null, rects.map(r => r.bottom)) : 0;
      out[id] = { attrH: +svg.getAttribute('height'), cssH: svg.getBoundingClientRect().height,
                  overflow: Math.round(Math.max(0, low - pr.bottom)), nodes: rects.length };
    }
    return out;
  });

  // 1. Every drawn node is inside the panel, or reachable by scrolling the panel - never clipped.
  const sizes = ['50vh', '88vh', '30vh', '70vh', '40vh'];
  const rows = [];
  for (const s of sizes) {
    await p.evaluate(h => { document.documentElement.style.setProperty('--bottom-h', h); }, s);
    await p.evaluate(() => window._sankeyRefresh && window._sankeyRefresh());
    await p.waitForTimeout(1100);
    rows.push({ s, ...(await state()) });
  }
  ok('nothing is clipped at any panel height', rows.every(r => r.chartSankey.overflow <= r.scrollable + 2 && r.chartSankeyAmount.overflow <= r.scrollable + 2),
     JSON.stringify(rows.map(r => ({ h: r.s, panel: r.panelH, over: r.chartSankey.overflow, scroll: r.scrollable }))));

  // 2. The SVG's CSS box and its d3 layout height agree - if they drift, labels/links land outside it.
  ok('the drawn height matches the box at every size', rows.every(r => Math.abs(r.chartSankey.attrH - r.chartSankey.cssH) < 2 && Math.abs(r.chartSankeyAmount.attrH - r.chartSankeyAmount.cssH) < 2),
     JSON.stringify(rows.map(r => ({ h: r.s, attr: r.chartSankey.attrH, css: Math.round(r.chartSankey.cssH) }))));

  // 3. A SHORTER strip must give a SHORTER chart (the bug was a 460px floor ignoring the strip).
  const bySize = {}; rows.forEach(r => { bySize[r.s] = r.chartSankey.attrH; });
  ok('the chart tracks the strip rather than a fixed floor', bySize['88vh'] > bySize['50vh'] && bySize['50vh'] > bySize['30vh'],
     JSON.stringify(bySize));

  // 4. The real user action: drag the resize bar, both up and down.
  const drags = [];
  for (const dy of [-220, 260, -90]) {
    const box = await p.evaluate(() => { const r = document.getElementById('bottomResize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 3 }; });
    await p.mouse.move(box.x, box.y); await p.mouse.down();
    await p.mouse.move(box.x, box.y + dy, { steps: 12 });
    await p.mouse.up();
    await p.waitForTimeout(1200);
    const st = await state();
    drags.push({ dy, ...st, ok: st.chartSankey.overflow <= st.scrollable + 2 });
  }
  ok('dragging the resize bar leaves nothing hidden', drags.every(d => d.ok),
     JSON.stringify(drags.map(d => ({ dy: d.dy, panel: d.panelH, over: d.chartSankey.overflow, scroll: d.scrollable }))));
  ok('dragging up shows a taller chart than dragging down', drags[0].chartSankey.attrH > drags[1].chartSankey.attrH,
     JSON.stringify({ up: drags[0].chartSankey.attrH, down: drags[1].chartSankey.attrH }));

  ok('no cross-scope redraw warning', warns.length === 0, JSON.stringify(warns.slice(0, 2)));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
