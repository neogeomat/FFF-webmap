---
name: fao-fff-grantees-map
description: Edit the FAO FFF grantees Leaflet web map.
---

# FAO FFF Grantees Web Map

Trigger skill for editing the FAO FFF Nepal grantees Leaflet map at `/home/ubentu/ssd/baato/FAO/FFF`.

**Base conventions, layout, data pipeline, and pitfalls live in `AGENTS.md` (repo root) —
read that first.** This skill additionally documents the boundary-overlay behavior and the
browser verification recipe (see `references/leaflet-browser-verify.md`), which AGENTS.md
does not yet cover — keep AGENTS.md in sync after map changes.

## When to use
- Editing grantee data, markers, popups, the info panel, the filter, or basemaps in this repo.
- Editing the Grantees data layer (`data/Grantees.geojson`) or its async load wiring in `index.html`.
- Editing the District/Province/Chure/Nepal boundary overlays or the `#granteeFilterBar` toggle pills.

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
- the left-panel DataTable (`buildGranteeTable()`)
Define those as function declarations (hoisted) so they are callable from the callback. Do NOT
iterate `layer_Grantees.eachLayer(...)` synchronously at top level — it runs before the features
exist and silently yields an empty map.

`data/Grantees.geojson` may contain features with `geometry: null` (orgs not yet geocoded).
Leaflet's `geometryToLayer` returns `null` for them and `addData` skips them — they do NOT crash
the load; only the Point features render. Keep null-geometry rows in the file as a geocoding
to-do list (QGIS shows them in the attribute table).

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
Four committed GeoJSON boundary layers wired in `Webmap/index.html` (IIFE near the end):
District (77 feats — styled per-feature by `project_area`: `'y'` (13, project area) → highlighted green
#27ae60 fill @ 0.5 + dark-green stroke; `'n'` (64) → dimmed blue #3388ff fill @ 0.04, stroke-opacity 0.35),
Province (7, orange #e67e22), Chure (1, green #27ae60, the Terai/Chure belt),
Nepal (1, white #ffffff, always added to the map on load).
- Loaded via `fetch`, NOT embedded globals — **they only appear when served over HTTP;
  opening `index.html` via `file://` silently shows no boundaries.** The Grantees layer
  still works on file:// (it uses the embedded `var json_Grantees`).
- No zoom auto-toggle anymore — District/Province/Chure are toggled manually via checkboxes in
  the top `#granteeFilterBar` pill bar (District/Province default OFF, Chure default ON). Nepal and
  the Organizations (grantee marker) cluster layer are ON by default.
- Panes: District z410, Province z420, Chure z425, Nepal z430 — all below `pane_Grantees`
  (z650) so points stay on top.

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

**The floating legend must track the panel by hand.** `#commodityLegend` is NOT a child of the panel —
it is a `position:fixed` overlay whose `right`/`bottom` are set by `updateLegendPosition()` (called from
`togglePanel()` and `setMapMode()`). Anchor its right offset to the panel's *visible* edge — the
`#rightPanelToggle` tab — not the panel body: the tab protrudes 85px left of the panel, so positioning
against the body hides the legend under the tab when expanded and leaves a different gap when collapsed.
Derive from the elements (`tab.offsetWidth` + `rightPanel.offsetWidth` + the 10px screen inset + a
constant gap) so the legend travels exactly as far as the panel. Verify by measuring
`getBoundingClientRect()` of legend and tab in both states: the gap must be identical and the legend's
travel must equal the panel's travel (offsetWidth is stable mid-transition; rects are not).

**Getting the Leaflet map instance:** `var map = L.map('map', …)` is closure-scoped, so the global `map`
is the `<div id="map">` (browser named access) — `map instanceof L.Map` is false and `L.map.instances`
does not exist, which makes `invalidateSize()` helpers throw on every panel toggle. Anchor on a layer you
hold instead: `(window.layer_Nepal && window.layer_Nepal._map) || (window.clusters_Grantees && window.clusters_Grantees._map)`.

**Do not assume those layer globals exist** — `window.clusters_Grantees` / `window.layer_Grantees` are
undefined in the current build, so a probe that reaches for `._map` throws instead of returning a
map. When you need the map (or an unclustered pin) and no global exposes it, drive the DOM: dispatch
clicks on `.grantee-cluster` until `.org-pin-wrap` appears (recipe in
`references/leaflet-browser-verify.md`).

## Verification loop (do this for any UI change)
1. Make the edit (`Webmap/index.html` and/or `Webmap/js/myFuncs.js`).
2. Serve over HTTP — `python3 -m http.server 6115 --directory Webmap` → `http://localhost:6115`.
   Check `ss -ltnp | grep 6115` first: a stale `http.server` from an earlier session keeps the
   port and serves the OLD copy (your edit looks missing, data URLs 404). **Never verify
   boundary overlays via `file://`.**
   Verify with the headless Playwright harness (Chromium already installed):
   `cd ~/pw-check && node verify_web_ui.js` — edit its CONFIG for app-specific assertions;
   exits non-zero on real console/pageerror (benign `polyfill.io` + tile-abort noise filtered).
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
3. Confirm it rendered (see `references/leaflet-browser-verify.md`): layout fill ~full;
   overlay path counts per pane (District 77 / Province 7 / Chure 1 / Nepal 1 — toggle the
   `#granteeFilterBar` checkboxes first, since District/Province start off; Chure and Nepal start on);
   pane class is `leaflet-pane_<Name>-pane`, not `.pane_<Name>`. The user rejects "done"
   without proof it renders. Confirm before reporting success.

## Two skill copies — keep them identical
This skill exists twice: global `~/.hermes/skills/web-mapping/fao-fff-grantees-map/` and in-repo
`Webmap/.hermes/skills/fao-fff-grantees-map/`. After editing either, `diff -rq` the two and copy
the newer tree over the older. `Webmap/.gitignore` ignores `*.md`, so new in-repo reference files
land untracked (`git add -f` to publish). Other agents (e.g. opencode) edit this repo
concurrently: committed work appears without you, and a dirty working tree can get swept into
someone else's baseline commit. Before syncing or copying anything, re-check `git status` and
`diff -rq`, and use `git log -S '<marker>' -- <path>` to find which commit carries a change
instead of assuming yours is still uncommitted.

## Grantee filters + details panel (sourced from grantees_attributes.json)
The Commodities filter and the right Details panel read CSV-derived attributes merged onto each
feature at render time (in `index.html`, inside `layer_Grantees.on('data:loaded', …)` →
`attributesPromise.then(...)`), NOT the free-text `Commodities` string on the geojson:
- Merge step builds `grantsByOrg`/`restorationByOrg`/`womenByOrg` keyed by `String(org_id)`, then
  attaches to each feature: `grants[]`, `restoration[]`, `women[]`, `subcategories[]` (unique),
  `enterprise_classifications[]` (unique), and aggregates `people_benefited`, `area_direct_ha`,
  `area_contributed_ha`.
- **Commodities filter** now uses `subcategory` (clean values from `grants[].subcategory`, e.g.
  Dairy / Timur / Bamboo / Vegetables; ~11 distinct on-map) instead of the ~35 free-text
  `Commodities` strings. A marker matches when ANY of its `subcategories` is checked
  (`p.subcategories.some(...)`), so multi-grant orgs filter correctly.
- **Details panel** (`bio_table_generator` in `Webmap/js/myFuncs.js`) renders Enterprise
  Classification, a Grants list (period/title/classification·commodity), Restoration
  (direct + contributed ha, people benefited, by year block) and Women-led records.
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

## Aggregate panel charts
`#rightPanel #tab-aggregate` creates the Chart.js placeholders (`window.chartPie`, `window.chartBar`) in one IIFE. `#chartInvestment` is live: it fetches `data/investment_by_enterprise.json` (generated by `summarise_investment.py` from the per-org finance columns deduped by `S_N`) and renders a LoA/DBG stacked bar by `enterprise_classification`. It is a STATIC snapshot: like the
pie/bar placeholders it does not react to the filters, and it only changes when
`python3 summarise_investment.py` is re-run after a finance or geojson edit (re-run it after any org
merge too, and confirm the TOTAL row is unchanged).
