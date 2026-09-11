# Verifying Leaflet / qgis2web map changes in a browser

The user requires proof a UI change actually renders — "done" without browser verification is rejected.

## Serve (required for fetch-loaded layers)
    python3 -m http.server 6115 --directory Webmap
    # open http://localhost:6115
Stop a stale server by PID (or the process/`wait` helper): `pkill -f 'http.server 6115'` also matches
the shell running the pkill and kills your own command (SIGTERM, exit -15).
Boundary overlays load via `fetch` and are BLOCKED on `file://` — always use HTTP to verify them.

## Browser-console checks
- Layout fill: `card.getBoundingClientRect().width / panel.getBoundingClientRect().width`
  (a small residual inset from `.card-body` padding is normal; aim for ~full width).
- Overlay rendered? Count SVG paths in the layer's pane:
    document.querySelector('.leaflet-pane_<Name>-pane').querySelectorAll('path').length
  PANE CLASS IS `leaflet-pane_<Name>-pane` — Leaflet appends `-pane`. Using `.pane_<Name>`
  returns null/0 and gives a false "nothing rendered" reading.
  Expected path counts: District=77, Local Level=33, Province=7, Chure=1, Nepal=1.
  On a fresh load District/Province/Chure and Nepal are already ON (77/7/1/1 paths with no interaction) and
  Local Level is OFF — toggle its pill before counting the 33.
- Toggle a layer-control checkbox (or a `#granteeFilterBar` pill), then re-measure to confirm it draws.
- Chure, Nepal (country), and the Organizations (grantee markers) cluster layer are ON by default.
- **Startup state, one un-touched page load (no clicks):** `img.leaflet-tile` = 0 (empty `L.gridLayer` base,
  not a blank tileLayer), `getComputedStyle(document.getElementById('map')).backgroundColor` =
  `rgb(232, 245, 233)` (the light-green canvas), the four path counts above, pills
  `layer_District/LocalLevel/Province/Chure` = on/off/on/on (check `cb.checked` AND
  `label.classList.contains('checked')`), and `.leaflet-control-layers-base` showing `No background` as the
  active radio. Then click `Satellite (Esri)` in that control → tiles > 0 with the district paths surviving,
  click `No background` → tiles back to 0.
- **The zoom LEVEL is not readable from a probe either** (`map` is closure-scoped and `window.map` is the
  `<div>`), so never assume one: anchor on an action whose zoom you control — the left-panel row click lands
  on exactly `z13` — then step the map ±1 with `.leaflet-control-zoom-in` / `.leaflet-control-zoom-out` and
  assert the zoom-driven behaviour flips one step BELOW the anchor and back one step ABOVE it. Read the two
  observables that ARE in the DOM: `img.leaflet-tile` count and the `.leaflet-control-layers-base
  input:checked` radio (Leaflet's layers control re-ticks itself off `layeradd`/`layerremove`). Assert BOTH
  directions — a one-way check passes on a handler that never turns the layer back off. Consolidated probe
  for this whole group (startup canvas, pill defaults, zoom-driven basemap, filter-bar collapse):
  `scripts/probe_map_chrome.js`.
- **Is the startup content clear of the legend?** `map` and `window.layer_Grantees` are closure-scoped, so
  measure the RENDERED markers: `Array.from(document.querySelectorAll('.org-pin-wrap, .grantee-cluster')).map(e => e.getBoundingClientRect())`,
  take the max right edge and compare with `.commodity-legend`'s `left` (and `#rightPanel .panel-toggle-btn`'s
  `left`). After `paddingBottomRight: [200, 0]` in `setBounds()` the east-most marker sits ~33px clear of the
  legend with 0 markers intersecting its rect; before it, one marker sat 67px *under* the legend. Any pan
  invalidates this — reload rather than re-measuring.

## Gotcha: OpenCode delegation
After `opencode run`, the edit may have landed even if the command exits non-zero from trailing
shell noise (`-/ command not found`, `unexpected EOF`). Verify with `git diff --stat` and a
`node --check` on the relevant `<script>` block rather than trusting the exit code.
**Keep the whole prompt inside the repo.** A prompt that has OpenCode run or read anything outside its
workdir — your `~/pw-check` probes, or a `git diff` path that resolves above the workdir — hits
`! permission requested: external_directory (…); auto-rejecting` and ABORTS the run, usually AFTER the file
edit already landed. So never ask it to verify with your harness; pass the prompt via a file
(`PROMPT=$(cat /tmp/x.txt) && opencode run "$PROMPT" --model <model>`) instead of quoting it inline.

## "It used to be white" — diff computed styles against the previous build
When the user says an element looked different BEFORE some edit, do not guess which rule won: build the
previous version and diff the computed styles.
    cd Webmap && git show HEAD:index.html > /tmp/head_site/index.html
    for d in data js css images vendor; do ln -s "$PWD/$d" /tmp/head_site/$d; done   # assets by symlink
    cd /tmp/head_site && python3 -m http.server 6116                              # second port
Run the SAME probe against :6116 (previous) and :6115 (current): for every element inside the container
record `tag.class` + a text snippet -> `color`/`background`/`fontSize`, then print the keys whose values
differ. This is how the left panel's white-on-blue "‹ Grantees" tab was found: `#leftPanel button` had been
given `color:#1a3c5e` and ID specificity beat the tab's own white rule. Fix the ONE rule, re-run both
probes and assert the light-on-dark set matches the old build exactly. Kill the temp server afterwards.
Uncommitted work is exactly what makes this cheap: the working tree is the "now" side, HEAD is the "before".

## Screenshot / preview traps (cost real time)
- A full-viewport PNG screenshot is often too large for the image-analysis endpoint (nginx
  `413 Request Entity Too Large`). Clip to the element of interest (`page.screenshot({clip})` around
  `getBoundingClientRect()`) or shoot `type: 'jpeg', quality: 70`; a tight crop also makes small UI details
  legible to the reviewer.
- `page.evaluate("(x) => {...}", arg)` — the STRING form — silently returns `undefined`: the callback never
  runs and you get empty output with no error. Pass a real function/arrow as the first argument.
- `transform: scale()` does NOT change an element's layout box, so a scaled clone inside an unsized parent
  overlaps its neighbours and gets clipped by `elementHandle.screenshot()`. Wrap scaled content in a
  fixed-size flex frame sized for the SCALED result (e.g. a 150px frame for a 32px pin at `scale(4)`).
  Cloning a Leaflet marker also clones Leaflet's inline positioning — normalise the clone's transform or you
  capture an off-screen fragment.
- `net::ERR_CONNECTION_REFUSED` on :6115 means the preview server died since the last turn — restart
  `python3 -m http.server 6115 --directory Webmap` and `curl -s -o /dev/null -w '%{http_code}'` it before
  re-running the probe, instead of debugging the page.
- **Content inside a COLLAPSED panel is assertable but NOT visible.** `#aggregate` (and every panel body)
  is in the DOM while the panel is collapsed, so `innerText`/row-count assertions pass — and a screenshot
  at the same moment shows the MAP. The image reviewer then truthfully reports "the card is blank", which
  reads like a bug. Open the panels first (`document.querySelectorAll('#leftPanel .panel-toggle-btn,
  #bottomPanel .panel-toggle-btn').forEach(b => { if (b.closest('.map-panel').classList.contains('collapsed')) b.click(); })`)
  before shooting.
- **An `elementHandle.screenshot()` of a tall card inside a scrolling panel captures only the visible
  slice** (the `.panel-content` overflow clips it), so the lower rows — the ones you just changed — are
  missing from the image. Scroll the container to the row of interest and shoot again:
      const tl = [...document.querySelectorAll('#aggregate tr')].find(tr => tr.querySelector('th')?.innerText.trim() === 'Timeline');
      document.querySelector('#bottomPanel .panel-content').scrollTop = tl.offsetTop - 40;
  Two shots (panel top + scrolled) document a long card; say which rows each one shows.
- **Before blaming a click handler for "not firing", log what the click actually HIT.**
  `p.mouse.click(x, y)` targets coordinates, and an expanded overlay can cover them: the open
  `#granteeFilterBar` is ~700×364 at top-center, so a naive "click the empty map" point landed on a
  filter PILL and the bar correctly stayed open — a false negative that looks like a broken
  click-outside handler. Instrument first:
      page.evaluate(() => { window.__clicks = []; document.addEventListener('click', e => window.__clicks.push((e.target.tagName||'?') + '.' + String(e.target.className||'').slice(0,24))); })
  then read `window.__clicks` after the action, and pick coordinates outside the overlay's
  `getBoundingClientRect()`.

## Verifying the async Grantees layer (added with Leaflet-ajax)
The grantee layer is built inside `layer_Grantees.on('data:loaded', ...)`, so `window.layer_Grantees`
is NOT defined (it's closure-scoped). Probe the rendered result instead:
- Marker clusters: `document.querySelectorAll('.grantee-cluster').length`
- Sum of points: read each `.grantee-cluster` text label (the child count) and add them; at the
  default Nepal zoom most/all points are clustered. The Type-of-Grant pills give the definitive
  total: `DBG + LoA` = the rendered Point features (36 after the duplicate-row merges — DBG 10 + LoA 26;
  39 before any merge). Re-read the pill labels after every merge — they move with the data.
- Filter pills: the VISIBLE labelled pills are `label.gf-value` (each = a `.gf-box` tick + a `<span>`
  with text like `DBG (10)`). `.gf-type` / `.gf-commodity` / `.gf-enterprise` / `.gf-orgtype` sit on the
  HIDDEN `<input type="checkbox">` INSIDE those labels, so `.gf-type .gf-value` matches NOTHING —
  read `.gf-value` (22 pills) and filter by text instead of chasing an empty list.
- Left DataTable: `#dataTable tbody tr` — SCROLL-ONLY now (`dom: 'f<t>'`, `"paging": false`), so it holds
  every org (36); it used to paginate at 10 rows/page and was NOT the org count. To reach one org:
  `window.jQuery('#dataTable').DataTable().search('Binayi').draw()`, then read/click the matching row —
  the click fills `#aggregate` with that org's card (all its grants listed). The list holds only orgs WITH
  geometry: a name that has none (or a typo) leaves the single `.dataTables_empty` "No matching records
  found" row, so an empty result is data, not a bug — and clicking that row must not throw (the handler
  guards `if (!data) return;` because `table.row(this).data()` is `undefined` for it).
A successful render = clusters > 0 AND 2 filter pills AND table rows > 0 AND no JS console errors.
If clusters = 0 but pills/table are also empty, the `data:loaded` callback didn't fire — check the
geojson URL (must be `data/Grantees.geojson`, HTTP-served) and that `leaflet-ajax.min.js` loaded.

Features with `geometry: null` are skipped by Leaflet, so counts reflect only the Point features.

## Hover verification (cluster vs individual marker)
Both hovers are DOM-only — assert on the popup, not on Leaflet events. Probe: `scripts/probe_hover.js`.
- **Cluster:** `page.hover('.grantee-cluster')`. That class sits on an inner div; the mouseover bubbles
  to the marker icon that owns the handler. Expect `Cluster — N organizations` plus ONE COLLAPSIBLE CARD
  PER MEMBER: `details: N`, `openByDefault: 0`, summaries = the org names, and — because `innerText`
  omits the content of a CLOSED `<details>` — no `Location` / `Type of Grant` while collapsed. Then set
  `.info-hover-popup details`.open = true and expect the same card the marker popup shows (a names-only
  list or a bare detail table is a regression the user rejects).
- **Individual marker:** at the default zoom every point is clustered. Zoom in by dispatching clicks on
  the cluster icon until an unclustered pin exists, then hover it:
      for (let i = 0; i < 8 && !document.querySelector('.org-pin-wrap'); i++) {
        document.querySelector('.grantee-cluster').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 900));
      }
  Expect the full card (`S.N. … Organization … Location … Grants …`).
- `window.clusters_Grantees` / `window.layer_Grantees` / the Leaflet `map` are NOT globals in this app
  (closure-scoped), so you cannot `setView()` from the console or from `page.evaluate` — click through
  the UI instead. A pin that never appears after ~8 clicks means the cluster's bounds don't resolve to a
  single marker; pick another cluster rather than guessing.
- **Hover probes need a REAL pointer:** `page.hover(...)`, or `page.mouse.move(x, y, {steps: 8})` into
  the popup's `getBoundingClientRect()` centre to test pointer-inside persistence. Synthetic events do
  not exercise the deferred hide. Assert on `getComputedStyle(popup).display`; after leaving, wait
  ~700 ms, because the hide is deliberately deferred (~250 ms) so the pointer can cross into the box.
- **`elementHandle.hover({ force: true })` produces NO popup** — the forced path skips the real mouse
  move Leaflet's `mouseover` needs, so you get `visible: false` and may wrongly conclude the popup broke.
  Hover by selector: `page.hover('.org-pin-wrap >> nth=' + i)`, and skip pins whose `read()` returns null.
- **A specific org's pin may be inside a cluster** — a fresh load renders only ~7 pins, so hovering at
  random cannot reach a chosen org (e.g. one that is women-led). Options, cheapest first: click the org's
  row in the left DataTable — the row-click handler zoom-pans via `clusters_Grantees.zoomToShowLayer(...)`,
  which breaks the pin out of its cluster, so the probe can hover/measure it straight away; then click
  clusters / zoom-in until the target area separates, or assert on the SHARED card instead (`#aggregate`
  gets `bio_table_generator`'s exact HTML) and state plainly that the marker/cluster popups render the same
  generator. Never claim a popup screenshot you did not get.
- **That row click IS the zoom assertion** — after clicking an org's row, the nearest `.org-pin-wrap` rect
  centre to the `#map` rect centre reads ~0 px, rendered pins go 7 → 5 and clusters 7 → 1, and that org's
  `.org-tip-name` tooltip appears (it did not exist while clustered). A second click on an
  already-visible pin must stay centred — the callback re-centres rather than skipping.
- **Measure MARKERS, not tooltip elements, when checking position.** `.org-tip-name` tooltips live in
  `.leaflet-tooltip-pane`, so `tip.closest('.leaflet-marker-icon')` is null and `tip.parentElement` is the
  PANE — the "distance from map centre" you then compute is meaningless and reads as a broken feature while
  the screenshot shows the pin dead-centre. Use `[...document.querySelectorAll('.org-pin-wrap')]` rects
  against `#map`'s rect. When a probe disagrees with a screenshot, suspect the selector before the code, and
  say which one you changed.
- **Playwright `page.evaluate` takes exactly ONE argument** — `page.evaluate(fn, someObject)`. Passing
  `fn, arg, null, 1` throws `Too many arguments`; wrap extra values in the single object.

## Browser sandbox workaround (this Ubuntu host)
Prefer driving Playwright directly (`cd ~/pw-check && node verify_web_ui.js`) — no consent
popup, no Chrome binary needed. The harness-attach trick below only helps if you specifically
need the `browser_exec` helpers.

The Hermes `browser_exec` harness launches Chrome itself and relies on user namespaces, which this
kernel blocks (`Sandbox: CanCreateUserNamespace() unshare(CLONE_NEWPID): EPERM`) — so the harness
fails to start Chrome and no popup appears. Workaround that worked: pre-launch Playwright's Chromium
with `--no-sandbox` + a DevTools port, then run `browser_exec` (the harness attaches to the
already-running browser instead of launching its own):
    CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
    "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
      --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-hermes about:blank >/tmp/chrome-dbg.log 2>&1 &
    sleep 3; curl -s http://127.0.0.1:9222/json/version   # confirm "DevTools listening"
Then `python3 -m http.server 6115 --directory Webmap` and drive `http://localhost:6115`.
Firefox/Zen are NOT usable with this harness — it is CDP/Chrome-only.
