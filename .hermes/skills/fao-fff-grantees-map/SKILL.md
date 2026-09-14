---
name: fao-fff-grantees-map
description: Edit the FAO FFF grantees Leaflet web map.
---

# FAO FFF Grantees Web Map

Trigger skill for editing the FAO FFF Nepal grantees Leaflet map at `/home/ubentu/ssd/baato/FAO/FFF`.

**Standing rules:** prove every UI change in a browser over HTTP before reporting done; leave edits
UNCOMMITTED and report the touched paths — commit only when the user explicitly says so. Other agents
edit this repo concurrently, so a dirty working tree can be swept into someone else's commit.

**Base conventions, layout, data pipeline, and pitfalls live in `AGENTS.md` (repo root) —
read that first.**

**File map (post-split):** `Webmap/index.html` is markup + script/link tags only (~174 lines); page CSS
lives in `Webmap/css/map.css` and ALL page JS in `Webmap/js/map.js`. Wherever this skill or AGENTS.md still
says `index.html` or quotes a line number for page logic, read it as `js/map.js` — the code moved there
unchanged, in the same order.

**Two AGENTS.md claims are STALE — this skill and `js/map.js` win:** (1) "all map logic inline
`<script>` + `<style>` (~2143 lines)" — it is split now (see the verification loop below); (2) the
Pitfalls bullet still prescribes the RACY row-zoom recipe (`clusters_Grantees.zoomToShowLayer(layer, cb)`
+ `map.setView` in the callback). Do not follow either; a fix applied in code but left stale in
AGENTS.md is how a regression gets re-introduced. (3) It describes `data/Grantees.combined.vrt` (and the
`.csvt`) as shipped artifacts whose `encoding="WKT"` is what QGIS users load; `make_geocsv.py` only writes
them when re-run, so `ls` before repeating the claim — the tracked `.geocsv` is what is actually served.

**What the browser loads, and where money lives** — startup fetches 9 URLs: `data/Grantees.geojson`
(leaflet-ajax), `data/grantees_attributes.json`, `data/Grantees.combined.geocsv` (the per-org money) and the
five boundary geojsons. `data/investment_by_enterprise.json` and its generator `summarise_investment.py` were
**deleted** — money is derived in the page from the geocsv; do not reintroduce either file.
- `data/Grantees.combined.geocsv` is the only per-org money source: `loa_total_USD_org` / `dbg_total_USD_org`,
  68 distinct `S_N` (36 rendered orgs — 32 orgs hold money but have no coordinates), org columns repeated on
  every grant row, so first row per `S_N` wins. National totals reproduce the deleted JSON exactly:
  2,288,256 USD = Integrated 916,886 + Forest-based 336,226 + Farm-based 195,089 (probe asserts this).
- **Parse it as ONE string, not line by line.** Cells contain newlines and commas inside quotes; a
  line-based split silently loses 2 rows / ~73,014 USD. `js/map.js` `parseCsv()` walks the whole text with a
  quote flag and skips CR.
- Money scoping is asymmetric and that is correct: the national view counts all 68 orgs, a polygon scope only
  the orgs whose marker is inside it. Say so rather than "fixing" it.
- `.geocsv` is NOT gitignored (`git check-ignore -v` proves it) and is already tracked; keep it tracked,
  `.catch` the fetch so a missing file blanks the chart instead of breaking the page, and keep the probe's
  national-total assertion so a stale file fails loudly.
The pipeline in one diagram: `Webmap/DATAFLOW.md`.

This skill additionally documents the boundary-overlay behavior and the
browser verification recipe (see `references/leaflet-browser-verify.md`), which AGENTS.md
does not yet cover — keep AGENTS.md in sync after map changes.

## When to use
- Editing grantee data, markers, popups, the info panel, the filter, or basemaps in this repo.
- Editing the Grantees data layer (`data/Grantees.geojson`) or its - Editing the Grantees data layer (`data/Grantees.geojson`) or its async load wiring in `js/map.js`.
- Editing the District/Local Level/Province/Chure/Nepal boundary overlays or the `#granteeFilterBar` toggle pills.

## Grantee data layer (async GeoJSON via Leaflet-ajax)
The grantee points are NO LONGER an embedded JS blob. They load from
`Webmap/data/Grantees.geojson` through the **Leaflet-ajax plugin** (`L.geoJson.ajax`),
vendored at `Webmap/js/leaflet-ajax.min.js` (plain `<script src>` near the other non-deferred
libs such as markercluster/leaflet.js).

**Hard rule from the user:** load grantee data with the Leaflet-ajax plugin, NOT a raw
`fetch(...).then(res.json())`. Use `new L.geoJson.ajax('data/Grantees.geojson', {...})`.

Because the load is async, every piece of UI that depends on the grantee features MUST be built
inside `layer_Grantees.on('data:loaded', function(){ ... })`:
- `clusters_Grantees.addLayer(layer_Grantees)` + `addTo(map)` + `setBounds()`
- the `clustermouseover` hover table
- the Type-of-Grant filter pills (`buildGranteeTypeFilter()`)
- the left-panel DataTable (`buildGranteeTable()`) — its row-click handler fills the Details card AND
  zooms the map to the org with ONE deterministic call: capture the Leaflet layer in the same `eachLayer`
  lookup, then `if (layer) { map.setView(layer.getLatLng(), Math.max(map.getZoom(), 13)); }`.
  **Do NOT use `clusters_Grantees.zoomToShowLayer(layer, cb)`** with a `setView` inside the callback: that
  pair races (the callback can fire mid-animation and re-clustering re-absorbs the pin), so the view
  settled 0–126px off-centre depending on load timing — the same click gave different results on different
  loads. Landing on a cluster icon at z13 is fine; the user clicks it to fan the members out.
  `map` and `clusters_Grantees` are declared earlier in the same closure as this handler (`js/map.js`) — never use
  `window.map`, that is the `<div id="map">` element, not the Leaflet instance.
Define those as function declarations (hoisted) so they are callable from the callback. Do NOT
iterate `layer_Grantees.eachLayer(...)` synchronously at top level — it runs before the features
exist and silently yields an empty map.

`data/Grantees.geojson` may contain features with `geometry: null` (orgs not yet geocoded).
Leaflet's `geometryToLayer` returns `null` for them and `addData` skips them — they do NOT crash
the load; only the Point features render. Keep null-geometry rows in the file as a geocoding
to-do list (QGIS shows them in the attribute table).

### Marker clustering (`maxClusterRadius`)
`clusters_Grantees = L.markerClusterGroup({ maxClusterRadius: 25, spiderfyOnMaxZoom: true, showCoverageOnHover: true, iconCreateFunction: … })`.
- **The radius is SCREEN PIXELS, not metres.** A point joins a cluster when it is within that many px of
the cluster's centre at the current zoom, so the ground distance it covers halves with every zoom level —
50 px is a few hundred metres at z13 in Kathmandu and tens of metres at z16. State it in pixels when the
user asks "how much is the cluster distance".
- The user tuned it 50 → 25 for "more individual pins": at 25 the startup view showed 10 pins + 8 clusters
  where 50 gave 7 + 7. Raise it to group more, lower it to split more; a zoom-dependent function
  (`function(zoom){ return zoom > 15 ? 20 : 50; }`) or `disableClusteringAtZoom` are the next knobs.
- **Verify cluster changes by reconciling counts, not by eye:** every geocoded org is rendered exactly
  once, so `pins + Σ(cluster label numbers)` must equal the org-with-geometry count (36). Assert that, and
  that a cluster still hovers/opens its member cards (`bio_details_generator` per member) wherever clusters
  remain — a radius change must not break the popup path.

**Two `S_N` rows can be ONE organization** (same CFUG, identical coordinates, one row per grant —
the source coordinate sheet lists one row per grant). Fold the duplicate onto the surviving `S_N`
with `SAME_ORG = {duplicate: keep}` + `canonical_org()` in BOTH `consolidate_grantees_attributes.py`
and `make_geocsv.py`, and DELETE the duplicate FEATURE from `Webmap/data/Grantees.geojson` — leaving
it renders a second pin with no attributes. Org/pill/pin counts then drop by one while money totals
stay identical (assert that). Ask which row survives before merging: the survivor's base
`Type_of_Grant` decides which grant-type pill still matches. Recipe:
`references/attribute-data-consolidation.md`.

The map now needs HTTP for EVERYTHING: boundaries use `fetch`, grantees use the ajax plugin.
**`file://` shows no grantees AND no boundaries** — always serve over HTTP to verify.

## Boundary overlays (added after AGENTS.md — keep AGENTS.md in sync)
Five committed GeoJSON boundary layers wired in `Webmap/js/map.js` (one IIFE near the end):
District (77 feats — styled per-feature by `project_area`: `'y'` (13, project area) → highlighted green
#27ae60 fill @ 0.5 + dark-green stroke; `'n'` (64) → dimmed blue #3388ff fill @ 0.04, stroke-opacity 0.35),
Province (7, orange #e67e22), Local Level (33 feats, `data/projectLocalLevels.geojson`, bright yellow #ffd400 stroke 3, dashArray
'7 4', fill @ 0.06 — yellow+dashed because thin purple vanished over the satellite basemap; always
labelled **Local Level** in the UI, never `projectLocalLevels`),
Chure (1, green #27ae60, the Terai/Chure belt),
Nepal (1, white #ffffff, always added to the map on load).
- Loaded via `fetch`, NOT embedded globals — **they only appear when served over HTTP;
  opening `index.html` via `file://` silently shows no boundaries.** The Grantees layer
  still works on file:// (it uses the embedded `var json_Grantees`).
- **Startup canvas (user rules):** base layer is `No background` so the light-green `#map` background (`#e8f5e9`, one CSS declaration on `#map`) shows; Satellite (Esri) and OpenStreetMap stay selectable in the switcher but are NOT added on load. **Above z12 the satellite turns itself on, at ≤12 it turns off** — one `map.on('zoomend')` handler that adds/removes `layer_EsriImagery` against `empty_baseLayer`; `L.control.layers` re-ticks its own radio off the `layeradd`/`layerremove` events, so never hand-sync the switcher. Verify the threshold with the row-zoom as a known anchor (it lands exactly at z13, so the satellite must already be on there): one zoom-out to z12 must clear every `img.leaflet-tile` and zooming back to z13 must bring them back. Implement the empty base as `L.gridLayer({})`, never `L.tileLayer('')` — the blank tileLayer still spawns a screenful of tile elements (bogus requests for the page itself) even though nothing paints. Assert both sides of that judgement: `img.leaflet-tile` count 0 on startup, and > 0 after clicking `Satellite (Esri)` in the switcher (proves the base-layer choice still works).
- **The startup fit must leave the east edge clear of the floating legend** (user: the legend was blocking the east side on startup). `setBounds()` does `map.fitBounds(bounds_group.getBounds(), { paddingBottomRight: [200, 0] })` — 200px reserved on the right (~the collapsed right panel plus the 190px legend) shifts the fitted content left by half of it and zooms out a hair. Measure `window.layer_Grantees`-free (it is closure-scoped): the east-most `.org-pin-wrap`/`.grantee-cluster` right edge must sit left of `.commodity-legend`'s left edge with zero markers intersecting the legend rect; on the un-padded build markers sat ~67px underneath it.
- No zoom auto-toggle anymore — District/Local Level/Province/Chure are toggled manually via checkboxes in
  the top `#granteeFilterBar` pill bar (District/Province/Chure default ON, Local Level default OFF). Nepal and
  the Organizations (grantee marker) cluster layer are ON by default.
- Panes: District z410, LocalLevel z415, Province z420, Chure z425, Nepal z430 — all below `pane_Grantees`
  (z650) so points stay on top.
- **Adding or restyling a boundary layer = ONE object in the `specs` array** (the IIFE near the end of
  `js/map.js`). That array is the single source: `createPane`, the `fetch`, `layerControl.addOverlay(layer,
  spec.label)` (THE LAYER SWITCHER), the per-feature `style`/`styleFn`, and the click-overview wording. Three
  touch points: (1) add the pane to the `createPane` list + a `zIndex` line; (2) the `specs` entry —
  `varName` `json_<Name>`, `layerVar` `layer_<Name>`, `url`, `label` (the UI name), `pane`, `color`/`weight`/
  `fillOpacity`; (3) after `Promise.all`, a `var <name> = window.json_<Name>.features.length` plus a
  `gf-boundary` pill with `data-layer="layer_<Name>"`. Default-OFF = do NOT `addTo(map)` in the fetch and do
  NOT mark the pill `checked`. Label it with a human name, never the filename (user rule:
  `projectLocalLevels.geojson` → "Local Level").

## Collapsible panels — moving a panel to a new screen edge
Three panels: `#leftPanel` (Grantees list), `#rightPanel` (Details / `#aggregate`),
`#bottomPanel` (Aggregate charts). All default-COLLAPSED; each rides a persistent
edge-toggle button (child of `.map-panel`). **The `left-panel` / `right-panel` /
`bottom-panel` CSS classes do NOT match the panel's screen position** — they are
static identifiers on the div. The actual geometry is driven by the `#rightPanel` /
`#bottomPanel` / `#leftPanel` id rules. So when the user wants a panel moved to a
different edge (e.g. "Aggregate on the right, Details at the bottom"), you must remap
THREE independent mechanisms together — missing any one leaves the panel in the wrong
place or its toggle button dangling:

1. **`#id` geometry** in `<style>` (`#rightPanel`, `#bottomPanel`, `#leftPanel`): set
   `top/left/right/bottom/width/height` for the new position.
2. **`.map-panel.<class>.collapsed` transform**: the off-canvas slide. `.left-panel`
   slides `translateX(-100% -10px)`, `.right-panel` must slide the way the panel now
   leaves the screen (e.g. bottom panel → `translateY(100%+10px)`), `.bottom-panel`
   similarly (e.g. right panel → `translateX(100%+10px)`). The base `.map-panel.collapsed`
   rule is just a fallback.
3. **`.<class> .panel-toggle-btn` placement** + **`togglePanel()` arrow glyphs** in
   `index.html`: the button must protrude from the panel's NEW screen-facing edge
   (left-panel→right, bottom→above, right→left), and the arrow char (`›‹` vs `⌃⌄`)
   must match the new slide direction.

After moving, verify computed `getBoundingClientRect()` of each panel over HTTP
(see `references/panel-layout.md` for the exact probe + the hover-popup pattern).
Panel HTML ids/classes stay the same; only css/transform/toggle logic changes.

**The legend lives on the LEFT and rides the LEFT panel (user rule — it used to follow the right panel).**
`#commodityLegend` is NOT a child of any panel — it is a `position:fixed` overlay whose `left`/`bottom` the
JS sets from the LEFT panel's state only:
`legend.style.right = 'auto'; legend.style.left = ((leftCollapsed ? 0 : leftPanel.offsetWidth + 10) + 10) + 'px'`
→ `left:10px` while the left panel is collapsed, `300px` while it is open; `bottom` stays
`bottomCollapsed ? '20px' : '360px'`. Toggling the right or bottom panel must leave the legend's `left`
UNCHANGED — assert that, it is the regression the user reported. The CSS default has to agree or the first
paint jumps: `.commodity-legend { left: 300px; right: auto; transition: bottom .3s ease, left .3s ease }`.
`togglePanel()` already calls `updateLegendPosition()` for every panel, so no new wiring. The left panel's
toggle tab cannot trap it: the tab sits near the panel's vertical centre (~y435-495) while the legend starts
below it (~y569 at 950px with the bottom panel collapsed), and the legend's DOM node precedes the panels, so
a panel tab always paints above it and stays clickable.

**Getting the Leaflet map instance:** `var map = L.map('map', …)` is closure-scoped, so the global `map`
is the `<div id="map">` (browser named access) — `map instanceof L.Map` is false and `L.map.instances`
does not exist, which makes `invalidateSize()` helpers throw on every panel toggle. Anchor on a layer you
hold instead: `(window.layer_Nepal && window.layer_Nepal._map) || (window.clusters_Grantees && window.clusters_Grantees._map)`.

**The zoom LEVEL is not readable from a probe either** (same closure), so never assume it: anchor on an
action whose zoom you control — the left-panel row click lands on exactly `z13` — then step the map ±1
with `.leaflet-control-zoom-in/-out` and assert the behaviour flips one step BELOW the anchor and back
one step ABOVE it. Read the two observables that ARE in the DOM: `img.leaflet-tile` count and the
`.leaflet-control-layers-base input:checked` radio. Assert both directions (in and out) — a one-way
check passes on a handler that never turns the layer back off. Recipe + re-runnable probe:
`scripts/probe_map_chrome.js`.

**Do not assume those layer globals exist** — `window.clusters_Grantees` / `window.layer_Grantees` are
undefined in the current build, so a probe that reaches for `._map` throws instead of returning a
map. When you need the map (or an unclustered pin) and no global exposes it, drive the DOM: dispatch
clicks on `.grantee-cluster` until `.org-pin-wrap` appears (recipe in
`references/leaflet-browser-verify.md`).

## Map modes (the `#mapModeTabs` view tabs)
`#mapModeTabs` holds one `.mm-tab[data-mode]` button per view; `setMapMode(mode)` toggles the
`body.map-mode-<mode>` class, ticks `.active`, and re-applies the grantee filter. A mode's own UI is
gated in CSS with `body:not(.map-mode-<mode>) #thing { display: none !important }`.
- **`applyEvolutionFilter()` is the single choke point** (`js/map.js`, exported as `window._evoApplyFilter`):
the mode switch, every filter pill, the legend checkboxes and the commodity Select-all/Clear-all all route
into it, and it is the only place that calls `clusters_Grantees.addLayer/removeLayer`. Add a view by AND-ing
one term into its `show` predicate (e.g. `var womenOk = !isWomenMode || (p.women && p.women.length);`) — never
write a second filter loop. The older `apply()` / `window._granteeFilterApply` (`js/map.js` ~:896-939) is dead
code kept as a fallback; leave it alone.
- **A new view is 2 files and ~6 lines:** a `<button class="mm-tab" data-mode="…">` in the nav, the
  body-class toggle in `setMapMode()`, and the predicate term. No CSS needed if it reuses `.mm-tab`.
- **Evolution mode's "Grant amount (USD)" column is an attribution, not a disbursement schedule.** `renderEvoTable()`
  fills it from `evoAmountByYear()`: each org's total LoA + DBG USD (`moneyBySN`, i.e. the geocsv) booked in the
  fiscal year the org FIRST appears, the same rule the "new grantees" column uses. The years therefore sum to
  the national total (2,288,256 USD) — a nice invariant, and the probe checks it. No served file carries
  per-contract dates (the xlsx's `Service Start/End` is not in the geocsv), so a true per-year disbursement
  figure would need that column exported per contract first; say so rather than implying the column is real.
  Money loads asynchronously, so `renderEvoTable()` re-runs itself once `csvReady` resolves.
- **Persist the active mode in `localStorage['fff.mapMode']`** (written inside `setMapMode`, so the restore
call also persists) and restore by calling `setMapMode(localStorage.getItem('fff.mapMode') || 'overview')` as
the LAST statement of the `attributesPromise.then(...)` block in `data:loaded`. Restoring at script scope runs
before features exist — and before `p.women`/`p.grants` are merged — so the filter no-ops and the map silently
shows everything on reload.
- **Verify a mode by SET, not count** — the rendered orgs must equal (orgs matching the mode's data condition
  ∧ `has_geometry`) and the mode must survive a reload; a bare count passes on the wrong orgs. Recipe:
  `references/leaflet-browser-verify.md` ("Verifying a filter or view mode").
- **User rule — no Python for view data.** New views and aggregations are computed in `js/map.js` /
`js/myFuncs.js` from the `grantees_attributes.json` payload the page already fetches and joins per feature
(`p.women`, `p.grants`, `p.restoration`, `p.subcategories`). A per-org total is a two-line JS sum; do not add
a pipeline script or regenerate the JSON for a view.

### `Map Categories_Final.xlsx - *.csv` are SPEC sheets, not data tables
Each stacks three blocks: the view spec (what to show / how to encode it), a stories block, then the data table
whose header row `parse_women()`/`parse_restoration()` locate. Only rows BELOW that header are parsed, so a
stories block above it is silently dropped (the Women-Led sheet documents 9 stories, 3 of them "Will share once
the story is published"). Two traps when working from these files: the CSV export **drops the xlsx
hyperlinks** (story URLs are nowhere in the repo — ask for the workbook before promising links), and a year
block can **REUSE `S.N`** (the 2026 women block restarts at 12) while its magnitudes shift by orders of
magnitude (6 196 / 1 302 against 20 in 2019-2024) — key by year-block + row order, never by `S.N`, and confirm
the metric before encoding it as a size or a total.

## Verification loop (do this for any UI change)
1. Make the edit. Page markup lives in `Webmap/index.html` (only ~174 lines: markup + tags), page
   styles in `Webmap/css/map.css`, all page logic in `Webmap/js/map.js` (23.0: these were split out of
   index.html — a pure move, bodies byte-identical). `Webmap/js/myFuncs.js` holds the card/pin builders.
   **`js/map.js` must stay a plain `<script src>` — never add `defer`**: every vendored lib in this page
   is deferred, so a deferred copy would execute after them and change order. **A qgis2web re-export
   rewrites `index.html` and undoes the split** — re-apply the move afterwards.
   To re-do or extend the split: locate the blocks by `line.strip() == '<style>'` / `'<script>'`
   (the file is CRLF — an exact `lines.index('<style>')` silently fails), slice the body, `cmp` it
   byte-for-byte against the pre-split copy, and replace with `<link>` / `<script src>` **in the same
   position**. Editing these CRLF files with a patch tool: never put a `'\r'` escape inside a replacement
   string — it lands in the file as a REAL CR, splitting the literal across two lines (`node --check`
   catches it, an editor may not); write `String.fromCharCode(13)` instead, and re-run
   `node --check js/map.js` after every patch batch.
2. Serve over HTTP — `python3 -m http.server 6115 --directory Webmap` → `http://localhost:6115`.
   Check `ss -ltnp | grep 6115` first: a stale `http.server` from an earlier session keeps the
   port and serves the OLD copy (your edit looks missing, data URLs 404). **Never verify
   boundary overlays via `file://`.**
   Verify with the headless Playwright harness (Chromium already installed):
   `cd ~/pw-check && node verify_web_ui.js` — edit its CONFIG for app-specific assertions;
   exits non-zero on real console/pageerror (benign `polyfill.io` + tile-abort noise filtered).
   Map chrome (startup base layer + light-green canvas + boundary pill defaults + the zoom-driven
   satellite swap + filter-bar collapse-on-outside-click) has its own probe: `scripts/probe_map_chrome.js`.
   Hover behaviour has its own probe in this skill: `scripts/probe_hover.js` (cluster popup →
   collapsible closed cards with the org name as `<summary>`, marker popup → full card, popup still
   open after the pointer moves inside it); copy it to `~/pw-check` and run with `node` — it exits
   non-zero on any page error or failed persistence check. `scripts/biogen.js` prints the card
   generator HTML for a fixed synthetic feature; diff/md5 it before and after any `myFuncs.js`
   refactor to prove `bio_table_generator` output is unchanged.
   `browser_exec` is NOT the route on this host: it needs an installed Chrome plus the user
   clicking "Allow remote debugging", and no Chrome is installed.

   **Cache pitfall (bit me):** the long-lived headless-Chrome profile caches `myFuncs.js`
   (and other sub-resources), so after editing `myFuncs.js` the browser keeps running the OLD
   function — `index.html` inline changes show up but `myFuncs.js` changes silently don't.
   Before verifying, disable the cache over CDP and reload:
   `cdp('Network.enable'); cdp('Network.setCacheDisabled', cacheDisabled=True); goto_url(...)`.
   Confirm with `js("bio_table_generator.toString().indexOf('NEW_STRING') >= 0")` before
   trusting any details-panel check.
   **A failing probe is guilty until proven innocent — validate the probe before touching app code.**
   Three false negatives in one session, all measuring the wrong thing: hovering the *tooltip* instead of
   its marker (measure `getBoundingClientRect()` of the element you actually meant and print its
   class/tag); an "outside click" at a coordinate that landed on a pill INSIDE the expanded filter bar
   (dump the click's `e.target` first); and selecting a list row by searching a term that matched nothing,
   which clicked the "No matching records found" placeholder row (guard with `.dataTables_empty`, and note
   the app itself needed the same guard). Print the DOM you measured — if the code and the probe disagree,
   the probe is the cheaper suspect.

3. Confirm it rendered (see `references/leaflet-browser-verify.md`): layout fill ~full;
   overlay path counts per pane (District 77 / Local Level 33 / Province 7 / Chure 1 / Nepal 1 — toggle the
   `#granteeFilterBar` checkboxes first, since Local Level starts off; District/Province/Chure and Nepal start on);
   pane class is `leaflet-pane_<Name>-pane`, not `.pane_<Name>`. The user rejects "done"
   without proof it renders. Confirm before reporting success.

   **Diagram/flow docs render headlessly too:** `node scripts/render_md_flow.js <file.md> <out.png>`
   (copy it to `~/pw-check` — it needs a static server on the URL it names, default :6118). Set
   `flowchart: { useMaxWidth: false }` in `mermaid.initialize` or the SVG gets `width:100%` and collapses
   to the ~300px default replaced-element box: it still reports `PARSE_OK` and writes a PNG, just a
   300×251 unreadable one (a real render of a 44-node flow is ~2500×2100). Always print the SVG's pixel
   size and check it is in the thousands before believing the render. Then check the CONTENT the same way you
   check code: extract every filename the diagram names and `ls` it — a generated flow invents plausible
   siblings (`Grantees.combined.csvt`, a `.vrt`), and a diagram is documentation the next reader trusts.

## Two skill copies — keep them identical
This skill exists twice: global `~/.hermes/skills/web-mapping/fao-fff-grantees-map/` and in-repo
`Webmap/.hermes/skills/fao-fff-grantees-map/`. After editing either, `diff -rq` the two and copy
the newer tree over the older. `Webmap/.gitignore` ignores `*.md`, so new in-repo reference files
land untracked, and the repo's `.gitignore` additionally lists `.hermes/` — plain `git add` REFUSES an
ignored path even when the file is already tracked, so stage skill edits with `git add -f <path>` (they
stay tracked until explicitly `git rm --cached`). Other agents (e.g. opencode) edit this repo
concurrently: committed work appears without you, and a dirty working tree can get swept into
someone else's baseline commit. Before syncing or copying anything, re-check `git status` and
`diff -rq`, and use `git log -S '<marker>' -- <path>` to find which commit carries a change
instead of assuming yours is still uncommitted.

## Grantee filters + details panel (sourced from grantees_attributes.json)
The Commodities filter and the right Details panel read CSV-derived attributes merged onto each
feature at render time (in `js/map.js`, inside `layer_Grantees.on('data:loaded', …)` →
`attributesPromise.then(...)`), NOT the free-text `Commodities` string on the geojson:
- Merge step builds `grantsByOrg`/`restorationByOrg`/`womenByOrg` keyed by `String(org_id)`, then
  attaches to each feature: `grants[]`, `restoration[]`, `women[]`, `subcategories[]` (unique),
  `enterprise_classifications[]` (unique), and aggregates `people_benefited`, `area_direct_ha`,
  `area_contributed_ha`.
- **Commodities filter** now uses `subcategory` (clean values from `grants[].subcategory`, e.g.
  Dairy / Timur / Bamboo / Vegetables; ~11 distinct on-map) instead of the ~35 free-text
  `Commodities` strings. A marker matches when ANY of its `subcategories` is checked
  (`p.subcategories.some(...)`), so multi-grant orgs filter correctly.
- **The filter bar collapses when the user clicks outside it (user rule).** `#granteeFilterBar` opens only
  via `#filterToggle`; a document-level `click` handler calls the same `toggleFilters()` when the click
  landed outside `#filterBarWrap` and the bar is not already `collapsed`. Keep the early return for clicks
  INSIDE the wrapper (pills, search box) so ticking several pills does not close the bar mid-task — the
  toggle button lives inside the wrapper, so it never double-fires. Assert three ways: open → click a pill
  (stays open) → click the map or the legend (collapses, label back to `Filters ▾`, `aria-expanded=false`).
- **Details panel** (`bio_table_generator` in `Webmap/js/myFuncs.js`) renders a `👩 Women-led`
  line directly under the organization name (only when `women[]` is non-empty — user rule: women-led
  is headline info, not a footnote), Enterprise Classification, then **two rows: `Timeline` (the
  grants' `implementation_period`, one line each) and `Grants` (titles only)** — never one row mixing
  title + period + `classification · commodity`, because both the classification and the commodity
  already appear in the rows above (user: "the line after time seems redundant") — then Restoration
  (direct + contributed ha, people benefited, by year block) and the Women-led detail records.
- **Hover content differs by target — but both use the SAME card style (user rule).**
  Individual marker hover → `bio_table_generator(feature)` (full card). Cluster hover →
  `clusterOrgCardsHTML(cluster)` → one `bio_details_generator(feature)` per member: native
  `<details>/<summary>` with the organization name in the summary and every other field inside the
  collapsible. Never hand-write per-member markup, and never ship a cluster variant that shows
  names-only or plain detail tables — the user rejects a cluster popup whose style differs from the
  marker popup, so route BOTH through the shared generators in `js/myFuncs.js`.
- **Refactoring the card generators.** `bio_detail_rows(p)` holds the `<tr>`s from Location onwards
  and is shared by `bio_table_generator` (individual hover) and `bio_details_generator` (cluster).
  `bio_table_generator`'s output must stay BYTE-IDENTICAL across such a refactor — prove it by
  md5-ing the sections `scripts/biogen.js` prints before and after, not by eyeballing a popup.
- **One shared floating popup.** `index.html` keeps one `.info-hover-popup` `<div>` on `body`, shown
  on point `mouseover` and cluster `clustermouseover`, hidden on `mouseout`/`clustermouseout`. The
  same HTML goes into `#aggregate` and the popup, so panel and box never diverge; position it clear
  of the bottom/right panels (see `references/hover-popup-positioning.md`).
- **The popup must survive the pointer travelling into it (user rule).** `.info-hover-popup` needs
  `pointer-events: auto`, a `popupHovered` flag, and a DEFERRED hide: `hideHoverPopup()` returns
  early while hovered, otherwise clears the box after ~250 ms on a timer that `mouseenter` cancels.
  Mechanism: the marker's `mouseout` fires BEFORE the popup's `mouseenter` across the 18 px gap, so
  an immediate hide destroys the box mid-travel — and any clickable content in it (`<details>`
  summaries) becomes unusable.
- See `references/panel-layout.md` for the verified panel-remap + hover-popup recipe and the
  `getBoundingClientRect` probe used to confirm geometry after a move.

### Marker + popup styling (user rules)
- **The popup must look like the legend, not like bootstrap.** `.info-hover-popup` shares the
  `.commodity-legend` tokens — `font: 11px/13px Arial…`, colour `#1a3c5e`, `border-radius: 8px`,
  `box-shadow: 0 4px 18px rgba(0,0,0,0.32)`, `padding: 6px 10px` — and its labels read as legend headers
  (`bold 12px #0070b6` over a 1px `#ced4da` underline; bootstrap's `.text-muted` is `!important`, so it needs
  an `!important` override for the "Cluster — N organizations" line). Popup tables are SINGLE-COLUMN:
  `table tr/th/td { display: block }` so a long grant title gets the whole 300px box instead of a narrow value
  column. Align any new floating box to the legend by MEASURING both with `getComputedStyle`
  (font/colour/radius/shadow/padding), never by eye — details, the stale-selector trap and the
  bootstrap-gutter fix are in `references/hover-popup-positioning.md`.
- **Multi-commodity pins:** 1 commodity → one 32px `.commodity-pin` circle; 2 → ONE circle split half/half
  (90deg `linear-gradient` of the two colours + two emoji spans clipped with
  `clip-path: inset(0 50% 0 0)` / `inset(0 0 0 50%)`, `iconSize [32,32]`, `border-color: transparent` so the
  gradient fills the ring); 3 → the mini-pin stack. `isStack = capped.length > 2` in `style_Grantees_div_icon`,
  icons/colours in `COMMODITY_ICON`/`COMMODITY_COLOR` — see `references/marker-tooltips-labels.md`.

### Panel typography (user rules)
Panels take their FONT FAMILY and text colour from the legend, but NOT its size — 11px is rejected for
panel content. Current target for `#leftPanel`:
- family/colour = legend tokens (`Arial, Helvetica, sans-serif`, `#1a3c5e`), size **15px/18px** (the
  user's explicit number), `.panel-header` 16px/19px bold `#0070b6`, `table td/th` padding `3px 5px`.
- Scope it with `#leftPanel, #leftPanel * { font-family: … }` plus ID-scoped size rules that list the
  bootstrap classes hard-coding their own size (`.form-control`, `.btn`, `.dataTables_wrapper`,
  `.dataTables_info`, `.dataTables_paginate`, `table th/td`, `label`, `input`, `select`, `button`) —
  bootstrap sets 14-16px on those, so setting the size on `#leftPanel` alone does not reach them.
  ID specificity already beats bootstrap's classes: check before adding `!important`, and it is not
  needed (this app uses none for panel fonts).
- When the user says "make X follow the same font as Y", copy family + colour + line-height from Y and
  EXPECT a separate size instruction — they will give the number ("make font size 15px"). Never silently
  adopt the reference's size, and never shrink text to stop wrapping: at 15px in the 280px panel long
  org names wrap to 2-5 lines (~42px rows, ~5-7 rows before scrolling), which the user accepted. The
  options to offer instead are a wider panel or one-line ellipsis truncation with a `title` tooltip.
- Verify with `getComputedStyle` on the panel, `.panel-header`, `td` and the search `input`, plus
  `scrollWidth - clientWidth` on `.panel-content` for horizontal overflow (must be 0), not by eye.
- **A deliberately white-on-colour element inside a restyled panel WILL go dark.** An ID-scoped `color:`
  on `#leftPanel button` / `.btn` outranks the tab's own rule, so the "‹ Grantees" collapse tab lost its
  white text on the blue background and had to be re-asserted at the END of the block:
  `#leftPanel .panel-toggle-btn, #leftPanel .panel-toggle-btn * { color: #ffffff; }`. After ANY panel
  typography/colour change, re-check every element that should stay light-on-dark by diffing computed
  colours against the previous build (recipe in `references/leaflet-browser-verify.md`).

### Left panel list: fill the column, scroll — never paginate (user rules)
- The panel must FILL its column: `#leftPanel { top:80px; bottom:100px; max-height: calc(100vh - 180px); }`.
  Left at `bottom:auto`/content height it stops mid-screen and the user reports "there is empty space at
  the bottom of the left panel"; left under the shared `80vh` cap it fights the vh-derived table height
  and the pagination ends up a few px outside the panel.
- `.panel-content { flex: 1 1 auto; min-height: 0 }` so the list fills the panel, and size the table body
  with the same arithmetic: `"scrollY": "calc(100vh - 375px)"` (≈30px of slack under the panel's
  `calc(100vh - 180px)`).
- **Overflow only, no page numbers:** `dom: 'f<t>'` (the trailing `p` is what renders the pagination
  footer) with `"paging": false`, dropping `pageLength`/`pagingType`. All orgs then sit in one scrollable
  list under the search box; the row-click handler that fills `#aggregate` is unaffected. Guard that
  handler with `if (!data) { return; }`: `table.row(this).data()` is `undefined` for the
  "No matching records found" placeholder row, so clicking an empty search result throws
  `Cannot read properties of undefined (reading '1')` (pre-existing, found by probing the empty state).
- Verify at several window sizes (1400×900, 1280×750, 1600×1200): panel bottom = viewport − 100,
  `.panel-content` `scrollHeight - clientHeight` = 0 (exactly ONE scrollbar), `.dataTables_paginate`
  count 0, row count = org count, and the search box still filters the list.

## Aggregate panel charts + boundary-click scoping
`#rightPanel #tab-aggregate` creates the Chart.js instances in one IIFE. **`#chartPie` (Type of Grant) and
`#chartBar` (Commodities) are created with EMPTY arrays and were never fed any data**, so they render nothing
until you wire them up; `#chartSankey` is a "No grant flow data yet" placeholder although `d3.sankey` IS
vendored and ready.
- **The panes stack `Nepal(430) > Chure(425) > Province(420) > LocalLevel(415) > District(410)`, so
  per-polygon click handlers never fire for a district** — a click anywhere lands on the top layer (Nepal
  covers the country). Ship ONE `map.on('click')` + `scopeCandidateAt(latlng)` that point-in-polygon tests
  the FINEST VISIBLE layer first (`layer_LocalLevel → layer_District → layer_Province`, skipping layers not
  on the map). That single rule also makes a province scopeable: turn the District pill off and the province
  becomes the finest visible layer. Guard clicks that landed on a marker/tooltip/control
  (`ev.originalEvent.target.closest('.leaflet-marker-icon, .leaflet-tooltip, .leaflet-popup, .leaflet-control')`)
  and `clearScope()` when a click matches no boundary. Clicking the same polygon twice toggles the scope off.
- **Membership comes from GEOMETRY, not names.** The attribute names are too dirty to join on: of the 36
  rendered orgs only 23 carry `district`, 26 `municipality`, 27 `province`, and spellings vary
  (`Makawanpur` vs `Makwanpur`, 13 blank districts). Leaflet has no point-in-polygon helper — write one
  (ray casting) and normalise `getLatLngs()` first: a Polygon returns `[[ring]]`, a MultiPolygon `[[[ring]]]`.
  Test exterior rings only (these boundary files have no holes) and name that ceiling in a comment.
- Boundary property names / traps: District → `properties.DISTRICT` (UPPERCASE; 77 features = every Nepal
  district, so a pin always resolves); Local Level → `properties.GaPa_NaPa` + `DISTRICT` + `Type_GN` (only 33
  project-area palikas, so palika labels fall back to the attribute); Province → `properties.Province` is
  **MIXED numeric codes and names** (`1, 2, 5, Bagmati, Gandaki, Karnali, Sudur Pashchim`) — never label from
  it, use `p.province` or a 7-entry code→name map.
- Chart dimensions per feature: `p.Type_of_Grant` (`LoA`/`DBG`) and `p.subcategories` (the same clean values
  the Commodity pills filter on — not the free-text `Commodities` string). The render join must first COPY
  `district`/`province`/`municipality` from `orgs[]` onto `p` — it never did; without that there is nothing
  to fall back on for labels.
- Sankey, as shipped: **FFF → Province → District → Palika**, one unit per organization (province from the
  attribute, district from point-in-polygon, palika from `municipality` with an honest `Unassigned` node).
  It is drawn at a **fixed 620x380** (not the panel's ~310px) inside `.sankey-wrap { overflow-x: auto }` —
  the only CSS this feature needed; at panel width four levels of Nepali place names were unreadable
  (verified with screenshots). Levels are capped (top-12 districts / top-12 palikas + `Other …`) and the
  **palika column is drawn only when a district/palika is in scope** — nationally it was 13 one-org nodes
  of noise. No `append('title')` tooltips: they are unclickable inside `pointer-events` panels.
- **User rule — the right panel DOES auto-open when a polygon is clicked**, the deliberate exception to
  "panels never auto-open on interaction": the whole point of the click is the panel content. Pins are never
  hidden by a polygon click — the click scopes the PANEL only (`#aggOverview` + all three charts + the
  sankey; nothing filters the markers).
- Shipped scope implementation (`js/map.js`): `polyRings` / `pointInRings` (ray casting, exterior rings),
  `markersIn(layer)`, `districtOf(latlng)`, `renderAggregates`, `renderInvestment`, `renderSankey`,
  `setScope` / `clearScope` / `scopeCandidateAt`, and `showOverview` now just delegates to `setAggOverview`.
- Three traps that cost real debugging time:
  - **`window.chartInvestment` is the `<canvas>` element** (browsers expose `id` attributes as globals) until
    a `Chart` instance is assigned, so `if (window.chartInvestment)` is TRUE before the chart exists and
    `window.chartInvestment.data.labels = …` throws. Guard with `window.chartInvestment && window.chartInvestment.data`.
  - **d3-sankey throws `circular link`** when a node name repeats across levels — `Unassigned` is a real
    province AND district AND palika value here. Key nodes by level (`'L1' + SEP + name`) and keep the display
    name separate.
  - **A Chart.js dataset with no `backgroundColor` paints the default translucent BLACK** — the LoA/DBG pie
    showed two black slices and the user reported it as a broken chart. Always pass colours, keyed by LABEL
    rather than array index when the label order comes from data:
    `var TYPE_COLOR = { 'LoA': '#0070b6', 'DBG': '#e67e22' }` → `typeKeys.map(k => TYPE_COLOR[k] || '#9aa7b1')`.
    The LoA/DBG breakdown is shown BOTH ways on purpose (user asked for the bar "as well"): the `#chartPie`
    pie and a `#chartTypeBar` bar directly under it, both fed from the same `renderAggregates` `type` map and
    the same colour map so they can never disagree — update both in one place.
