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
- Regenerating `Webmap/data/Grantees.js` from `Grantees-Coordinates.xlsx`.
- Editing the District/Province/Chure/Nepal boundary overlays or the `#granteeFilterBar` toggle pills.

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
3. Confirm it rendered (see `references/leaflet-browser-verify.md`): layout fill ~full;
   overlay path counts per pane (District 77 / Province 7 / Chure 1 / Nepal 1 — toggle the
   `#granteeFilterBar` checkboxes first, since District/Province start off; Chure and Nepal start on);
   pane class is `leaflet-pane_<Name>-pane`, not `.pane_<Name>`. The user rejects "done"
   without proof it renders. Confirm before reporting success.
