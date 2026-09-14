# FFF Webmap — Data Flow

```mermaid
---
theme:light
---
flowchart LR

subgraph SRC["SOURCES"]
  S1["Grantees-Coordinates.xlsx Sheet1 S.N. Y X Name of Organization"]
  S2["data/moreDataFromFFF/*.csv 8 CSVs - 4 with data: Enterprise Commodity / Nature of Enterprises / Women Led / Restoration Landscape"]
  S3["data/DRAFT_FFF_FFPOs_Details.xlsx Sheet1 COOPERATIVES / FARMERS GROUPS / FOREST SECTOR"]
  S4["data/DBG & LoA (2019-2026).xlsx LoA (2019-26) 67 rows / DBG (2023-26) 24 rows"]
  S5["fff.qgz QGIS"]
  S6["data/District.geojson 77 | Province 7 | Nepal 1 | chureDissolved 1 | projectLocalLevels 33 - SIMPLIFIED (ogr2ogr -simplify + 5-decimal coords): 29 MB -> 2.6 MB, originals kept in ../boundary-src/"]
end

subgraph BLD["BUILD - hand-run, no bundler - project root"]
  G1["data/Grantees.geojson 62 features keyed S_N, 36 with geometry - PIPELINE INPUT ONLY, hand-maintained from the xlsx, never fetched by the page"]
  SH["index.html + css/map.css + js/map.js + js/myFuncs.js - qgis2web shell exported from fff.qgz"]
  B7["tools/make_geocsv.py - the whole pipeline (Registry / ALIASES, grants + records + finance parsers), IN the repo since 2026-09-14"]
  B8["data/Grantees.combined.geocsv 79 rows = 73 grants + 6 HH-only, 68 orgs, 36 with WKT POINT, women_json / restoration_json, loa_total_USD_org / dbg_total_USD_org + finance_json (per-contract service_start/end + USD) - TRACKED, served, the page's single runtime source"]
  B9["data/unmatched_orgs_geocsv.txt - review after every rebuild (A* = auto-created orgs)"]
  BX["retired 2026-09: consolidate_grantees_attributes.py, data/grantees_attributes.json, data/unmatched_orgs.txt, data/investment_by_enterprise.json, summarise_investment.py, the .csvt/.vrt writers"]
end

subgraph BRW["BROWSER - static, no build step, HTTP required"]
  R1["fetch data/Grantees.combined.geocsv - the ONLY grantee request - parseCsv whole-text, wktPoint(WKT), group rows by S_N"]
  R2["L.geoJSON(null, ...) then addData(features) then fire('data:loaded') - 36 markers, moneyBySN (per-org money + contracts[]), attrsFromCsv (evolution counts; the amount column uses each contract's service_start fiscal year)"]
  R4["fetch 5 boundaries data/District.geojson 77 / data/Province.geojson 7 / data/Nepal.geojson 1 / data/chureDissolved.geojson 1 / data/projectLocalLevels.geojson 33"]
end

subgraph UI["UI SURFACES fed by the grouped features"]
  U1["markers + L.markerClusterGroup maxClusterRadius 35"]
  U2["commodity filter pills"]
  U3["left-panel DataTable buildGranteeTable()"]
  U4["hover/info cards bio_table_generator in js/myFuncs.js"]
  U5["evolution table/filters"]
  U6["aggregate charts pie/bar/investment/sankey - scoped by polygon click (PIP, finest visible layer wins)"]
end

subgraph OUT["CONSUMERS / OUTPUTS"]
  O1["QGIS/GDAL open the tracked data/Grantees.combined.csv copy for manual verification - the page itself reads the geocsv"]
  O2["git push origin main -> GitHub Pages neogeomat.github.io/FFF-webmap serving index.html css/ js/ data/ - .github/workflows/verify.yml runs tests/verify_web_ui.js + tests/probe_*.js on the same push"]
end

S1 --> G1
S5 --> SH
S1 --> B7
S2 --> B7
S3 --> B7
S4 --> B7
G1 --> B7
B7 --> B8
B7 --> B9
S6 --> R4
SH --> R1
B8 --> R1
R1 --> R2
R2 --> U1
R2 --> U2
R2 --> U3
R2 --> U4
R2 --> U5
R2 --> U6
R4 --> U1
B8 --> O1
SH --> O2
B8 --> O2
```

## Notes

- **One request, one file.** The browser fetches the geocsv once and groups the rows by `S_N` in JS: org
  properties, `grants[]`, `women[]`/`restoration[]` (the `*_json` columns), per-org LoA/DBG USD, and the
  `WKT` point. `data/Grantees.geojson` is an input to `make_geocsv.py`, not something the page loads.
  `probe_geocsv_source.js` asserts both retired files are never requested.
- **Money.** National totals count every org in the file (68, including coordinate-less orgs):
  2,288,256 USD = Integrated 916,886 + Forest-based 336,226 + Farm-based 195,089. A polygon scope counts only
  the markers inside it, so a district figure is legitimately smaller.
- **Parse the CSV as one string.** Cells contain newlines and commas inside quotes; a line-based split drops
  2 rows / ~73,014 USD. `parseCsv()` in `js/map.js` walks the whole text with a quote flag and skips CR.
- **Records.** 22 women / 61 restoration records ride the geocsv. The retired `grantees_attributes.json` had
  23 / 70 across 77 orgs; the extra 10 belong to synthetic `A7–A15` orgs that appear only in the
  women/restoration CSVs and so have no row (no coordinates, no grant) — nothing rendered loses data.
- **Rebuild after any source edit:** `cd Webmap && python3 tools/make_geocsv.py`, then review
  `data/unmatched_orgs_geocsv.txt`, then `node tests/probe_geocsv_source.js` (see `tests/README`; the whole suite
  is `for f in tests/verify_web_ui.js tests/probe_*.js; do node $f || echo FAILED $f; done`).
- **Boundaries are simplified, not raw.** `ogr2ogr -simplify` (District 0.0002°, Province/Nepal/Chure 0.0005°,
  Local Level 0.0001°) + `COORDINATE_PRECISION=5` cut 29 MB to 2.6 MB: the page went from 30.1 MB / 1.6 s to
  4.4 MB / 0.8 s to first markers. The unsimplified originals live in the unversioned `../boundary-src/`; after
  any boundary rebuild run `python3 tests/boundary_pip_check.py data/District.geojson` (it fails if a pin moved
  to another district).
