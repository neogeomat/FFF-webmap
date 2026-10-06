#!/usr/bin/env python3
"""Build data/fff.gpkg — a normalised GeoPackage projection of Grantees.combined.csv.

  python3 tools/make_gpkg.py            # write data/fff.gpkg
  python3 tools/make_gpkg.py --stats    # print the normalisation numbers, write nothing
  python3 tools/make_gpkg.py --print-ddl

Stdlib only (plus ogrinfo/ogrs2ogr for nothing — this script needs no GDAL). Re-runnable:
the output is rebuilt from scratch on every run. Validate with tests/check_gpkg.py.

Why the shape: org-level columns in the CSV are repeated on every grant row of that
organisation (8 S_N values have 2+ grants), so money summed over raw rows double-counts.
The CSV is normalised into organisation / grant / contract / women / restoration rows,
with the JSON blobs expanded into child tables and the org-level aggregate columns dropped
(they are exactly the child sums — tests/check_gpkg.py proves it).
"""
import collections
import csv
import hashlib
import io
import json
import re
import sqlite3
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # Webmap/
CSV_PATH = ROOT / 'data' / 'Grantees.combined.csv'
DISTRICT_GEOJSON = ROOT / 'data' / 'District.geojson'
GPKG_PATH = ROOT / 'data' / 'fff.gpkg'
SRID = 4326

# kind: text | int | num | date   (num -> NUMERIC / numeric, date -> TEXT / date)
# ponytail: this dict is the one source of truth for the schema. One table, one job.
SCHEMA = {
    'province': [
        ('province_id', 'int', 'PRIMARY KEY'),
        ('name', 'text', 'NOT NULL UNIQUE'),
    ],
    'district': [
        ('district_id', 'int', 'PRIMARY KEY'),
        ('name', 'text', 'NOT NULL UNIQUE'),
        ('province_id', 'int', 'NOT NULL REFERENCES province(province_id)'),
    ],
    'subcategory': [
        ('subcategory_id', 'int', 'PRIMARY KEY'),
        ('label', 'text', 'NOT NULL UNIQUE'),
        ('main_category', 'text', 'NOT NULL'),
    ],
    'organization': [
        ('org_sn', 'text', 'PRIMARY KEY'),
        ('name', 'text', 'NOT NULL'),
        ('source_name', 'text', ''),
        ('org_type', 'text', "CHECK (org_type IN ('cooperative','farmers_group','forest_sector'))"),
        ('location_text', 'text', ''),
        ('municipality', 'text', ''),
        ('district_id', 'int', 'REFERENCES district(district_id)'),
        ('province_id', 'int', 'REFERENCES province(province_id)'),
        ('area_ha', 'num', ''),
        ('direct_hh', 'int', ''),
        ('total_hh', 'int', ''),
    ],
    'grant_agreement': [                  # not `grant`: that word is reserved in PostgreSQL and would
        ('grant_sn', 'text', 'PRIMARY KEY'),   # need quoting in every query after the PostGIS import
        ('org_sn', 'text', 'NOT NULL REFERENCES organization(org_sn)'),
        ('grant_type', 'text', "NOT NULL CHECK (grant_type IN ('LoA','DBG'))"),
        ('title', 'text', ''),
        ('implementation_period', 'text', ''),
        ('commodity', 'text', ''),
        ('main_category', 'text', ''),
        ('subcategory_id', 'int', 'REFERENCES subcategory(subcategory_id)'),
        ('enterprise_classification', 'text', ''),
        ('area_ha', 'num', ''),
        ('direct_hh', 'int', ''),
        ('total_hh', 'int', ''),
    ],
    'contract': [
        ('contract_id', 'int', 'PRIMARY KEY'),
        ('org_sn', 'text', 'NOT NULL REFERENCES organization(org_sn)'),
        ('sheet', 'text', "NOT NULL CHECK (sheet IN ('LoA','DBG'))"),
        ('source_org_name', 'text', ''),
        ('site_code', 'text', ''),
        ('service_start', 'date', ''),
        ('service_end', 'date', ''),
        ('currency', 'text', ''),
        ('amount_local', 'num', 'NOT NULL'),
        ('amount_usd', 'num', 'NOT NULL'),
    ],
    'women_enterprise': [
        ('women_id', 'int', 'PRIMARY KEY'),
        ('org_sn', 'text', 'NOT NULL REFERENCES organization(org_sn)'),
        ('producer_group', 'text', ''),
        ('year_block', 'text', ''),
        ('women_count', 'int', 'CHECK (women_count IS NULL OR women_count >= 0)'),
        ('product', 'text', ''),
    ],
    'restoration': [
        ('restoration_id', 'int', 'PRIMARY KEY'),
        ('org_sn', 'text', 'NOT NULL REFERENCES organization(org_sn)'),
        ('source_org_name', 'text', ''),
        ('year_block', 'text', ''),
        ('area_direct_ha', 'num', ''),
        ('area_contributed_ha', 'num', ''),
        ('people_benefited', 'int', ''),
    ],
    'organization_location': [          # GeoPackage feature table: 'fid' is the integer PK
        ('fid', 'int', 'PRIMARY KEY'),
        ('org_sn', 'text', 'NOT NULL UNIQUE REFERENCES organization(org_sn)'),
        ('lon', 'num', 'NOT NULL'),
        ('lat', 'num', 'NOT NULL'),
    ],
    'build_issue': [
        ('issue_id', 'int', 'PRIMARY KEY'),
        ('severity', 'text', "NOT NULL CHECK (severity IN ('error','warning'))"),
        ('table_name', 'text', ''),
        ('source_key', 'text', ''),
        ('message', 'text', 'NOT NULL'),
    ],
    'build_meta': [
        ('key', 'text', 'PRIMARY KEY'),
        ('value', 'text', ''),
    ],
}
TABLE_CONSTRAINTS = {
    'contract': ['UNIQUE (org_sn, sheet, site_code, service_start, amount_local)'],
}

# Readable access layer. The CSV's org-level aggregate columns are gone (derived data), so the
# queries the map/site actually ask (money per org, per district, per value chain) live here
# instead of being recomputed by hand in every consumer.
VIEWS = [
    ('v_organization_overview', """
        SELECT o.org_sn, o.name, o.org_type,
               d.name AS district, p.name AS province,
               CASE WHEN l.org_sn IS NULL THEN 0 ELSE 1 END AS has_location,
               (SELECT COUNT(*) FROM grant_agreement g WHERE g.org_sn = o.org_sn)       AS grants,
               (SELECT COUNT(*) FROM contract c WHERE c.org_sn = o.org_sn)    AS contracts,
               (SELECT COALESCE(SUM(c.amount_usd), 0) FROM contract c WHERE c.org_sn = o.org_sn) AS total_usd,
               (SELECT COALESCE(SUM(r.area_direct_ha + COALESCE(r.area_contributed_ha, 0)), 0)
                  FROM restoration r WHERE r.org_sn = o.org_sn)               AS restored_ha
        FROM organization o
        LEFT JOIN district d ON d.district_id = o.district_id
        LEFT JOIN province p ON p.province_id = o.province_id
        LEFT JOIN organization_location l ON l.org_sn = o.org_sn"""),
    ('v_contract_detail', """
        SELECT c.contract_id, c.org_sn, o.name, c.sheet, c.site_code,
               c.service_start, c.service_end, c.currency, c.amount_local, c.amount_usd
        FROM contract c JOIN organization o ON o.org_sn = c.org_sn"""),
    ('v_money_by_district', """
        SELECT COALESCE(d.name, '(unlocated)') AS district, p.name AS province,
               COUNT(DISTINCT o.org_sn) AS orgs, COUNT(c.contract_id) AS contracts,
               SUM(c.amount_usd) AS total_usd
        FROM organization o
        LEFT JOIN district d ON d.district_id = o.district_id
        LEFT JOIN province p ON p.province_id = o.province_id
        LEFT JOIN contract c ON c.org_sn = o.org_sn
        GROUP BY d.name, p.name"""),
    ('v_value_chain_summary', """
        SELECT COALESCE(s.label, '(unclassified)') AS subcategory,
               COALESCE(s.main_category, '(unclassified)') AS main_category,
               COUNT(DISTINCT g.org_sn) AS orgs, COUNT(g.grant_sn) AS grants,
               COALESCE(SUM((SELECT SUM(c.amount_usd) FROM contract c
                              WHERE c.org_sn = g.org_sn)), 0) AS total_usd
        FROM grant_agreement g LEFT JOIN subcategory s ON s.subcategory_id = g.subcategory_id
        GROUP BY s.label, s.main_category"""),
]

KIND_SQLITE = {'text': 'TEXT', 'int': 'INTEGER', 'num': 'NUMERIC', 'date': 'TEXT'}

# CSV district / province spellings that differ from District.geojson. Verified against the
# 16 distinct CSV district names: these 6 are the complete set of mismatches.
ALIAS = {
    'chitwan': 'CHITAWAN',                 # geojson spelling
    'kapilvastu': 'KAPILBASTU',
    'kavrepalanchok': 'KABHREPALANCHOK',   # geojson spelling
    'makwanpur': 'MAKAWANPUR',
    'nawalparasi': 'NAWALPARASI EAST',     # every CSV row for this name is province Gandaki
    'nawalpur': 'NAWALPARASI EAST',
}


def ddl():
    out = []
    for table, cols in SCHEMA.items():
        body = [f'  {n} {KIND_SQLITE[k]} {extra}'.rstrip() for n, k, extra in cols]
        body += [f'  {c}' for c in TABLE_CONSTRAINTS.get(table, [])]
        out.append(f'CREATE TABLE {table} (\n' + ',\n'.join(body) + '\n);')
    return '\n\n'.join(out)


def load_rows():
    return list(csv.DictReader(io.StringIO(CSV_PATH.read_text(encoding='utf-8-sig'))))


def norm_name(s):
    return re.sub(r'[^a-z]', '', (s or '').lower())


def num(v):
    v = (v or '').strip()
    return float(v) if v else None


def integer(v):
    v = (v or '').strip()
    return int(float(v)) if v else None


def clean(name):
    """Title-case ALL-CAPS source names, leave mixed case alone (mirrors the map's cleanOrgName)."""
    name = (name or '').strip()
    return name.title() if name and name.isupper() else name


def nn(v):
    """Blank string -> NULL. Absent means absent: '' would defeat CHECK constraints and FKs."""
    v = (v or '').strip()
    return v or None


def lookup_tables():
    """7 provinces (fixed) + 77 districts seeded from District.geojson (STATE_CODE = province id)."""
    prov_names = {1: 'Koshi', 2: 'Madhesh', 3: 'Bagmati', 4: 'Gandaki',
                  5: 'Lumbini', 6: 'Karnali', 7: 'Sudurpashchim'}
    gj = json.loads(DISTRICT_GEOJSON.read_text(encoding='utf-8'))
    districts, id_of = [], {}
    for f in gj['features']:
        p = f['properties']
        name = (p.get('DISTRICT') or '').strip().upper()
        pid = int(p.get('STATE_CODE') or 0)
        if not name or pid not in prov_names or name in id_of:
            continue
        id_of[name] = len(districts) + 1
        districts.append((id_of[name], name, pid))
    canonical = {norm_name(n): i for n, i in id_of.items()}
    for csv_name, gj_name in ALIAS.items():
        if norm_name(gj_name) in canonical:
            canonical[csv_name] = canonical[norm_name(gj_name)]
    return list(prov_names.items()), districts, canonical, canonical_province()


def canonical_province():
    return {norm_name(n): i for i, n in {1: 'Koshi', 2: 'Madhesh', 3: 'Bagmati', 4: 'Gandaki',
                                         5: 'Lumbini', 6: 'Karnali', 7: 'Sudurpashchim'}.items()}


def build():
    rows = load_rows()
    issues, tables = [], {}
    provinces, districts, canonical, prov_id = lookup_tables()
    tables['province'], tables['district'] = provinces, districts

    # ---- organisations: first row per S_N wins (org columns repeat on every grant row)
    orgs, first = [], {}
    for r in rows:
        sn = r['S_N'].strip()
        if sn in first:
            continue
        first[sn] = r
        did = canonical.get(norm_name(r['district']))
        if r['district'].strip() and did is None:
            issues.append(('error', 'organization', sn, f"unmatched district {r['district']!r}"))
        pid = next((p for i, n, p in districts if i == did), None) if did is not None else None
        if pid is None and r['province'].strip():
            pid = prov_id.get(norm_name(r['province']))
            if pid is None:
                issues.append(('warning', 'organization', sn, f"unmatched province {r['province']!r}"))
        orgs.append((sn, clean(r['org_name_geojson']) or sn, nn(r['grantee_name_grantCSV']),
                     nn(r['organization_type']), nn(r['Location_geojson']), nn(r['municipality']),
                     did, pid, num(r['area_ha_org']), integer(r['direct_hh']), integer(r['total_hh'])))
    tables['organization'] = orgs

    # ---- subcategories (23 labels) with their canonical main category.
    # The CSV is NOT a function here: 7 labels appear under two different main_category values (the
    # blank main_category on A1-A6 rows, plus 'Timber'/'Handicraft'/'Fertiliser'/'NTFP'/'Sal leaf
    # plates' under both 'Forest-based' and 'Other / needs review'). The lookup table keeps the first
    # non-blank value as the controlled-vocabulary default; the grant row keeps its own source value;
    # every disagreement is recorded once, per label, as a build_issue warning.
    subs, sub_id, sub_mains = [], {}, {}
    for r in rows:
        label, main = r['subcategory'].strip(), r['main_category'].strip()
        if not label:
            continue
        sub_mains.setdefault(label, collections.Counter())[main] += 1
        if label not in sub_id:
            sub_id[label] = [len(subs) + 1, main]
            subs.append((sub_id[label][0], label, main))
        elif not sub_id[label][1] and main:
            sub_id[label][1] = main
            subs[sub_id[label][0] - 1] = (sub_id[label][0], label, main)
    for label, counts in sub_mains.items():
        real = [c for c in counts if c]
        if len(real) > 1:
            issues.append(('warning', 'subcategory', label,
                           'main_category conflict: ' + ', '.join(f'{c!r} x{counts[c]}' for c in sorted(counts, key=str))))
        elif counts.get(''):
            issues.append(('warning', 'subcategory', label,
                           f"main_category blank on {counts['']} row(s); using {sub_id[label][1]!r}"))
    tables['subcategory'] = subs

    # ---- grants (one per row that has a grant_sn)
    grants, seen_grants = [], set()
    for r in rows:
        gsn = r['grant_sn'].strip()
        if not gsn:
            continue
        if gsn in seen_grants:
            issues.append(('error', 'grant', gsn, 'duplicate grant_sn in the CSV'))
            continue
        seen_grants.add(gsn)
        sn = r['S_N'].strip()
        if sn not in first:
            issues.append(('error', 'grant', gsn, f'grant points at unknown S_N {sn!r}'))
            continue
        gtype = r['Type_of_Grant_geojson'].strip()
        if gtype not in ('LoA', 'DBG'):
            issues.append(('error', 'grant', gsn, f'unexpected grant type {gtype!r}'))
        grants.append((gsn, sn, gtype, r['grant_title'].strip(), r['implementation_period'].strip(),
                       r['Commodities_geojson'].strip(), r['main_category'].strip(),
                       sub_id.get(r['subcategory'].strip(), (None,))[0],
                       r['enterprise_classification'].strip(), num(r['area_ha_org']),
                       integer(r['direct_hh']), integer(r['total_hh'])))
    tables['grant_agreement'] = grants

    # ---- JSON children, de-duplicated on the full tuple (the same blob repeats across grant rows)
    contracts, women, rest = {}, {}, {}
    raw = {'contract': 0, 'women_enterprise': 0, 'restoration': 0}
    for r in rows:
        sn = r['S_N'].strip()
        for o in json.loads(r['finance_json'] or '[]'):
            raw['contract'] += 1
            key = (sn, o['sheet'], o['site_code'], o['service_start'], o['cur_value'])
            contracts.setdefault(key, (sn, o['sheet'], o['org_name_raw'], o['site_code'], o['service_start'],
                                       o['service_end'], o['cur'], o['cur_value'], o['usd_value']))
        for o in json.loads(r['women_json'] or '[]'):
            raw['women_enterprise'] += 1
            key = (sn, o['producer_group'], o['year_block'], o['product'])
            women.setdefault(key, (sn, o['producer_group'], o['year_block'], o['women_count'], o['product']))
        for o in json.loads(r['restoration_json'] or '[]'):
            raw['restoration'] += 1
            key = (sn, o['org_name'], o['year_block'], o['area_direct_ha'], o['people_benefited'])
            rest.setdefault(key, (sn, o['org_name'], o['year_block'], o['area_direct_ha'],
                                  o['area_contributed_ha'], o['people_benefited']))
    tables['contract'] = [(i + 1,) + v for i, v in enumerate(contracts.values())]
    tables['women_enterprise'] = [(i + 1,) + v for i, v in enumerate(women.values())]
    tables['restoration'] = [(i + 1,) + v for i, v in enumerate(rest.values())]
    for table, n in (('contract', len(contracts)), ('women_enterprise', len(women)), ('restoration', len(rest))):
        if raw[table] != n:
            issues.append(('warning', table, '-',
                           f'{raw[table] - n} of {raw[table]} source objects collapsed as repeats '
                           f'(org columns repeat per grant row); {n} distinct rows kept'))

    # ---- locations: one row per organisation whose WKT parses; cross-checked against X/Y
    locs, seen_loc = [], set()
    for sn, r in first.items():
        m = re.match(r'POINT\s*\(\s*([-0-9.]+)\s+([-0-9.]+)\s*\)', r['WKT'].strip())
        if r['has_geometry'].strip() == 'TRUE' and not m:
            issues.append(('error', 'organization_location', sn, 'has_geometry=TRUE but no parsable WKT'))
        if r['has_geometry'].strip() != 'TRUE' and m:
            # The CSV flag is stale for these rows; the WKT/X/Y is authoritative, so keep the point and say so.
            issues.append(('warning', 'organization_location', sn,
                           'has_geometry=FALSE but WKT is present — flag ignored, location row created'))
        if not m:
            if (r['X'].strip() or r['Y'].strip()) and not r['WKT'].strip():
                issues.append(('warning', 'organization_location', sn, 'X/Y present but WKT missing'))
            continue
        lon, lat = float(m.group(1)), float(m.group(2))
        if (r['X'].strip() and abs(float(r['X']) - lon) > 1e-6) or \
           (r['Y'].strip() and abs(float(r['Y']) - lat) > 1e-6):
            issues.append(('error', 'organization_location', sn,
                           f'WKT {lon},{lat} disagrees with X/Y {r["X"]},{r["Y"]}'))
        if sn not in seen_loc:
            seen_loc.add(sn)
            locs.append((len(locs) + 1, sn, lon, lat))
    tables['organization_location'] = locs

    tables['build_issue'] = [(i + 1,) + t for i, t in enumerate(issues)]
    stats = {
        'orgs': len(orgs), 'grants': len(grants),
        'grantless': sum(1 for sn in first if sn not in {g[1] for g in grants}),
        'contracts': len(tables['contract']),
        'contracts_loa': sum(1 for c in tables['contract'] if c[2] == 'LoA'),
        'contracts_dbg': sum(1 for c in tables['contract'] if c[2] == 'DBG'),
        'usd_contracts': round(sum(c[9] for c in tables['contract']), 2),
        'usd_org_aggregate': round(sum(float(r['finance_total_USD_org'] or 0) for r in first.values()), 2),
        'located_orgs': len(locs),
        'subcategories': len(subs),
        'women_rows': len(tables['women_enterprise']),
        'restoration_rows': len(tables['restoration']),
        'districts_csv': len({r['district'].strip() for r in rows if r['district'].strip()}),
        'orgs_with_district': sum(1 for o in orgs if o[6] is not None),
        'orgs_with_province': sum(1 for o in orgs if o[7] is not None),
        'issues': len(issues), 'errors': sum(1 for i in issues if i[0] == 'error'),
    }
    return tables, stats, issues


def gp_blob(lon, lat):
    """GeoPackage geometry blob: 8-byte header (magic 'GP', version 0, flags 0x01 = little-endian, no
    envelope, srs_id) + standard WKB Point. '<2sBBI' has no padding, so the header is exactly 8 bytes."""
    return struct.pack('<2sBBI', b'GP', 0, 0x01, SRID) + struct.pack('<BIdd', 1, 1, lon, lat)


def gpkg_metadata(db, tables):
    db.executescript("""
        CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL, description TEXT);
        CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
            identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change TEXT NOT NULL,
            min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
            CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
        CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
            PRIMARY KEY (table_name, column_name),
            CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
    """)
    wgs84 = ('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,'
             'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,'
             'AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,'
             'AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]')
    db.executemany('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)', [
        ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', None),
        ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', None),
        ('WGS 84 geodetic', 4326, 'EPSG', 4326, wgs84, None),
    ])
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
    lon = [r[2] for r in tables['organization_location']]
    lat = [r[3] for r in tables['organization_location']]
    for t in SCHEMA:
        feature = t == 'organization_location'
        db.execute('INSERT INTO gpkg_contents (table_name, data_type, identifier, last_change, '
                   'min_x, min_y, max_x, max_y, srs_id) VALUES (?,?,?,?,?,?,?,?,?)',
                   (t, 'features' if feature else 'attributes', t, now,
                    min(lon) if feature else None, min(lat) if feature else None,
                    max(lon) if feature else None, max(lat) if feature else None,
                    SRID if feature else None))
    db.execute("INSERT INTO gpkg_geometry_columns VALUES ('organization_location','geom','POINT',?,0,0)",
               (SRID,))


def write_gpkg(tables, stats):
    """Write the GeoPackage — or leave nothing behind at all (no half-written file that looks real)."""
    try:
        _write_gpkg(tables, stats)
    except Exception:
        GPKG_PATH.unlink(missing_ok=True)
        raise


def _write_gpkg(tables, stats):
    if GPKG_PATH.exists():
        GPKG_PATH.unlink()
    db = sqlite3.connect(GPKG_PATH)
    db.execute('PRAGMA foreign_keys = ON')
    db.executescript(ddl())
    db.execute('ALTER TABLE organization_location ADD COLUMN geom BLOB')   # not in SCHEMA: blob, no DDL type
    for table, cols in SCHEMA.items():
        names = [c[0] for c in cols] + (['geom'] if table == 'organization_location' else [])
        payload = []
        for row in tables.get(table, []):
            row = list(row) + ([gp_blob(row[2], row[3])] if table == 'organization_location' else [])
            payload.append(row)
        db.executemany(f"INSERT INTO {table} ({','.join(names)}) VALUES ({','.join('?' * len(names))})", payload)
    for name, sql in VIEWS:
        db.execute(f'CREATE VIEW {name} AS {sql}')
    gpkg_metadata(db, tables)
    meta = [('built_at', datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')),
            ('built_by', 'tools/make_gpkg.py'),
            ('source_csv', str(CSV_PATH.relative_to(ROOT))),
            ('source_md5', hashlib.md5(CSV_PATH.read_bytes()).hexdigest()),
            ('source_district_geojson_md5', hashlib.md5(DISTRICT_GEOJSON.read_bytes()).hexdigest())]
    meta += [(f'count_{k}', str(v)) for k, v in stats.items() if k not in ('issues', 'errors')]
    db.executemany('INSERT INTO build_meta (key, value) VALUES (?,?)', sorted(meta))
    db.execute('PRAGMA application_id = 1196444487')   # 'GPKG'
    db.execute('PRAGMA user_version = 10300')          # GeoPackage 1.3.0
    db.commit()
    db.execute('VACUUM')
    db.close()
    print(f'wrote {GPKG_PATH.relative_to(ROOT)} ({GPKG_PATH.stat().st_size:,} bytes)')


def main():
    tables, stats, issues = build()
    if '--print-ddl' in sys.argv:
        print(ddl())
        return 1 if stats['errors'] else 0
    for k, v in stats.items():
        print(f'{k:22} {v}')
    if issues:
        print('\nbuild issues:')
        for sev, table, key, msg in issues:
            print(f'  {sev:7} {table:21} {key if key != "-" else "":6} {msg}')
    if '--stats' in sys.argv:
        return 1 if stats['errors'] else 0
    if stats['errors']:
        print('\nrefusing to write: fix the errors above', file=sys.stderr)
        return 1
    print()
    write_gpkg(tables, stats)
    return 0


if __name__ == '__main__':
    sys.exit(main())
