---
name: fao-fff-grantees-map
description: Edit the FAO FFF grantees Leaflet web map.
---

# FAO FFF Grantees Web Map

Trigger skill for editing the FAO FFF Nepal grantees Leaflet map at `/home/ubentu/ssd/baato/FAO/FFF`.

**Standing rules:** prove every UI change in a browser over HTTP before reporting done; leave edits
UNCOMMITTED and report the touched paths — commit only when the user explicitly says so. Other agents
edit this repo concurrently, so a dirty working tree can be swept into someone else's commit.
**Every UI ask ships with its probe assertion in the same pass** — add/extend a file under `Webmap/tests/`
(or a `scripts/probe_*.js` here) that fails if the rule is broken, because the user reports the NEXT
violation of the same rule rather than re-reading the code: an unasserted rule (hover must not write the panel,
one entry per row, panel defaults, column order) is the next regression report.
**Undo:** an app- or chat-level undo does NOT touch files — start with `git status` and say plainly what is
still on disk. When the tree holds several logical changes stacked on one commit, `git checkout` / `git reset`
can only restore a WHOLE file, so ask which scope the user means (last change vs everything) and otherwise
hand-reverse the specific edits; never reset the tree to satisfy "undo" without confirming the scope.
**Describe a proposed check by what it ASSERTS and how** (tool + assertion + the failure it catches), never
by artifact name alone — a plan line like "a new probe_x.js" comes straight back as "what do you mean by
that", and the round-trip costs more than the sentence.

**CSS state rules must match the block's specificity.** When the base rule sits behind an ID (`#leftPanel …`,
`#bottomPanel …`), every state variant on top of it (`.checked`, `.collapsed`, `.is-open`) must carry the ID
too: two classes lose to one ID, so the state silently never applies — a greyed-out "checked" pill and an
in-flow panel that ignored `collapsed` both cost a debugging round. Verify a state by `getComputedStyle`,
never by `classList`.

**Base conventions, layout, data pipeline, and pitfalls live in `AGENTS.md` (repo root) —
read that first.**

**File map (post-split):** `Webmap/index.html` is markup + script/link tags only (~174 lines); page CSS
lives in `Webmap/css/map.css` and ALL page JS in `Webmap/js/map.js`. Wherever this skill or AGENTS.md still
says `index.html` or quotes a line number for page logic, read it as `js/map.js` — the code moved there
unchanged, in the same order.

**AGENTS.md was rewritten 2026-09-14 and is current** (split files, deterministic row zoom, the single-source
geocsv pipeline, simplified boundaries, `tests/`, `tools/`). If a claim here and AGENTS.md ever disagree again,
re-read the code before trusting either — a fix applied in code but left stale in the docs is how a regression
gets re-introduced. The `.csvt`/`.vrt` writers are gone for good (deleted from `make_geocsv.py`); QGIS/GDAL open
the tracked `Grantees.combined.csv` copy and the page fetches the `.geocsv`.

**What the browser loads** — the grantee layer has exactly ONE data fetch: `data/Grantees.combined.geocsv`,
plus the five boundary geojsons (**simplified**: 29 MB → 2.6 MB, page 30.1 MB → 4.4 MB, 36 markers in ~0.8 s
instead of ~1.6 s; originals live in the unversioned `../boundary-src/`, and `tests/boundary_pip_check.py`
fails if a boundary rebuild moves a pin to another district). `data/grantees_attributes.json`,
`data/investment_by_enterprise.json`, `consolidate_grantees_attributes.py` and `summarise_investment.py` are all
**retired/deleted** — do not reintroduce them. `data/Grantees.geojson` still sits on disk as a *pipeline input*
(`tools/make_geocsv.py` reads it; the geometry is hand-maintained there) but the page never fetches it.
The pipeline now lives INSIDE the repo (`Webmap/tools/make_geocsv.py`, run `cd Webmap && python3 tools/make_geocsv.py`)
and so do the probes (`Webmap/tests/`, `README` inside, run with `node tests/probe_geocsv_source.js` etc. after
`npm i --no-save --no-package-lock playwright && npx playwright install chromium`). `.github/workflows/verify.yml`
runs the whole set on every push — a red probe now blocks nothing by itself, so read the Action result.
**Run the whole suite in one pass and report the FAIL count per file** (each probe exits non-zero, but the file
list is the useful part): `cd Webmap && for f in tests/*.js; do printf '%-36s ' "$f"; timeout 220 node "$f"
2>&1 | grep -cE '^FAIL' | sed 's/^/FAILS=/'; done` — `measure_load.js` prints instead of asserting, so it is
always 0.
- The geocsv carries geometry too (`WKT` POINT per row; `X`/`Y` can be blank, WKT is what the page parses), so
  one file answers "where is it", "what is it" and "how much money".
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
- **Record arrays, not counts.** `make_geocsv.py` writes `women_json` / `restoration_json` (the
  `parse_women` / `parse_restoration` record lists) next to the old count columns
  (`women_records_org`, `restoration_records_org`, `area_direct_total_org`, …), so the details card, hover
  popup and women-led mode need no second file. `grants[]`, `subcategories[]` and
  `enterprise_classifications[]` the browser derives from the grant rows (one row = one grant).
- Counts to expect: 79 rows, 68 distinct `S_N`, 36 with coordinates, 73 grant rows, **22 women / 61
  restoration records**. The retired JSON had 23 / 70 across 77 orgs — the 10 missing records belong to
  synthetic `A7–A15` orgs that exist only in the women/restoration CSVs and therefore have no row (no
  coordinates, no grant): nothing the map renders lost data. `probe_geocsv_source.js` pins this.
- `make_geocsv.py` is the whole pipeline now (`consolidate_grantees_attributes.py` was retired with its
  outputs). Its Registry/ALIASES is copied from that script; if a name fails to resolve it becomes a synthetic
  `A*` org — always read `data/unmatched_orgs_geocsv.txt` after a rebuild.
The pipeline in one diagram: `Webmap/DATAFLOW.md`.

This skill additionally documents the boundary-overlay behavior and the
browser verification recipe (see `references/leaflet-browser-verify.md`), which AGENTS.md
does not yet cover — keep AGENTS.md in sync after map changes.

## When to use
- Editing grantee data, markers, popups, the info panel, the filter, or basemaps in this repo.
- Editing the Grantees data layer (`data/Grantees.combined.geocsv`) or its load wiring in `js/map.js`.
- Editing the District/Local Level/Province/Chure/Nepal boundary overlays or the `#granteeFilterBar` toggle pills.

## Grantee data layer (single source: `data/Grantees.combined.geocsv`)
The grantee points are neither an embedded JS blob nor an async GeoJSON file. `js/map.js` creates the layer up
front with `L.geoJSON(null, { …same options… })`, fetches the geocsv ONCE, groups the rows by `S_N` (org
properties + `grants[]` + `women[]`/`restoration[]` + per-org money from the same row), turns each org with a
`WKT` POINT into a Feature, then `layer_Grantees.addData(features)` and `layer_Grantees.fire('data:loaded')`.

**The old hard rule is superseded** — "load grantees with the Leaflet-ajax plugin, never a raw fetch" was the
user's rule while the data was a separate GeoJSON; he then asked for exactly the opposite ("use geocsv instead
of the grantees_attributes.json and Grantees.geojson"). `js/leaflet-ajax.min.js` is still on disk but no longer
loaded (`<script>` tag removed); if a qgis2web re-export brings `L.geoJson.ajax` back, re-apply the geocsv
loader instead of "restoring" the plugin.
- The fetch is started before the `data:loaded` handler is registered and the promise always resolves in a
  microtask after the script finishes evaluating, so the handler is in place when `fire('data:loaded')` runs.
  Never move the loader below the builder calls or fire the event synchronously.
- Coordinates come from the `WKT` column, not `X`/`Y` (those are blank on HH-only rows): parse with a small
  `POINT(lon lat)` regex; an org with no `WKT` simply gets no marker (the retired geojson's `geometry: null`).
- Loader recipe, ordering contract and the column table: `references/geocsv-single-source.md`.

Because the load is async, every piece of UI that depends on the grantee features MUST be built
inside `layer_Grantees.on('data:loaded', function(){ ... })`:
- `clusters_Grantees.addLayer(layer_Grantees)` + `addTo(map)` + `setBounds()`
- the `clustermouseover` / marker `mouseover` hover popups (popup only — they must NOT write `#aggregate`)
- the Type-of-Grant filter pills (`buildGranteeFilters()` — they render INSIDE the left "Layers" panel)
- ~~the left-panel DataTable + row-click zoom~~ — REMOVED at the user's request (see "Left panel = the Layers
  panel" below). The old lesson still bites if anyone re-adds a zoom-to-org control: prefer ONE
  `map.setView(layer.getLatLng(), Math.max(map.getZoom(), 13))` and never
  `clusters_Grantees.zoomToShowLayer(layer, cb)` + `setView` in the callback, which races (the callback fires
  mid-animation, re-clustering re-absorbs the pin, same click lands 0–126px off-centre).
  `map` / `clusters_Grantees` live in the closure — `window.map` is the `<div id="map">` element, not the
  Leaflet instance.
Define those as function declarations (hoisted) so they are callable from the callback. Do NOT
iterate `layer_Grantees.eachLayer(...)` synchronously at top level — it runs before the features
exist and silently yields an empty map.

**Verify the source, not just the output.** `Webmap/tests/probe_geocsv_source.js` (run it from `Webmap/` and run
`node probe_geocsv_source.js` against :6115) records every request and asserts
`Grantees.geojson` and `grantees_attributes.json` are NEVER requested, the geocsv is fetched exactly once, the
leaflet-ajax script is not loaded, and the merged result still matches the known numbers (36 orgs, 13 women-led,
2,288,256 USD in both the money chart and the evolution column). Reading the source can't prove a dependency is
gone; only the browser's request log can.

### Marker clustering (`maxClusterRadius`)
`clusters_Grantees = L.markerClusterGroup({ maxClusterRadius: 35, spiderfyOnMaxZoom: true, showCoverageOnHover: true, iconCreateFunction: … })`. **Read the live value out of `js/map.js` before quoting it** — the user tunes it and the docs have lagged behind the code before (50 → 25 → 35).
- **The radius is SCREEN PIXELS, not metres.** A point joins a cluster when it is within that many px of
the cluster's centre at the current zoom, so the ground distance it covers halves with every zoom level —
50 px is a few hundred metres at z13 in Kathmandu and tens of metres at z16. State it in pixels when the
user asks "how much is the cluster distance".
- The user tunes it down for "more individual pins" (50 → 25 → 35). At 35 the startup view is 9 pins + 8
  clusters covering all 36 orgs. Raise it to group more, lower it to split more; a zoom-dependent function
  (`function(zoom){ return zoom > 15 ? 20 : 50; }`) or `disableClusteringAtZoom` are the next knobs.
- **Verify cluster changes by reconciling counts, not by eye:** every geocoded org is rendered exactly
  once, so `pins + Σ(cluster label numbers)` must equal the org-with-geometry count (36). Assert that, and
  that a cluster still hovers/opens its member cards (`bio_details_generator` per member) wherever clusters
  remain — a radius change must not break the popup path.

**Two `S_N` rows can be ONE organization** (same CFUG, identical coordinates, one row per grant —
the source coordinate sheet lists one row per grant). Fold the duplicate onto the surviving `S_N`
with `SAME_ORG = {duplicate: keep}` + `canonical_org()` in `make_geocsv.py` (the only script left), and
DELETE the duplicate FEATURE from `Webmap/data/Grantees.geojson` (**pipeline input**, not served) — leaving
it renders a second pin with no attributes. Org/pill/pin counts then drop by one while money totals
stay identical (assert that). Ask which row survives before merging: the survivor's base
`Type_of_Grant` decides which grant-type pill still matches. Where each column comes from and how the browser
loads it: `references/geocsv-single-source.md`.

The map now needs HTTP for EVERYTHING: boundaries and grantees are both `fetch`-ed.
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
  opening `index.html` via `file://` silently shows no boundaries.** The Grantees layer is `fetch`-ed too
  (the geocsv), so `file://` shows no boundaries AND no markers — HTTP for everything, no exceptions.
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
Three panels: `#leftPanel` (the Layers panel), `#rightPanel` (Aggregate / evolution),
`#bottomPanel` (Details / `#aggregate` + the two sankeys). **The two overlays (`#leftPanel`, `#rightPanel`)
default COLLAPSED; `#bottomPanel` is IN FLOW, open by default at `--bottom-h: 50vh`** (user request — see
"Resizable map / bottom-panel split" below). Each rides a persistent edge-toggle button (child of `.map-panel`). **The `left-panel` / `right-panel` /
`bottom-panel` CSS classes do NOT match the panel's screen position** — they are
static identifiers on the div. The actual geometry is driven by the `#rightPanel` /
`#bottomPanel` / `#leftPanel` id rules. So when the user wants a panel moved to a
different edge (e.g. "Aggregate on the right, Details at the bottom"), you must remap
THREE independent mechanisms together — missing any one leaves the panel in the wrong
place or its toggle button dangling:

1. **`#id` geometry** in `<style>` (`#rightPanel`, `#bottomPanel`, `#leftPanel`): set
   `top/left/right/bottom/width/height` for the new position.
2. **`.map-panel.<class>.collapsed` transform**: the off-canvas slide. `.left-panel`
   slides `translateX(-100% -10px)`, `.right-panel` slides `translateX(100%+10px)`. The base
   `.map-panel.collapsed` rule is just a fallback. **`#bottomPanel` is the exception**: it is in flow, so
   "collapsed" is `#bottomPanel.collapsed { transform:none; height:34px }` (a header-only bar) and it MUST
   be ID-scoped — a two-class selector silently loses to `#bottomPanel`'s own `height`.
3. **`.<class> .panel-toggle-btn` placement** + **`togglePanel()` arrow glyphs** in
   `index.html`: the button must protrude from the panel's NEW screen-facing edge
   (left-panel→right, bottom→above, right→left), and the arrow char (`›‹` vs `⌃⌄`)
   must match the new slide direction.

**The two SIDE tabs are centred on their panel and flush on its edge** (user rules, in order: aggregate must move like Layers; no gap on the left; and they must sit "at the middle of map view at all times"). So `left-panel .panel-toggle-btn` → `left:100%; top:50%; transform:translateY(-50%)` and `right-panel .panel-toggle-btn` → `right:100%; top:50%; transform:translateY(-50%)` — flush on the edge, vertically centred. Do NOT anchor them to `bottom:0`: a panel spans `top:80px` to `calc(var(--bottom-h) + 12px)`, so `top:50%` keeps the tab in the middle of the visible map column while still riding the strip (the panel's height is what changes on a drag). Both tabs land ~34px below the map's own midline at every split — a constant offset that reads as centred. The bottom panel's own tab keeps `top:-30px; left:50%`. **Do not let a panel re-declare `bottom`** — `#rightPanel`'s old hard-coded `bottom:100px` detached it (and its tab) from `--bottom-h`, which is why only the Layers tab moved. Guarded by `tests/probe_aggregate_toggle.js`.

After moving, verify computed `getBoundingClientRect()` of each panel over HTTP
(see `references/panel-layout.md` for the exact probe + the hover-popup pattern).
Panel HTML ids/classes stay the same; only css/transform/toggle logic changes.

**The legend is HIDDEN (user request).** `#commodityLegend { display:none }` — the plumbing below is still
live and correct, so restoring it is one line (`display:block`); its colour key duplicates the Layers panel's
commodity pills. Verify hidden state with `offsetParent === null`.

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
action whose zoom you control — `window.layer_District._map.setView(latlng, 13)` is exact — then step the map ±1
with `.leaflet-control-zoom-in/-out` and assert the behaviour flips one step BELOW the anchor and back
one step ABOVE it. Read the two observables that ARE in the DOM: `img.leaflet-tile` count and the
`.leaflet-control-layers-base input:checked` radio. Assert both directions (in and out) — a one-way
check passes on a handler that never turns the layer back off. Recipe + re-runnable probe:
`scripts/probe_map_chrome.js`.

**Do not assume those layer globals exist** — `window.clusters_Grantees` / `window.layer_Grantees` are
undefined in the current build, so a probe that reaches for `._map` throws instead of returning a
map. When you need the map (or an unclustered pin) and no global exposes it, drive the DOM: dispatch
clicks on `.grantee-cluster` until `.org-pin-wrap` appears, and read records you cannot reach through the DOM by
walking the layers off a boundary layer's map (`references/leaflet-browser-verify.md` → "Reading state the app
never exposes").

**Boundary layers ARE exposed — use them as the stable anchor.** The `specs` array sets
`window.layer_<Name>` for every boundary, so `window.layer_District._map` is a guaranteed map instance and
`layer_District.eachLayer(l => …)` a reliable polygon lookup (`getBounds().getCenter()` gives a latlng,
`_map.setView(center, 13)` a reproducible z13 anchor). Prefer that over the grantee globals above.
**Whenever you DELETE a UI affordance, grep the probe tree for it before running anything**
(`grep -rn 'dataTable\|filterToggle\|filter-bar-wrap' tests/ scripts/`) and rewrite those probes onto the
layer anchor — a probe that throws after a deletion reads as a regression in the deletion, and the cheap
wrong fix is to restore the UI you just removed. When the grantee DataTable went away that meant
`window.layer_District._map.setView(…, 13)` plus a click at the viewport centre instead of the old list row.

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
  Money arrives with the geocsv, so `renderEvoTable()` re-runs itself once `rowsReady` resolves. **The column is
  real since 2026-09-14:** `moneyBySN[sn].contracts[]` carries every LoA/DBG contract with its `service_start`, and
  `evoAmountByYear()` books each contract's USD in the fiscal year it STARTED (`parseFiscalYear` parses ISO dates);
  only undated contracts fall back to the first-appearance rule, which keeps the years summing to 2,288,256 USD.
- **Persist the active mode in `localStorage['fff.mapMode']`** (written inside `setMapMode`, so the restore
call also persists) and restore by calling `setMapMode(localStorage.getItem('fff.mapMode') || 'overview')` as
the LAST statement of the `data:loaded` handler. Restoring at script scope runs
before features exist — and before `p.women`/`p.grants` are merged — so the filter no-ops and the map silently
shows everything on reload.
- **Verify a mode by SET, not count** — the rendered orgs must equal (orgs matching the mode's data condition
  ∧ `has_geometry`) and the mode must survive a reload; a bare count passes on the wrong orgs. Recipe:
  `references/leaflet-browser-verify.md` ("Verifying a filter or view mode").
- **User rule — no Python for view data.** New views and aggregations are computed in `js/map.js` /
`js/myFuncs.js` from the feature properties the page already builds (`p.women`, `p.grants`, `p.restoration`,
`p.subcategories`, all from the geocsv). A per-org total is a two-line JS sum; do not add a pipeline script or
a new data file for a view.

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
   `node --check js/map.js` after every patch batch. Line endings also DIFFER per file — `index.html` is LF,
   `js/map.js` and `css/map.css` are CRLF (`head -3 <file> | cat -A` shows it) — so a MULTI-line `old_string`
   frequently refuses to match in the CRLF files. Do not re-send it: either patch single-line anchors one at a
   time (each `old_string` ends with its own newline) or join the block with explicit `\r\n` in the old_string
   (the fuzzy matcher absorbs whitespace, not line-ending runs). Deleting a whole dead function/callback block
   is the same problem — build the CRLF-joined old_string and replace it with `""`.
   **Cheapest reliable route for a long block: SLICE the old text out of the file and hand that exact string to
   the patch tool** — `open(path, newline='').read().split('\r\n')`, then `old_string = '\r\n'.join(lines[a-1:b])`
   around the line numbers you just read. The `newline=''` is load-bearing: default text mode applies universal
   newlines, so a CRLF file splits into ONE element and every line-range slice returns garbage (read_file shows
   the \r as part of each line precisely because it does not translate). Hand-retyping a 60-line block from the
   read output burns a cycle per failed attempt; slicing by line number never misses.
   **For DOC edits (AGENTS.md, README blocks) skip the patch tool**: one `execute_code` pass —
   `s = open(p, newline='').read()`, `assert old in s`, `s.replace(old, new, 1)`, write, then print
   `s.count(marker)` per replacement so a miss is loud. Instant and immune to fuzzy-match drift, where the
   same multi-line replacement through the patch tool can stall for minutes on a file of a few KB.
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
   class/tag); an "outside click" at a coordinate that landed on a filter pill (the bar used to collapse on
   outside clicks; dump the click's `e.target` first); and a list row selected by a search term that matched
   nothing (the old DataTable's "No matching records found" placeholder row — a reminder to assert the row you
   actually wanted), and a filtered-org count taken from `.org-pin-wrap` / `.grantee-cluster` ICONS — removing
   orgs that live inside an existing cluster leaves the icon count identical (measured 17 before and after), so
   count MEMBERS instead: pins + the numbers inside every cluster label must equal the orgs that pass the
   filter. Print the DOM you measured — if the code and the probe disagree,
   the probe is the cheaper suspect. Traps specific to AUTHORING a new probe (target the SVG stage instead of
   every label, do not copy another probe's click coordinates, add it to `tests/README`) are collected in
   are collected in `references/leaflet-browser-verify.md` → "Writing a NEW probe".
      **Re-scope chart assertions before re-running them after a feature change.** An assertion that greps ALL
      labels for a value ("no `Unassigned` province") starts failing the moment a legitimate `Unassigned` appears
      in a DIFFERENT column — group the labels by their column (sankey: sort the x attributes of `g > text` and
      index the column you mean) and assert against that column, so the probe fails only when that column is
      really wrong. Same rule for geometry: a click target taken from a whole-viewport heuristic (a polygon's
      on-screen box, a panel-relative offset) moves with any layout or zoom change and reports a UI regression
      that is not one — zoom to the target first (`window.layer_<Name>._map.fitBounds(layer.getBounds(),
      {maxZoom: 12})`) and click its measured centre.
      **A region that becomes HIDDEN BY DEFAULT breaks every probe that measured it, and the failure reads as a
      regression in the change.** After the bottom panel moved behind Investment map mode (`display:none`
      everywhere else) `probe_layout_split` went to 9 FAILs and the two sankey probes to 2-5: `clientWidth` and
      `getBoundingClientRect()` are 0 inside a `display:none` subtree, so every geometry/drag/chart-height
      assertion measured zero — while the charts still DREW (their 420×460 size floors), which hides the cause.
      Fix the PROBES, not the feature: enter the mode first (`setMapMode('investment')` + ~1 s so the charts
      re-measure) in anything that touches the panel, or assert what is true in both states (the panel is
      `display:none` off-mode and in-flow on-mode). Same family: an assertion naming a tab COUNT or POSITION
      ("three modes", "third tab = X") ages out on the next tab — look tabs up by `data-mode` and assert the
      set contains what you need, never that the list has exactly N.

   **Sweeping layout/option variants? Add a TEMPORARY runtime config hook, and re-render through a path that
   does NOT change the data.** `var CFG = window.__someCfg || {}` read by the render function lets ONE browser
   session measure every variant (`{h: 460}`, `{cap: 8}`, `{it: 32}`) with no file edit between passes — then
   bake the winner into the code and delete the hook. Force the re-render through an exported entry point
   (`window._evoApplyFilter()` redraws the aggregates from the SAME markers); driving a data filter to force
   re-renders invalidates the whole sweep — stepping the year slider narrowed the set on every pass, so link
   counts fell 23 → 6 and each row of the table measured a different chart. Two further traps: keep every
   variant's data identical (print the denominator — link/node count — next to the metric), and compare SVG
   geometry in ONE coordinate system (`path.getPointAtLength()` is USER UNITS, `getBoundingClientRect()` on a
   node is screen px; mixing them matches no nodes and prints `? -> ?`).

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

## Committing and pushing this repo
- Push `origin` explicitly (`git push origin main` → `github.com/neogeomat/FFF-webmap`, GitHub Pages serves the
  repo root); the second remote `amritkarma.kll` is never the target.
- **A commit that adds or changes `.github/workflows/*` is REJECTED over HTTPS**:
  `! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow
  `.github/workflows/verify.yml` without `workflow` scope)`. The committed work is fine — push the same branch
  over SSH instead (`git push git@github.com:neogeomat/FFF-webmap.git main`); SSH keys carry no OAuth scopes, so
  this works with the account's existing key and needs no token change. Alternative if HTTPS must stay:
  `gh auth refresh -h github.com -s workflow`. The tracking ref updates on the next fetch.
- Verify the push landed and the pipeline ran: `git ls-remote --heads origin main` (SHA == local HEAD) and
  `gh run list --limit 3` — the `verify` Action should go `completed/success` (~2 min) alongside a
  `pages-build-deployment` run. `gh run watch <id> --exit-status` blocks until the verdict.
- **Scan the staged list before committing** (`git diff --cached --name-only`): `git add -A` sweeps in
  LibreOffice lockfiles (`data/.~lock.*#`), which are NOT gitignored here. `git rm --cached` the junk, delete
  the file, else it ships.
- Confirm the deploy by size, not by opening the site: `curl -sI https://neogeomat.github.io/FFF-webmap/data/District.geojson`
  should now report the SIMPLIFIED ~1.8 MB (was ~17 MB) — a stale Pages cache otherwise hides a bad upload.

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

## Grantee filters + details panel (sourced from the geocsv rows)
The Commodities filter and the right Details panel read CSV-derived attributes carried on each
feature (built in `js/map.js` while the geocsv rows are grouped, so every property is present
before `data:loaded` fires), NOT the free-text `Commodities` string:
- The grouping step attaches to each org's feature: `grants[]`, `restoration[]`, `women[]`,
  `subcategories[]` (unique), `enterprise_classifications[]` (unique), and aggregates
  `people_benefited`, `area_direct_ha`, `area_contributed_ha` (summed from the restoration records),
  plus `organization_type` / `municipality` / `district` / `province` / `direct_hh` / `total_hh`.
- **Commodities filter** now uses `subcategory` (clean values from `grants[].subcategory`, e.g.
  Dairy / Timur / Bamboo / Vegetables; ~11 distinct on-map) instead of the ~35 free-text
  `Commodities` strings. A marker matches when ANY of its `subcategories` is checked
  (`p.subcategories.some(...)`), so multi-grant orgs filter correctly.
- **The Layers panel copies the legend's design tokens verbatim** (user: "make the left panel follow same fonts,
  colors and styles as the legend"). `#leftPanel` = `rgba(255,255,255,0.97)` + `1px solid #0070b6` + the legend's
  `0 4px 18px rgba(0,0,0,0.32)`; body `13px/15px #1a3c5e`; `.panel-header` = bold `14px #0070b6` over a
  `1px #ced4da` underline (= `.legend-header`); `.gf-title` = `600 13px #1a3c5e` (= `.legend-section-header`);
  pills = `.commodity-legend-item` (12px, `#f3f8fc` on `1px #ced4da`, 999px radius, `opacity: .6` unchecked,
  ONE PER LINE — `#leftPanel .gf-group, #leftPanel .gf-commodities-list { flex-direction: column; align-items:
  stretch }` (user rule: each entry on its own line at full panel width, so nothing wraps to a second line),
  checked = `#0070b6` chip + white text, `.gf-box` 12×12 radius 2px `border: 1px solid currentColor` +
  `opacity: .3` when off). Specificity trap: the ID-scoped base rule
  (`#leftPanel .grantee-filter label.gf-value { … }`) OUTRANKS the shared `.gf-value.checked` rule, so the
  checked colours must be restated inside the `#leftPanel` block or the pills silently lose their blue "on"
  state. Verify by diffing `getComputedStyle` of (panel, legend), (`.panel-header`, `.legend-header`),
  (`.gf-title`, `.legend-section-header`) and pill off/on vs the legend item off/on — only width/height may
  differ; any font/colour/border diff is a bug. Compare STATE-MATCHED pairs (both chips off, then both on):
  an ON legend item against an OFF pill reports four false colour diffs. Do not force the state by editing
  classes — the legend item's blue look was not class-driven, so `classList.remove('checked')` left it blue;
  when no same-state pair exists, mask the state-driven properties (colour/background/border/opacity/shadow)
  and still compare font/size/padding/radius. `Webmap/tests/probe_legend_pie.js` carries these as six
  assertions.
- **The filters live in the left "Layers" panel now (user rule).** `#granteeFilterBar` sits inside
  `#leftPanel .panel-content`; there is no floating wrapper, no `#filterToggle` and no `collapsed` state on the
  bar (the panel's own toggle is the only show/hide). Rendering the pills inside a panel means they are
  clickable while the panel is off-canvas too — probes can toggle pills without opening anything, but
  `togglePanel('leftPanel')` first if you want them visible for a screenshot.
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
  on point `mouseover` and cluster `clustermouseover`, hidden on `mouseout`/`clustermouseout`; position it
  clear of the bottom/right panels (see `references/hover-popup-positioning.md`).
- **Hover NEVER writes `#aggregate` (user rule — they asked twice).** The bottom panel is the CLICK
  surface (boundary scope) and starts on the national aggregate; a hover shows the floating card only.
  Both old writes are gone: `clustermouseover`'s and the marker `mouseover` → `highlightFeature()` path
  (that helper wrote `bio_table_generator(...)` into `#aggregate` — deleted along with the dead
  `highlightLayer` var, so no hover path calls `getElementById('aggregate')`). Verify with
  `tests/probe_hover_unlink.js`: `#aggregate` must be byte-identical before/after hovering a pin AND a
  cluster, while both hovers still show the popup.
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
`#leftPanel` follows the LEGEND's tokens outright — family, colour, size and chip styling. The superseded
instruction was a one-off "make font size 15px"; the standing request is "same fonts, colors and styles as the
legend", so copy the legend's literal numbers rather than inventing a size. Current target:
- family `Arial, Helvetica, sans-serif`, body `13px/15px #1a3c5e`, `.panel-header` bold `14px #0070b6` +
  `1px #ced4da` underline, section titles `600 13px #1a3c5e`, pills `12px`, `table td/th` padding `3px 5px`.
- Sizes run **one step above the legend's** (11/12/10) — the user asked for "a bit bigger" text in this panel, so
  the palette/shape stay legend-identical while the font sizes are +2px. The probe therefore compares the pill
  style with size/padding masked out and asserts the panel's sizes are strictly larger.
- Scope it with `#leftPanel, #leftPanel * { font-family: … }` plus ID-scoped size rules that list the
  bootstrap classes hard-coding their own size (`.form-control`, `.btn`, `label`, `input`, `select`,
  `button`) —
  bootstrap sets 14-16px on those, so setting the size on `#leftPanel` alone does not reach them.
  ID specificity already beats bootstrap's classes: check before adding `!important`, and it is not
  needed (this app uses none for panel fonts).
- "same font as Y" = copy Y's family, colour, line-height AND size unless they then name a size. Never shrink
  text below the reference to stop wrapping — widen the fixed-width panel (280px) or ellipsis-truncate with a
  `title` tooltip instead.
- Verify with `getComputedStyle` on the panel, `.panel-header`, `td` and the pills, plus
  `scrollWidth - clientWidth` on `.panel-content` for horizontal overflow (must be 0), not by eye.
- **A table is the other overflow source, and it fails invisibly.** The panels are FIXED width (`#leftPanel`
  280px, `#rightPanel` 340px), so a 4-5 column table pushes its last column past the panel edge — the
  evolution table's `Grant amount (USD)` was completely off-screen while the table still looked "tight" in a
  screenshot. Fix with `table-layout: fixed` + explicit `th:nth-child(n), td:nth-child(n) { width: …% }` +
  `white-space: normal` on the headers (`nowrap` headers are what widen the table; let them wrap instead) +
  tighter cell padding. Verify `table.scrollWidth - table.clientWidth === 0` AND that the last cell's
  `getBoundingClientRect().right <= panel.getBoundingClientRect().right`. Precedent: `.evo-table`.
- **A deliberately white-on-colour element inside a restyled panel WILL go dark.** An ID-scoped `color:`
  on `#leftPanel button` / `.btn` outranks the tab's own rule, so the "‹ Grantees" collapse tab lost its
  white text on the blue background and had to be re-asserted at the END of the block:
  `#leftPanel .panel-toggle-btn, #leftPanel .panel-toggle-btn * { color: #ffffff; }`. After ANY panel
  typography/colour change, re-check every element that should stay light-on-dark by diffing computed
  colours against the previous build (recipe in `references/leaflet-browser-verify.md`).

### Left panel = the "Layers" panel (filters inside; the grantee list is gone)
- The panel is titled **Layers** (`#leftPanelToggle .gf-label` and `.panel-header`) and holds
  `#granteeFilterBar` directly in its `.panel-content` — the boundary toggles plus the four pill groups
  (Type / Commodities / Enterprise / Organization Type).
- **The grantee DataTable was removed at the user's request**, so `buildGranteeTable()`, its row-click
  fill-`#aggregate`-and-zoom handler, `#dataTable`, the `Filter ▾` toggle and the whole DataTables plugin
  (`js/jquery.dataTables.js`, `js/dataTables.bootstrap4.js`, `css/dataTables.bootstrap4.css`) are gone.
  `#mainTable` (right panel) is the only table left. jQuery itself stays — bootstrap 4 needs it.
- The panel still FILLS its column (`#leftPanel { top:80px; bottom:100px; max-height: calc(100vh - 180px) }`)
  and `.panel-content { flex: 1 1 auto; min-height: 0 }`; verify `scrollWidth - clientWidth === 0` (no
  horizontal overflow) — the pills wrap at the panel's 280px.
- No UI path zooms to an org any more. From a probe, drive the map instance itself:
  `window.layer_District._map.setView(latlng, Math.max(map.getZoom(), 13))`.

## Aggregate panel charts + boundary-click scoping
`#rightPanel #tab-aggregate` creates the Chart.js instances (pie / type-bar / commodities / investment) in one
IIFE and `renderAggregates` + `renderInvestment` re-fill them on every scope change. The **sankey lives in the
BOTTOM panel** now (`#bottomPanel`, under the boundary overview text), not here — see the sankey bullets.
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
  project-area palikas, so a point outside them resolves to null and falls back to the attribute); Province →
  `properties.Province` is **MIXED numeric codes and names** (`1, 2, 5, Bagmati, Gandaki, Karnali,
  Sudur Pashchim`) — never label from it raw, run it through a 7-entry code→name map
  (`PROVINCE_NAME` in `js/map.js`), which is 1=Koshi 2=Madhesh 3=Bagmati 4=Gandaki 5=Lumbini 6=Karnali
  7=Sudur Pashchim.
- Chart dimensions per feature: `p.Type_of_Grant` (`LoA`/`DBG`) and `p.subcategories` (the same clean values
  the Commodity pills filter on — not the free-text `Commodities` string). The render join must first COPY
  `district`/`province`/`municipality` from `orgs[]` onto `p` — it never did; without that there is nothing
  to fall back on for labels.
- **The chart must FIT the strip (hard rule, user report: "the diagrams do not fit the available vertical
  space, some part is always hidden, even when panel is moved up").** `sankeyInnerHeight(svgEl)` derives the
  height from `var(--bottom-h)` minus the dropdown row and heading. **Never measure `.sankey-wrap`**: it is
  sized by the chart it contains, so a read-back is the PREVIOUS render's height — the chart chased its own
  size, lagged every drag one step, and grew ~48px per redraw. Never reintroduce a fixed floor (the old
  `Math.max(460, …)` outgrew a short strip and left nodes below the fold). d3 spills ~48px past `extent` when
  the node count can't fit: reserve it (`SPILL = 48`, extent height `h - SPILL`) and derive `nodePadding` from
  `h / tallest-column`. `.panel-content` is a flex column with `min-height: 0` and scrolls, so an oversized
  chart is scroll-reachable rather than clipped. Probe: `tests/probe_sankey_fit.js` (5 panel heights + real
  `#bottomResize` drags: no clipping, `attr` height == CSS height, chart tracks the strip).
- Sankey, as shipped: **FFF → the columns you pick** — drawn TWICE (user rule): `#chartSankeyAmount`
  first, flowing each org's LoA+DBG **USD** from `moneyBySN`, then `#chartSankey` counting one unit per
  **organization**; `renderSankey(scope, ms)` fans out to `renderSankeyInto(svgId, metric, scope, ms)`.
- **The chain is interactive (user rule).** `#sankeyCols` (index.html, above the charts) holds **6 native
  `<select>`s** (options: blank / Grant type / Commodity / Women-led / Year / Province / District / Palika /
  Organization — **Organization last**, and the SHIPPED DEFAULTS are **Grant type, Year, Commodity, —, —, —**,
  both user requests; three probes used to hardcode the old Province/District/Palika defaults, so any probe that
  needs a specific chain must SET the dropdowns itself rather than assume them); `SANKEY_DIMS` maps each
  dimension to one accessor: `Province`/`District`/`Palika` **from
  point-in-polygon** (user rule: "use pip for province and local levels as well") with the attribute as
  fallback — `provinceOf` → `nameAt(layer_Province,'Province')` through `PROVINCE_NAME` (the geojson stores 3
  provinces as bare `STATE_CODE` numbers, so `2` must become `Madhesh`), `districtOf` →
  `layer_District.DISTRICT`, `localLevelOf` → `layer_LocalLevel.GaPa_NaPa` (only the 33 project palikas have
  polygons, so palika often falls back to `municipality`); plus `Grant type` (`Type_of_Grant`), `Commodity`
  (`subcategories[0]`), `Women-led` (`women[]` empty or not) and `Year` (`firstFiscal()` = earliest contract
  `service_start` FY → the grants' `implementation_period` → `Undated`). Blanks are dropped, so the chain is
  `FFF → col1 → … → colk`, and one `change` listener calls `renderSankey(selectedScope, null)`. **One value per
  org per column** (a 3-commodity org shows its primary commodity) so every column's node total equals the
  org/amount total in scope; a path-per-value variant inflates org counts and splits the money across
  combinatorial paths — do not switch to it without saying so. PIP at the palika level **merges wards**: two
  orgs in Panauti ward 8 and ward 10 are ONE node `Panauti (2)` instead of two identical truncated labels.
  Cost: PIP per marker against 33 palika polygons ≈ 26–30 ms for a 36-marker re-render (acceptable; cache if a
  bigger dataset lands). **Nothing is capped or bucketed** — the old `topOf(...,12)` / `topOf(...,10)` +
  "Other …" caps are gone, because a tail bucket is a multi-parent hub that re-introduces crossings. Node order
  is still **parent-contiguous** (within a column a node's children follow it, biggest first). No
  `append('title')` tooltips: they are unclickable inside `pointer-events` panels.
- **Org display names are tidied at render time (user request: "some of the names are redundant").**
  `cleanOrgName(name, district)` sits next to the geocsv loader in `js/map.js` and is applied ONCE where the
  feature properties are built (`Name_of_Organization`), so the permanent tooltip and `bio_table_generator` agree.
  It drops a **trailing** bracket that is (a) the row's district, (b) a repeat of the same name either way round
  (case/punctuation-insensitive, so "SHREE SHIVASHAKTI KRISHI SAHAKARI (Shree Shivashakti Krishi Sahakari,
  Limited)" becomes the richer inner form), or (c) a ≤3-word alias whose first word is a prefix of the outer's
  first word ("Shivnagar Samudayik Ban Upabhokta Samuha (Shiv Nagar CFUG)"). **Anything the bracket genuinely
  adds survives** — AFFON/NFGF/NIWF/IHHR acronym pairs are untouched, which is exactly the over-stripping failure
  mode to re-check whenever the rule is widened. The raw names stay in `data/*.geocsv` (the pipeline keys off
  `org_name_geojson`, and `ALIASES`/`SAME_ORG` matching depends on them). Probe: `tests/probe_org_names.js`
  (reads the tooltips off every marker in the cluster group, so no zooming; 8 assertions).
- **Title case, same display layer.** `titleCase()` fires **only when the whole string is upper case** (proper
  case passes through), so the boundary geojsons' `DISTRICT` labels stop disagreeing with the geocsv fallback in
  the same column: `districtOf`/`provinceOf`/`localLevelOf` wrap their `nameAt(...)` in it and the org name is
  `titleCase(cleanOrgName(...))`. Dotted acronym words keep their capitals ("C.F.U.G.", "MI.NA.PA.07"), single
  letters stay as they are — verify that with `probe_org_names.js`'s shouting assertion rather than eyeballing.
- **Three rows are two entities each** — S_N 7, 8, 12 have ` / ` inside the name. Left joined **deliberately, at
  the user's instruction** ("leave splitting for now"): splitting them means 3 extra org rows and their
  LoA/DBG/hh/area cannot be attributed between the halves from the available sources. Say so rather than silently
  picking one name, and note the three S_N values so a future pass does not re-discover them.
- **The sankey data table (user request: "make the sankey data available in table beside the diagrams").**
  `renderSankeyInto` now **returns the `paths` it drew** (`[{cells:['FFF', …], w}]`, `[]` on both early exits) and
  `renderSankey` hands them to `renderSankeyTable(byAmount, byOrgs)` — so the numbers cannot drift from the
  picture and no filter/scope/mode path needs its own hook (they all funnel through `renderSankey`). One row per
  **distinct chain** (rows merge on the full chain: two orgs in one palika share a row), columns = the picked
  dimensions + `Organizations` / `Amount (USD)` / `Share`, then a totals row; `esc()` escapes the data-derived
  cells. The total row sums the **rounded** cells above it — some LoA/DBG conversions carry cents, so the exact
  1,057,267 displays as rows summing to 1,057,266 and the total must agree with what is on screen; `Share` uses
  the exact values. **Placement: a fixed 420px third flex column beside the pair** (`.sankey-table-wrap`, own
  scrollbox capped at `60vh`, so 20+ chains do not stretch the row past the charts). Two CSS rules carry it and
  both were screenshot-driven: label cells wrap + headers never wrap + `.num` cells never wrap, which is what fits
  all six columns in 420px with nothing clipped (a first pass let the numbers wrap mid-value — "$167,15 8" — and
  `word-break` on the headers split "Grant type" three ways). Sticky header/total cells do NOT work in a
  `border-collapse: collapse` table (measured: the total row stayed off-screen) — plain cells, and the totals are
  legible in the chart roots above anyway. Probe: `tests/probe_sankey_table.js`
  (14 assertions: in the panel under the charts, header == picked columns + 3, no duplicate chains, both column sums ==
  the charts' `FFF (…)` root labels, share == 100%, totals row echoes the columns, a dropdown change moves the
  header/rows but not the totals, no clipped columns, no page errors).
- **`js/map.js` is two sibling scopes — cross-scope calls go through `window._sankeyRefresh`.** `selectedScope`,
  `renderSankey`, `renderSankeyTable` and `renderSankeyInto` are declared in the later block (~line 1300+), while
  the resize bar (~line 68) and `setMapMode` (~91) live in the earlier block. Reaching across directly gives
  `ReferenceError: renderSankey is not defined` — inside the surrounding `try/catch` it never fires a pageerror,
  it just logs `sankey redraw failed` and the charts silently keep their old size (the drag and the mode switch
  both looked fine until you measure the SVG height). Expose a closure-correct entry at the definition site
  (`window._sankeyRefresh = function() { renderSankey(selectedScope, null); }`, same pattern as
  `_granteeFilterApply`) and call it guarded (`if (window._sankeyRefresh)`). **Always assert on the console
  warning**, not just on pageerrors: `probe_layout_split.js` measures the chart height across a bare drag, and
  `probe_investment_mode.js` checks the mode switch.
- **The bottom panel IS the Investment Map (user rule).** It exists only while `body.map-mode-investment` is on:
  `body:not(.map-mode-investment) #bottomPanel { display:none !important }` + `body.map-mode-investment #bottomPanel
  { display:flex }`, and outside that mode the overlay panels drop to `bottom:12px` (no strip to clear). The
  `#mapModeTabs` tab is `Investment map` `[data-mode=investment]` (2nd tab), the panel header reads **Investment
  Map** (was "Details"), and entering the mode un-collapses the panel + after 320 ms calls `fitNepal()` and
  re-renders both sankeys (while hidden their `clientWidth` is 0 — the render floors at 420×460, so nothing
  breaks, but the redraw fits them to the strip). Probe: `tests/probe_investment_mode.js`.
- **Resizable map / bottom-panel split (user request).** The page is a two-row flex column: `body{display:flex;
  flex-direction:column}`, `#map{flex:1 1 auto; min-height:120px; position:relative}`,
  `#bottomPanel{position:static; flex:0 0 auto; width:100%; height:var(--bottom-h, 50vh)}` — the panel is a
  real block BELOW the map, not an overlay, and it opens at half the page **when Investment map mode is on**
  (hidden otherwise — see the bullet above). `#bottomResize` (6px bar, first
  child of the panel, `cursor:row-resize`) writes `--bottom-h` on `documentElement` during mousemove; on drop
  it calls `fitNepal()` and re-renders both sankeys. `fitNepal()` = `invalidateSize()` +
  `fitBounds(window.layer_Nepal.getBounds(), {padding:[8,8]})` — user rule: the map content follows so the
  whole country stays visible (it is also called from `togglePanel`'s 300 ms hook and on drag). A drag on the
  collapsed panel expands it first (`togglePanel`). The two overlay panels stop above the strip
  (`bottom: calc(var(--bottom-h, 50vh) + 12px)`), so nothing overlaps the panel. Probe:
  `tests/probe_layout_split.js` (legend hidden, no overlap, 50% default, drag resizes both boxes, Nepal stays
  fitted, collapse shrinks to the header, option order).
- **Sankey placement: the BOTTOM panel** (`#bottomPanel`, above `#aggregate`'s text, user rule), the two charts
  **SIDE BY SIDE** (`.sankey-row { display:flex; gap:14px }` + `.sankey-wrap { flex:1 1 0; min-width:0 }`) and each
  `max(460, strip+40)` tall (the floor is the measured crossing sweet spot; a dragged-taller panel draws
  taller charts, up to 1000px, and a short strip just scrolls); `renderSankeyInto` sets the SVG width from its own box at render time
  (`Math.max(420, wrap.clientWidth - 2)` — clientWidth survives a collapsed panel, so no zero-width trap; a
  resize does NOT re-fit, the charts keep their drawn size until the next re-render). The panel scrolls (`#bottomPanel` is a fixed 350px strip; `.panel-content` is `overflow-y:
  auto`, so the two tall charts scroll — user asked for exactly that). Because the bottom panel STAYS VISIBLE in
  evolution/women mode (the right panel's `#tab-aggregate` is `display:none` there), `applyEvolutionFilter`
  re-renders both from the *visible* markers — otherwise the flow silently goes stale when the year slider
  moves. Verify placement by geometry (`#bottomPanel` contains `#chartSankey`), not by reading markup.
- **Killing link crossings (measured, the honest recipe):** (1) make the chart TALL — in a 230px box d3's
  collision resolution interleaves the columns; the national view went 6 → 1 crossings going 230 → 460px, and
  height beats every other knob. (2) Register nodes PARENT-CONTIGUOUSLY (each province's districts together) —
  d3 keeps the node-array order within a column, but note its relaxation still nudges y by barycenter, so the
  order is a hint, not a guarantee. (3) Do NOT bucket the tail into an "Other …" node: it is a multi-parent hub
  and crossings return (cap 24 → 1 vs cap 10 → 4). (4) `nodeSort` by value, `iterations` and `nodePadding`
  tweaks all measured WORSE (24/13 crossings) — do not reach for them. A money-weighted chart keeps a few
  crossings (skewed node heights); log-scaling the widths would fix it but lies about the data, so say that
  instead of silently distorting it. **Measure crossings instead of eyeballing them:** two links that share a
  source column and a target column but swap vertical order MUST cross, so sampling each `path`'s endpoints
  (`getPointAtLength(0)` / `(len)`, grouped by `|Δsx|≤4 && |Δtx|≤4`) counts them — no production hooks needed.
  `scripts/probe_sankey_crossings.js` does exactly that; quote its numbers when reporting a fix.
- The district node is labelled from the **polygon** (`properties.DISTRICT`, e.g. `KABHREPALANCHOK`), not from
  the row's `district` column (`Kavre`) — point-in-polygon wins. Expect the two spellings to disagree and say
  which one the label comes from instead of "correcting" the data.
- **User rule — the right panel DOES auto-open when a polygon is clicked**, the deliberate exception to
  "panels never auto-open on interaction": the whole point of the click is the panel content. Pins are never
  hidden by a polygon click — the click scopes the PANEL only (`#aggOverview` + all three charts + the
  sankey; nothing filters the markers).
- Shipped scope implementation (`js/map.js`): `polyRings` / `pointInRings` (ray casting, exterior rings),
  `markersIn(layer)`, `nameAt(layer, prop, latlng)` + the `districtOf` / `provinceOf` / `localLevelOf`
  wrappers, `renderAggregates`, `renderInvestment`, `renderSankey` (also called from `applyEvolutionFilter`),
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
