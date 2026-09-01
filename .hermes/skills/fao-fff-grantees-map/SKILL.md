---
name: fao-fff-grantees-map
description: Edit the FAO FFF grantees Leaflet web map.
---

# FAO FFF Grantees Web Map

Trigger skill for editing the FAO FFF Nepal grantees Leaflet map at `/home/ubentu/baato/FAO/FFF`.

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

The map now needs HTTP for EVERYTHING: boundaries use `fetch`, grantees use the ajax plugin.
**`file://` shows no grantees AND no boundaries** — always serve over HTTP to verify.

## Boundary overlays (added after AGENTS.md — keep AGENTS.md in sync)
Four committed GeoJSON boundary layers wired in `Webmap/index.html` (IIFE near the end):
District (77 feats, styled per-feature by `project_area`: `y` → green #27ae60, else blue #3388ff),
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

## Verification loop (do this for any UI change)
1. Make the edit (`Webmap/index.html` and/or `Webmap/js/myFuncs.js`).
2. Serve over HTTP and load in a real browser: `python3 -m http.server 8000 --directory Webmap`
   → `http://localhost:8000`. **Never verify boundary overlays via `file://`.**

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
  (direct + contributed ha, people benefited, by year block) and Women-led records. The cluster
  hover table shows a compact Classification + Impact line too.
