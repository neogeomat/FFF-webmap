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
  Expected path counts: District=77, Province=7, Chure=1, Nepal=1. District/Province
  start OFF — toggle their `#granteeFilterBar` checkboxes before counting; Chure and Nepal start ON.
- Toggle a layer-control checkbox (or a `#granteeFilterBar` pill), then re-measure to confirm it draws.
- Chure, Nepal (country), and the Organizations (grantee markers) cluster layer are ON by default.

## Gotcha: OpenCode delegation
After `opencode run`, the edit may have landed even if the command exits non-zero from trailing
shell noise (`-/ command not found`, `unexpected EOF`). Verify with `git diff --stat` and a
`node --check` on the relevant `<script>` block rather than trusting the exit code.

## Verifying the async Grantees layer (added with Leaflet-ajax)
The grantee layer is built inside `layer_Grantees.on('data:loaded', ...)`, so `window.layer_Grantees`
is NOT defined (it's closure-scoped). Probe the rendered result instead:
- Marker clusters: `document.querySelectorAll('.grantee-cluster').length`
- Sum of points: read each `.grantee-cluster` text label (the child count) and add them; at the
  default Nepal zoom most/all points are clustered. The Type-of-Grant pills give the definitive
  total: `DBG + LoA` = the rendered Point features (DBG (10) + LoA (28) = 38 since the S_N 66→33 org
  merge; 39 before). Re-read the pill labels after any data merge — they move with the data.
- Filter pills: `#granteeFilterBar .gf-type` (expect 2: DBG, LoA) with their counts in the label.
- Left DataTable: `#dataTable tbody tr` (paginated, 10 rows/page — NOT the org count). To reach one
  org: `window.jQuery('#dataTable').DataTable().search('Binayi').draw()`, then read/click the matching
  row — the click fills `#aggregate` with that org's card (all its grants listed).
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
