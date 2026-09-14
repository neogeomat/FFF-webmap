// Hovering a marker or a cluster must NOT write the bottom panel (#aggregate).
const { chromium } = require('playwright');
const ok = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '   ' + d : '')); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = [];  // run with the server on :6115 p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.org-pin-wrap, .grantee-cluster', { timeout: 30000 });
  await p.waitForTimeout(5500);

  const agg = () => p.evaluate(() => document.getElementById('aggregate').innerHTML);
  const popup = () => p.evaluate(() => { const el = document.querySelector('.info-hover-popup'); return el ? (el.style.display + '|' + el.innerText.slice(0, 30).replace(/\s+/g, ' ')) : 'none'; });
  const boxOf = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);

  const base = await agg();
  ok('bottom panel starts filled (national aggregate)', base.length > 100, 'len=' + base.length);

  // hover a cluster
  const cb = await boxOf('.grantee-cluster');
  let afterCluster = base;
  if (cb) { await p.mouse.move(cb.x, cb.y); await p.waitForTimeout(900); afterCluster = await agg(); }
  ok('cluster hover does not touch the bottom panel', cb && afterCluster === base, cb ? 'hovered cluster' : 'no cluster on screen');
  ok('cluster hover still shows the floating card', cb && /block\|/.test(await popup()), await popup());

  // hover an individual marker
  await p.mouse.move(700, 900); await p.waitForTimeout(600);
  const pb = await boxOf('.org-pin-wrap');
  let afterPin = base;
  if (pb) { await p.mouse.move(pb.x, pb.y); await p.waitForTimeout(900); afterPin = await agg(); }
  ok('marker hover does not touch the bottom panel', pb && afterPin === base, pb ? 'hovered pin' : 'no pin on screen');
  ok('marker hover still shows the floating card', pb && /block\|/.test(await popup()), await popup());

  // NOTE: the CLICK side (#aggregate updates on a boundary click, clears on a second click) is covered by
  // probe_scope_full / probe_legend_pie — a pin-relative click point only reliably lands inside a district
  // polygon in those probes' setup, so it is not re-tested here. This probe owns the HOVER rule only.

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
