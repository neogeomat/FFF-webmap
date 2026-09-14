// Hover probe for the FAO FFF grantees map. Copy to ~/pw-check and run: node probe_hover.js
// Contract (user rules): cluster hover -> one COLLAPSIBLE card per member (org name in <summary>,
// detail rows inside, closed by default); individual-marker hover -> the full bio_table_generator
// card; the popup must stay open while the pointer is inside it. Requires the site served on
// http://localhost:6115 (python3 -m http.server 6115 --directory Webmap); exits non-zero on any
// page/console error or failed persistence check.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/polyfill\.io|ERR_NAME_NOT_RESOLVED|ERR_ABORTED/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  await p.goto('http://localhost:6115', { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForSelector('.grantee-cluster', { timeout: 20000 });

  // 1. cluster popup: collapsible, closed, org name as the summary, no detail rows leaked
  await p.hover('.grantee-cluster');
  await p.waitForTimeout(400);
  console.log('CLUSTER ' + JSON.stringify(await p.evaluate(() => {
    const el = document.querySelector('.info-hover-popup');
    const ds = Array.from(el.querySelectorAll('details'));
    return {
      visible: getComputedStyle(el).display !== 'none',
      details: ds.length,
      openByDefault: ds.filter(d => d.open).length,
      summaries: ds.map(d => d.querySelector('summary').innerText.trim()),
      leakedDetailText: /Location|Type of Grant/.test(el.innerText)
    };
  })));
  await p.screenshot({ path: '/tmp/hover_cluster.png' });

  // 2. zoom in until an unclustered pin exists (the cluster group is not a safe global)
  await p.mouse.move(5, 700); await p.waitForTimeout(300);
  await p.evaluate(async () => {
    for (let i = 0; i < 8; i++) {
      if (document.querySelector('.org-pin-wrap')) return;
      const c = document.querySelector('.grantee-cluster');
      if (!c) return;
      c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
    }
  });
  const pin = await p.$('.org-pin-wrap');

  // 3. marker popup: full card, and it must persist when the pointer moves INTO the popup
  let inside = { visible: false };
  if (pin) {
    await pin.hover(); await p.waitForTimeout(400);
    console.log('MARKER ' + JSON.stringify(await p.evaluate(() => {
      const el = document.querySelector('.info-hover-popup');
      return {
        visible: getComputedStyle(el).display !== 'none',
        cards: el.querySelectorAll('.org-card').length,
        hasSN: /S\.N\./.test(el.innerText),
        hasLocation: /Location/.test(el.innerText)
      };
    })));
    const box = await p.evaluate(() => {
      const r = document.querySelector('.info-hover-popup').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + Math.min(40, r.height / 2) };
    });
    await p.mouse.move(box.x, box.y, { steps: 8 });
    await p.waitForTimeout(700);
    inside = await p.evaluate(() => {
      const el = document.querySelector('.info-hover-popup');
      return { visible: getComputedStyle(el).display !== 'none', cards: el.querySelectorAll('.org-card').length };
    });
    console.log('INSIDE_POPUP ' + JSON.stringify(inside));
    await p.screenshot({ path: '/tmp/hover_marker.png' });
    await p.mouse.move(10, 700, { steps: 8 }); await p.waitForTimeout(700);
    console.log('AFTER_LEAVE ' + JSON.stringify(await p.evaluate(() => {
      const el = document.querySelector('.info-hover-popup');
      return { visible: getComputedStyle(el).display !== 'none' };
    })));
  } else {
    console.log('MARKER no unclustered pin found');
  }
  console.log('ERRORS ' + JSON.stringify(errs));
  await b.close();
  process.exit(errs.length || !inside.visible ? 2 : 0);
})();
