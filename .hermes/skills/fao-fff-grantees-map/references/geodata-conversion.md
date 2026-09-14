# Geodata conversion — FAO FFF repo

Verified recipes used in this repo (paths relative to `/home/ubentu/ssd/baato/FAO/FFF`).

## 1. Grantees spreadsheet → full GeoJSON (QGIS/GeoLibre-editable)

`make_grantees_js.py` only writes orgs that have X/Y; the rest are skipped silently.
For QGIS/GeoLibre editing + geocoding, emit ALL rows (null geometry for the missing ones):

```python
import openpyxl, json, os
SRC = os.path.expanduser('~/ssd/baato/FAO/FFF/Grantees-Coordinates.xlsx')
OUT = os.path.expanduser('~/ssd/baato/FAO/FFF/Webmap/data/Grantees.geojson')
wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb['Sheet1']
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
idx = {name: i for i, name in enumerate(hdr)}
def clean(v): return (str(v).strip() if v is not None else "")
features = []
for r in rows[1:]:
    x, y = r[idx['X']], r[idx['Y']]
    props = {"S_N": r[idx['S.N.']],
             "Name_of_Organization": clean(r[idx['Name of Organization']]),
             "Location": clean(r[idx['Location']]),
             "Type_of_Grant": clean(r[idx['Type of Grant']]),
             "Commodities": clean(r[idx['Commodities/Enterprises']])}
    geom = None
    if x is not None and y is not None:
        try:
            geom = {"type": "Point", "coordinates": [float(x), float(y)]}
        except (TypeError, ValueError):
            pass
    features.append({"type": "Feature", "properties": props, "geometry": geom})
fc = {"type": "FeatureCollection", "name": "Grantees", "features": features}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(fc, f, ensure_ascii=False, indent=2)
```

- Result for the current sheet: 65 features (39 Point + 26 null geometry). The JS layer (`Grantees.js`)
  only carries the 39.
- **Coordinate order trap:** the sheet header is `S.N. | Name | Y | X | Location | Type_of_Grant |
  Commodities/Enterprises`. `Y` is latitude, `X` is longitude — GeoJSON wants `[lon, lat]`.
- Validate after writing: `json.load` the file, count `None` geometries, and sanity-check the
  lon/lat ranges fall inside Nepal (lon 80–88 E, lat 26–30 N).

## 2. Shapefile → GeoJSON (ogr2ogr, GDAL 3.8 installed)

```bash
cd ~/ssd/baato/FAO/FFF
ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
  Webmap/data/forest/forestPolygon.geojson \
  Webmap/data/forest/forestPolygon.shp
```

- All attributes preserved (32 fields for forestPolygon).
- Output CRS reported as `urn:ogc:def:crs:OGC:1.3:CRS84` (= WGS84 / EPSG:4326).
- forestPolygon result: 50 features (49 Polygon + 1 MultiPolygon).
- Then delete the shapefile parts from disk:
  `rm forestPolygon.shp forestPolygon.shx forestPolygon.dbf forestPolygon.prj forestPolygon.cst`
  (they were **untracked** in git, so no `git rm` needed — just remove from disk).
- Keep non-shapefile extras like `wfsrequest.txt` unless told otherwise.

## 3. Git checkpoint before data work (`before_data` tag)

```bash
cd ~/ssd/baato/FAO/FFF/Webmap
git add data/forest/forestPolygon.geojson        # stage only the task's file
git restore --staged data/churePolygon.geoJson   # unstage unrelated pre-staged files
git commit -m "Convert forestPolygon shapefile to GeoJSON; drop shapefile components"
git tag before_data
git push origin main
git push origin before_data
```

- Push to `origin` ONLY (not the `amritkarma.kll` second remote).
- Verify the tag reached the remote: `git ls-remote --tags origin | grep before_data`.
- Commit-scoping: do NOT bundle the large pile of unrelated working-tree changes (hassan/ template
  deletions, Notables_*.js deletions, Grantees.js regeneration) into the feature commit. Leave them
  uncommitted unless the user asks.
- The user's standing rule: never commit without explicit approval. "commit" and "tag it as before_data
  and push" were the approvals for this session.
