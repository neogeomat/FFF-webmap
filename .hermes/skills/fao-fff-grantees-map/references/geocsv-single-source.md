# Single-source grantee layer (data/Grantees.combined.geocsv)

How `js/map.js` builds the Organizations layer since 2026-09. Replaces the old leaflet-ajax recipe: the plugin
and `data/Grantees.geojson` are no longer loaded by the page (the geojson survives only as a pipeline input to
`make_geocsv.py`).

Build it with `cd Webmap && python3 tools/make_geocsv.py` (the script lives IN the repo since 2026-09-14; it
used to sit in the unversioned project root). Probes live in `Webmap/tests/` (see `tests/README`).

## Where the data comes from

`Webmap/data/moreDataFromFFF/` holds 8 "Map Categories_Final.xlsx - *.csv" sheets; **only 4 carry data** (the other
4 are prose specs): Enterprise Commodity Map (73 grants: grantee, period, title, commodity, `Main Category`,
`Subcategory`), Nature of Enterprises Map (same 73 grants + `Enterprise Classification`), Women Led Enterprise Map
(producer group + `women_count` + product, by year block) and Restoration_Landscape Impact Map (`area_ha` +
`people_benefited`, by year block). Org-level fields (`Direct HH`, `Total Households`, `Area (Ha)`, municipality,
district, province) come from `data/DRAFT_FFF_FFPOs_Details.xlsx` Sheet 1, split into COOPERATIVES / FARMERS GROUPS
/ FOREST SECTOR blocks. Money comes from `data/DBG & LoA (2019-2026).xlsx` (`LoA (2019-26)` + `DBG (2023-26)`
sheets). Geometry comes from the hand-maintained `data/Grantees.geojson`.

## The loader (in `js/map.js`, inside the `DOMContentLoaded` closure)

```js
map.createPane('pane_Grantees');
map.getPane('pane_Grantees').style.zIndex = 650;

// 1. empty layer up front, same options as before
var layer_Grantees = L.geoJSON(null, {
    attribution: '', pane: 'pane_Grantees',
    onEachFeature: pop_Grantees,
    pointToLayer: function(feature, latlng) {
        var marker = L.marker(latlng, style_Grantees_div_icon(feature));
        marker.bindTooltip((feature.properties.Name_of_Organization || ('S.N. ' + feature.properties.S_N)), {
            direction: 'top', className: 'org-tip-name', offset: [0, -12],
            permanent: true, interactive: false });   // name always visible, pointer passes through
        return marker;
    }
});

// 2. one fetch, parsed as ONE string (cells contain quoted newlines + commas)
function wktPoint(wkt) {
    var m = /POINT\s*\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/i.exec(wkt || '');
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
var moneyBySN = {};
var attrsFromCsv = { orgs: [], grants: [] };   // exactly the shape buildEvoData() reads
var rowsReadyDone = false;
var rowsReady = fetch('data/Grantees.combined.geocsv')
    .then(function(r) { if (!r.ok) { throw new Error('geocsv ' + r.status); } return r.text(); })
    .then(function(txt) {
        var csvRows = parseCsv(txt.replace(/^\uFEFF/, ''));          // hoisted function declaration
        var head = csvRows.shift() || [], ix = {};
        head.forEach(function(h, i) { ix[h.trim()] = i; });
        var cell = function(r, c) { var i = ix[c]; return (i === undefined || !r[i]) ? '' : r[i].trim(); };
        var byOrg = {};
        csvRows.forEach(function(r) {
            var sn = cell(r, 'S_N');
            if (!sn) { return; }
            var o = byOrg[sn];
            if (!o) {
                o = byOrg[sn] = { props: { S_N: isNaN(+sn) ? sn : +sn, /* org props */ },
                                  grants: [], subcats: {}, classes: {}, women: [], restoration: [],
                                  geom: wktPoint(cell(r, 'WKT')) };
                moneyBySN[sn] = { loa: parseFloat(cell(r, 'loa_total_USD_org')) || 0,
                                  dbg: parseFloat(cell(r, 'dbg_total_USD_org')) || 0,
                                  cls: cell(r, 'enterprise_classification') || 'Unclassified' };
                attrsFromCsv.orgs.push({ org_id: +sn, district: ..., municipality: ..., location: ... });
            }
            if (cell(r, 'grant_sn')) { /* push g into o.grants and attrsFromCsv.grants */ }
            if (cell(r, 'women_json')) { o.women = JSON.parse(cell(r, 'women_json')); }
            if (cell(r, 'restoration_json')) { o.restoration = JSON.parse(cell(r, 'restoration_json')); }
        });
        return byOrg;
    })
    .catch(function(e) { console.warn('geocsv load failed - the map stays empty', e); return {}; });

// 3. features, then fire the event the rest of the file waits for
rowsReady.then(function(byOrg) {
    var features = [];
    Object.keys(byOrg).forEach(function(sn) {
        var o = byOrg[sn];
        if (!o.geom) { return; }                    // no coordinates -> no marker
        var p = o.props;
        p.grants = o.grants; p.women = o.women; p.restoration = o.restoration;
        p.subcategories = Object.keys(o.subcats); if (!p.subcategories.length) { p.subcategories = ['Unclassified']; }
        p.enterprise_classifications = Object.keys(o.classes);
        /* sum people_benefited / area_direct_ha / area_contributed_ha from p.restoration */
        features.push({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: o.geom } });
    });
    layer_Grantees.addData(features);
    rowsReadyDone = true;
    layer_Grantees.fire('data:loaded');
});
```

## Ordering contract (easy to break)

- The `layer_Grantees.on('data:loaded', function(){ ... })` handler is registered AFTER the loader, and the event
  is fired by the loader's promise. That is safe because a promise callback always runs in a microtask after the
  rest of the script has evaluated — so the handler exists when `fire()` runs. Do **not** call
  `fire('data:loaded')` synchronously, and do not move the loader below the handler if you also `await` it.
- Everything feature-dependent stays inside that handler: `clusters_Grantees.addLayer`/`addTo`/`bounds_group`/
  `setBounds()`, `buildGranteeFilters()`, `buildGranteeTable()`, `refreshCommodityIcons()`, `buildCommodityLegend()`,
  `renderAggregates/renderInvestment/renderSankey(null)`, then `setMapMode(localStorage.getItem('fff.mapMode') || 'overview')` last.
- `buildEvoData(attrsFromCsv)` needs `{orgs:[{org_id,district,municipality,location}], grants:[{org_id,implementation_period,subcategory}]}`
  — the loader builds that shape so `buildEvoData()` itself never had to change.
- The evolution amount column and `renderInvestment()` wait on `rowsReady` (`rowsReadyDone` tracks completion);
  they used to wait on the retired `csvReady` money fetch.

## Column contract (from `make_geocsv.py`)

| used for | columns |
|---|---|
| identity / marker | `S_N`, `has_geometry`, `WKT`, `org_name_geojson`, `Location_geojson`, `Type_of_Grant_geojson`, `Commodities_geojson` |
| org attributes | `organization_type`, `municipality`, `district`, `province`, `direct_hh`, `total_hh`, `area_ha_org` |
| grants (one row each) | `grant_sn`, `grant_title`, `grantee_name_grantCSV`, `implementation_period`, `enterprise_commodity`, `main_category`, `subcategory`, `enterprise_classification` |
| records (org-level, repeat per row) | `women_json`, `restoration_json` (+ the count columns `women_records_org`, `women_count_org`, `restoration_records_org`, `area_direct_total_org`, `area_contributed_total_org`, `people_benefited_total_org`) |
| finance (org-level, repeat per row) | `loa_total_USD_org`, `dbg_total_USD_org`, `loa_contracts_org` / `dbg_contracts_org` … |
| finance per CONTRACT (`finance_json`) | `service_start`, `service_end`, `sheet` (LoA/DBG), `cur`, `cur_value`, `usd_value`, `site_code` — this is what makes the evolution amounts real |

`X`/`Y` are NOT the coordinate source (blank on HH-only rows) — parse `WKT`.

## Verification

`Webmap/tests/probe_geocsv_source.js` (13 assertions): no request to `Grantees.geojson` /
`grantees_attributes.json`, exactly one geocsv request, no leaflet-ajax script, 36 orgs, money 2,288,256 USD in
both the chart and the evolution column, 13 women-led orgs, a hover card carrying Restoration +
Enterprise Classification rows, no page errors. Test-format rules: `references/leaflet-browser-verify.md`.

## Pitfalls hit while doing the migration

- **Record counts change.** The geocsv has 22 women / 61 restoration records vs 23 / 70 in the retired JSON,
  because the extra 10 belong to synthetic `A7–A15` orgs with no coordinates and no row. Check "who lost a
  record" before assuming a parser bug: map every missing record to its org and ask if that org can render.
- **Any "did my migration break this?" question is answered by A/B, not by reading the diff:** serve a
  `git archive HEAD` copy on a second port and run the same probe against both. Recipe:
  `references/leaflet-browser-verify.md` ("Is this MY regression?").
- Keep `window.chartInvestment && window.chartInvestment.data` guards — the chart may not exist yet when the
  loader resolves.
