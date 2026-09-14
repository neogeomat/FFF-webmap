// Read-only measurement: what the page actually downloads and how long startup takes.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const t0 = Date.now();
  await p.goto('http://localhost:6115', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const dcl = Date.now() - t0;
  await p.waitForSelector('.grantee-cluster, .org-pin-wrap', { timeout: 30000 });
  const markers = Date.now() - t0;
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const res = performance.getEntriesByType('resource').map(e => ({
      name: new URL(e.name).pathname, dec: e.decodedBodySize || 0, enc: e.encodedBodySize || 0, ms: Math.round(e.duration)
    })).sort((a, b) => b.dec - a.dec);
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return { total: res.reduce((a, x) => a + x.dec, 0), top: res.slice(0, 10), count: res.length, loadEvent: Math.round(nav.loadEventEnd || 0) };
  });
  console.log('DOMContentLoaded ' + dcl + ' ms | 36 markers at ' + markers + ' ms | load event ' + r.loadEvent + ' ms');
  console.log('total decoded ' + (r.total / 1048576).toFixed(1) + ' MB across ' + r.count + ' resources');
  r.top.forEach(x => console.log('   ' + (x.dec / 1048576).toFixed(2).padStart(6) + ' MB (enc ' + (x.enc / 1024).toFixed(0).padStart(5) + ' KB, ' + String(x.ms).padStart(4) + ' ms)  ' + x.name));
  await b.close();
})();
