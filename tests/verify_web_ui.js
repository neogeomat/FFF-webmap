// Headless web-UI verification via Playwright.
// Edit CONFIG, then run:
//   cd ~/pw-check && PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-browsers node verify_web_ui.js
// Exits non-zero if any console error / pageerror / failed request fired.
const { chromium } = require('playwright');

const CONFIG = {
  url: 'http://localhost:6115',   // page under test
  waitAfterLoadMs: 3500,               // let tiles / async layers settle
  viewport: { width: 1400, height: 900 },
  screenshot: '/tmp/ui_check.png',     // '' to skip
  // Runs in the page; customize the returned object. Return false / throw to fail.
  // For Leaflet maps: assert .leaflet-container and count loaded .leaflet-tile imgs.
  assertions: `(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')];
    const loaded = tiles.filter(i => i.complete && i.naturalWidth > 0).length;
    return {
      title: document.title,
      leafletContainer: !!document.querySelector('.leaflet-container'),
      tilesLoaded: loaded,
      // add app-specific checks here
    };
  })()`
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: CONFIG.viewport });
  const errors = [];
  // dead CDN script (cdn.polyfill.io is gone - the console message carries no URL, so match the
  // known-benign requestfailed URLs too) + aborted/late tile fetches
  const benign = (t, url) => /polyfill\.io|ERR_NAME_NOT_RESOLVED|ERR_ABORTED/.test(t) ||
    (!!url && /polyfill\.io|tile\.openstreetmap|arcgisonline|basemaps\./.test(url));
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text(), (m.location() || {}).url)) errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => {
    const t = r.url() + ' — ' + (r.failure() && r.failure().errorText);
    if (!benign(t)) errors.push('REQFAIL: ' + t);
  });

  await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(CONFIG.waitAfterLoadMs);

  const state = await page.evaluate(CONFIG.assertions);
  console.log('STATE: ' + JSON.stringify(state, null, 2));
  console.log('ERRORS: ' + (errors.length ? JSON.stringify(errors, null, 2) : 'NONE'));
  if (CONFIG.screenshot) await page.screenshot({ path: CONFIG.screenshot });
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})();
