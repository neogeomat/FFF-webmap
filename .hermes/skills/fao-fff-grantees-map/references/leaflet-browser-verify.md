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
  District/Local Level/Province start OFF — toggle their `#granteeFilterBar` checkboxes before counting;
  Chure and Nepal start ON.
- Toggle a layer-control checkbox (or a `#granteeFilterBar` pill), then re-measure to confirm it draws.
- Chure, Nepal (country), and the Organizations (grantee markers) cluster layer are ON by default.

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
  the click fills `#aggregate` with that org's card (all its grants listed).
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
