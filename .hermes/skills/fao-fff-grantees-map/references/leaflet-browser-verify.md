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

## Proving a data dependency is GONE (assert on the request log)
Dropping a source file is not proved by reading the diff. A leftover `fetch` on an error path, a builder that
only runs in one mode, or a half-reverted edit all look clean in a diff and still hit the network. Record
every request and assert against that list:
```js
const reqs = [];
page.on('request', r => { try { reqs.push(new URL(r.url()).pathname); } catch (e) {} });
// after load plus whatever interactions you care about:
assert(!reqs.some(p => /Grantees\.geojson|grantees_attributes\.json/.test(p)));
```
Print the `data/` subset of `reqs` inside the failure message — "which URLs did it actually ask for" is the
whole diagnosis, and the same log proves the positive form of a switch (exactly ONE data request where there
used to be three). Cheap to bolt onto a probe that already loads the page.

## Gotcha: OpenCode delegation
After `opencode run`, the edit may have landed even if the command exits non-zero from trailing
shell noise (`-/ command not found`, `unexpected EOF`). Verify with `git diff --stat` and a
`node --check` on the relevant `<script>` block rather than trusting the exit code.
**Keep the whole prompt inside the repo.** A prompt that has OpenCode run or read anything outside its
workdir — your `~/pw-check` probes, or a `git diff` path that resolves above the workdir — hits
`! permission requested: external_directory (…); auto-rejecting` and ABORTS the run, usually AFTER the file
edit already landed. So never ask it to verify with your harness; pass the prompt via a file
(`PROMPT=$(cat /tmp/x.txt) && opencode run "$PROMPT" --model <model>`) instead of quoting it inline.
The inverse also holds: an invoked `/opencode` is not a reason to funnel a PURE MECHANICAL edit through the
CLI. A block move, a one-constant change or a path rename is faster and race-free applied directly, with the
saved time spent on the probe suite — do that and say so. Reserve delegation for edits that need judgement
across several rules at once.

## Is this MY regression? — A/B the previous build on a second port
Any suspected regression ("it used to be white", "the popup stopped opening", a probe that fails after a data
migration) is settled by running the SAME probe against HEAD, never by reading your diff — a diff looks clean
whether or not the behaviour changed. Whole-tree copy, assets included:
    rm -rf /tmp/oldsite && mkdir -p /tmp/oldsite
    cd Webmap && git archive HEAD | tar -x -C /tmp/oldsite && python3 -m http.server 6117 --directory /tmp/oldsite
Point a copy of the probe at :6117 (`sed -i 's/:6115/:6117/'`), diff the two outputs line by line, kill the
temp server. Identical geometry/behaviour ⇒ pre-existing, stop chasing it and say so in the report. This is
how a hover-popup that only opened once per pointer-exit was cleared as NOT caused by the geocsv switch.
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
- **The PANELS are overlays too, and they move.** `#rightPanel` owns the right 340px, `#leftPanel` the left
  280px, `#bottomPanel` the bottom 350px, so a click there never reaches the map — probing a small polygon
  whose bbox sits under a panel reads as "no polygon hit", i.e. a broken point-in-polygon test that is
  actually a missed click. Aim at the middle band (roughly x 300-1000, y 150-600 at 1500x950). A polygon click
  AUTO-OPENS `#rightPanel`, so the safe area SHRINKS between the first and second click of one probe:
  re-read the target rect before every click instead of caching coordinates.
- **Re-scope by clicking just beside a pin.** A district's bbox centre can fall outside its irregular ring or
  off-screen entirely. Clicking ~25px to the right of a rendered `.org-pin-wrap` lands inside that district
  and off the marker — exactly the safe spot, because the map click handler ignores marker/tooltip targets.
  Assert the resulting KIND (`#aggOverview` starts with `District — `), not the polygon name, which depends on
  where the pin happens to sit.
- **Finding a SPECIFIC org's pin: click its row in the left list first.** A fresh load renders ~7-9 pins, so the
  org you need is usually inside a cluster and off-screen; its `.org-tip-name` text does not exist in the DOM yet
  and a tooltip-text search returns an empty list (reads as "org missing"). Click the org's row in `#dataTable`
  (it centres the map on that org at z13), wait ~2s, then read the tooltip rects. Whole recipe, in one probe:
  click the row → `[...document.querySelectorAll('.org-tip-name')].find(e => /name/i.test(e.textContent))` →
  `page.mouse.click(rect.x + rect.width / 2 + 26, rect.y + rect.height + 20)` (the `+26` puts the click on the
  polygon, not the marker). A district click AUTO-OPENS `#rightPanel`, which eats the right 340px — re-read rects
  after every click instead of caching coordinates.
- **`.org-tip-name` tooltips: do NOT filter them by `offsetParent`.** Leaflet parks tooltips in
  `.leaflet-tooltip-pane` with absolute positioning, so `offsetParent` is `null` for every one of them and
  `tips.filter(e => e.offsetParent !== null)` returns `[]` — looks exactly like "the pin is not on the map"
  while it is sitting there. Read text + `getBoundingClientRect()` and filter by TEXT. The tooltip is anchored
  ABOVE its marker (offset ~[0, -12]), so the marker centre is ≈ `tipRect.y + tipRect.height + 12`.
- **Predict the scope offline instead of guessing which polygon a pin sits in.** The ray-casting check that
  guards the simplified boundaries also answers "which district is this pin in":
  `sys.path.insert(0, 'Webmap/tests'); from boundary_pip_check import districts, resolve` then
  `resolve(districts('Webmap/data/District.geojson'), lon, lat)` (returns the `DISTRICT` value, e.g.
  `KABHREPALANCHOK`). Use it to build the expected scope/labels before touching the browser, and to count the
  distinct `municipality` strings a scope click should produce.

## Verifying the Grantees layer (single source: the geocsv)
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
If clusters = 0 but pills/table are also empty, the `data:loaded` event never fired — the loader only fires it
after the geocsv parses, so check in this order: the console warning (`geocsv load failed` / `geocsv 4xx`), the
column names the loader asserts (`geocsv: missing column …`), and that `data/Grantees.combined.geocsv` is
served over HTTP. There is no longer a geojson or `leaflet-ajax.min.js` in the path.

An org with no `WKT` value gets no marker (the old `geometry: null` rows), so counts reflect the Point rows only.
`has_geometry` in the file and the rendered count must agree — reconcile them, don't eyeball the map.

## Verifying a filter or view mode (reconcile the SET, not the count)
A new `.mm-tab` mode or a filter pill is proved by checking the rendered orgs are the RIGHT ones — a bare
count passes while showing the wrong 13. The map's ONLY data source is `data/Grantees.combined.geocsv`, so do
NOT rebuild the expectation in-page: the retired `grantees_attributes.json` now 404s and the probe dies on
`await r.json()`. Generate the expected set OFFLINE and freeze it in the probe next to the command that made it:
    # women-led orgs that can actually render (records + coordinates)
    python3 -c "import csv;r=list(csv.DictReader(open('Webmap/data/Grantees.combined.geocsv',encoding='utf-8-sig')));print(sorted({x['org_name_geojson'] for x in r if x['women_json'].strip() and x['WKT'].strip()}))"
- **Expected count is (matching records ∧ coordinates), and it is usually SMALLER than the record count.**
  68 orgs are in the geocsv and only 36 carry a `WKT`, so every data-driven filter silently drops the rest
  (women-led: 18 orgs with records, 13 on the map; the retired JSON had 19/13, so a mode that suddenly shows 13
  did NOT lose an org). Print both numbers in the probe output — "the mode shows too few" is normally the data,
  not the filter.
- Compare the RENDERED NAMES against a frozen list with whitespace normalized
  (`replace(/\s+/g,' ').trim().toLowerCase()`): the geocsv org names carry double spaces and trailing location
  text, so raw string equality fails while the mode is correct.
- Rendered count: `document.querySelectorAll('.org-pin-wrap').length` + Σ(the number in each
  `.grantee-cluster`). Rendered NAMES: the `.org-tip-name` tooltip texts — clustered members have no tooltip
  in the DOM, so use them as a SUBSET assertion (every visible name must be in the expected set; an empty
  stray list is the pass condition), never as an equality one.
- Then the composition + memory trio: `#commClear` → 0 orgs (the mode term cannot be bypassed by pill churn),
  `#commSelectAll` → back to the expected count with no stray name, `page.reload()` → same mode
  (`localStorage['fff.mapMode']`, `.mm-tab.active`, body class) and same count, switch back to Map View →
  the full 36. After every switch, exactly ONE `map-mode-*` class on `body`, and a mode's own panel/table
  visibility flips with it (`#tab-evolution` only in evolution).

## Verifying a boundary (polygon) click scope
A polygon click re-scopes the right-panel aggregates, so the probe must prove WHICH polygon it hit — the pane
paths carry no name and are indistinguishable by shape.
- **Map path index → geojson feature index.** Every boundary layer is built with `L.geoJson(geojson, …)`,
  which preserves feature order, and the loader stashes the raw file on a global (`window.json_District`,
  `json_Province`, `json_LocalLevel`, `json_Chure`, `json_Nepal`). So the Nth
  `.leaflet-pane_District-pane path` is `window.json_District.features[N]`: read the expected name from the
  geojson, `page.mouse.click` the centre of that path's `getBoundingClientRect()`, then ASSERT the panel
  summary (`#aggOverview`) names that same polygon. That last assertion is what validates the index mapping —
  without it a wrong-index click looks like a feature bug.
- **Click the real element with a real pointer** (`page.mouse.click(cx, cy)` at the path's bbox centre).
  Leaflet handles clicks through its own DOM listener; a synthetic `new MouseEvent('click')` on the SVG path
  is unreliable for paths.
- **Recompute the expectation in page context** from the geocsv rows with your own copy of the
point-in-polygon test, then compare label-by-label against `window.chartPie.data`, `window.chartBar.data` and
the invested/flow instances — a count-only assertion passes on the wrong orgs.
- **Prove chart COLOURS by sampling the canvas — not by eye, and not only with an image reviewer.** A chart
  can hold the right data and still paint black (a missing `backgroundColor` renders the translucent-black
  default). `getImageData` + a tolerance count is deterministic:
  ```js
  const count = (el, t, tol) => { const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200 && Math.abs(d[i] - t[0]) <= tol &&
      Math.abs(d[i + 1] - t[1]) <= tol && Math.abs(d[i + 2] - t[2]) <= tol) n++; }
    return n; };
  ```
  Assert the expected slice colours are non-zero AND the near-black count is 0. The ratio of the two counts
  should track the data ratio (26 LoA : 10 DBG → ~2.6:1 measured), which is what catches a colour map keyed
  by the wrong axis. Also assert a pie and its companion bar report the same labels/data/colours (one
  `renderAggregates` map feeds both), and re-check both after a scope click.
- **Clear path:** clicking empty map must restore the national totals (36 orgs) AND reset the previous
  polygon's highlight (stroke weight/colour back to the layer default); assert no `map-mode-*` class changed.
- `#rightPanel` is collapsed by default and a polygon click opens it (user rule), so assert it is expanded
  after the click — and open any panel you need manually before taking a screenshot, or the image shows the
  bare map.

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
  row in the left DataTable — the row click centres the map on the org at z13 but does NOT force its pin out of the cluster,
  so an org in dense country must still be separated by clicking its cluster icon; then click
  clusters / zoom-in until the target area separates, or assert on the SHARED card instead (`#aggregate`
  gets `bio_table_generator`'s exact HTML) and state plainly that the marker/cluster popups render the same
  generator. Never claim a popup screenshot you did not get.
- **That row click IS the zoom assertion** — the handler is ONE deterministic call now
  (`map.setView(layer.getLatLng(), Math.max(map.getZoom(), 13))`, no cluster API), so assert the nearest
  `.org-pin-wrap` **or `.grantee-cluster`** rect centre to the `#map` rect centre reads ~0-10 px. Which one
  you get depends on the location: an isolated org lands as a PIN at 0 px with its `.org-tip-name` tooltip
  (absent while clustered), while a dense-city org is legitimately still a CLUSTER at z13 — the cluster icon
  IS the target, not a failure. Pin/cluster COUNTS are not fixed numbers (7 → 6 pins / 7 → 2 clusters
  observed); assert the CENTRE, not the counts, and assert the repeat click is stable rather than
  'a pin appears'.
- **Measure MARKERS, not tooltip elements, when checking position.** `.org-tip-name` tooltips live in
  `.leaflet-tooltip-pane`, so `tip.closest('.leaflet-marker-icon')` is null and `tip.parentElement` is the
  PANE — the "distance from map centre" you then compute is meaningless and reads as a broken feature while
  the screenshot shows the pin dead-centre. Use `[...document.querySelectorAll('.org-pin-wrap')]` rects
  against `#map`'s rect. When a probe disagrees with a screenshot, suspect the selector before the code, and
  say which one you changed.
- **A popup shows on the FIRST hover only**, until the pointer leaves and re-enters; a loop that hovers five
  pins and collects five cards gets 1 non-empty card and looks like a broken popup path. Assert one full card
  plus its row contents, or hover, read, move away and RE-ENTER the same pin. Clear it as pre-existing by A/B
  before calling it a regression (it reproduces on HEAD).
- **Keep every probe/debug script in `~/pw-check`** — that directory holds `node_modules`, so a script run from
  `/tmp` dies with `MODULE_NOT_FOUND: playwright`. Write it into `Webmap/tests/` (or `~/pw-check/`, which has its
  own `node_modules`) and run it from there rather than
  adding a second dependency install.
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
