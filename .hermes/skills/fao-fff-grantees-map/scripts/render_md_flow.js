// Render the first ```mermaid block of a markdown file to a PNG and prove it parses.
// usage: node render_md_flow.js <input.md> <output.png> [baseUrl=http://localhost:6118/]
// Start a static server for baseUrl first (any dir works, e.g. python3 -m http.server 6118 --directory /tmp):
// the page needs a real origin for the dynamic mermaid import from jsdelivr.
const fs = require('fs');
const { chromium } = require('playwright');

const mdPath = process.argv[2];
const outPng = process.argv[3] || '/tmp/flow.png';
const baseUrl = process.argv[4] || 'http://localhost:6118/';

const m = fs.readFileSync(mdPath, 'utf8').match(/```mermaid\r?\n([\s\S]*?)```/);
if (!m) { console.log('NO_MERMAID_BLOCK'); process.exit(1); }
const code = m[1];
console.log('BLOCK_BYTES ' + code.length
  + ' NODES ' + (code.match(/\[|\{|\(/g) || []).length
  + ' EDGES ' + (code.match(/-->|-\.->|==>/g) || []).length
  + ' SUBGRAPHS ' + (code.match(/subgraph/g) || []).length);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: 'window.__CODE=' + JSON.stringify(code) + ';' });
  const result = await page.evaluate(async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const mermaid = mod.default;
    // useMaxWidth:false is REQUIRED for a full-size screenshot: the default sets width:100% on the SVG,
    // which collapses it to the ~300px default replaced-element box while still reporting PARSE_OK.
    mermaid.initialize({ startOnLoad: false, flowchart: { useMaxWidth: false, htmlLabels: true } });
    try { await mermaid.parse(window.__CODE); } catch (e) { return 'PARSE_FAIL ' + e.message; }
    const { svg } = await mermaid.render('g1', window.__CODE);
    document.body.innerHTML = '<div id="out" style="background:#fff;padding:18px;display:inline-block">' + svg + '</div>';
    return 'PARSE_OK svg_bytes=' + svg.length;
  });
  console.log(result);
  if (String(result).startsWith('PARSE_FAIL')) { await browser.close(); process.exit(3); }
  await (await page.$('#out svg')).screenshot({ path: outPng });
  const box = await page.evaluate(() => { const r = document.querySelector('#out svg').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  console.log('PNG ' + outPng + ' ' + box.w + 'x' + box.h + (box.w > 800 ? '  (full size OK)' : '  << SUSPICIOUS: SVG collapsed, check useMaxWidth:false'));
  console.log('ERRORS ' + JSON.stringify(errs));
  await browser.close();
  process.exit(box.w > 800 ? 0 : 4);
})();
