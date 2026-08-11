---
name: fao-fff-grantees-map
description: Edit the FAO FFF grantees Leaflet web map.
---

# FAO FFF Grantees Web Map

Trigger skill for editing the FAO FFF Nepal grantees Leaflet map at `/home/ubentu/baato/FAO/FFF`.

**Full project conventions, layout, data pipeline, and pitfalls live in `AGENTS.md`
(at the repo root). Read that first — it is the single source of truth.** This skill
only adds the trigger and the verification loop below.

## When to use
- Editing grantee data, markers, popups, the info panel, the filter, or basemaps in this repo.
- Regenerating `Webmap/data/Grantees.js` from `Grantees-Coordinates.xlsx`.

## Verification loop (do this for any UI change)
1. Make the edit (`Webmap/index.html` and/or `Webmap/js/myFuncs.js`).
2. Serve and load in a real browser: `python3 -m http.server 8000 --directory Webmap` →
   `http://localhost:8000`; trigger the change (click a list row / hover a cluster).
3. Measure in browser console: card vs panel width should be ~full (residual inset is normal
   `.card-body` padding). The user rejects "done" without proof it renders. Confirm before reporting success.
