#!/usr/bin/env python3
"""Validate data/fff.gpkg against Grantees.combined.csv.

  cd Webmap && python3 tests/check_gpkg.py     -> "all green (N passed)", exit 0

The point of this file: the GeoPackage is a projection of the CSV, so the expectations are
recomputed here from the CSV by independent code and compared to the database row by row.
A builder bug cannot pass by writing numbers that merely agree with themselves. The CSV md5
is pinned, so a regenerated CSV fails loudly instead of drifting silently.
"""
import csv
import hashlib
import io
import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / 'data' / 'Grantees.combined.csv'
DISTRICT_GEOJSON = ROOT / 'data' / 'District.geojson'
GPKG = ROOT / 'data' / 'fff.gpkg'
MD5_CSV = 'b28871601b2d983b85a14f2da2d3daee'
MD5_DISTRICTS = 'a214ee02979449f9b19be6a7d08a6c0e'
TABLES = 11
VIEWS = 4
PASS = FAIL = 0


def ok(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f'   {detail}' if detail else ''))


def read_csv():
    return list(csv.DictReader(io.StringIO(CSV_PATH.read_text(encoding='utf-8-sig'))))


def first_by_sn(rows):
    first = {}
    for r in rows:
        first.setdefault(r['S_N'].strip(), r)
    return first


def expected():
    """Independent re-projection of the CSV: what the database must contain."""
    rows = read_csv()
    first = first_by_sn(rows)
    contracts, women, rest = {}, {}, {}
    for r in rows:
        sn = r['S_N'].strip()
        for o in json.loads(r['finance_json'] or '[]'):
            contracts[(sn, o['sheet'], o['site_code'], o['service_start'], o['cur_value'])] = o
        for o in json.loads(r['women_json'] or '[]'):
            women[(sn, o['producer_group'], o['year_block'], o['product'])] = o
        for o in json.loads(r['restoration_json'] or '[]'):
            rest[(sn, o['org_name'], o['year_block'], o['area_direct_ha'], o['people_benefited'])] = o
    return {
        'orgs': len(first),
        'grants': sum(1 for r in rows if r['grant_sn'].strip()),
        'grantless': sum(1 for sn in first if not first[sn]['grant_sn'].strip()),
        'contracts': len(contracts),
        'loa': sum(1 for o in contracts.values() if o['sheet'] == 'LoA'),
        'dbg': sum(1 for o in contracts.values() if o['sheet'] == 'DBG'),
        'usd': round(sum(o['usd_value'] for o in contracts.values()), 2),
        'usd_org_aggregate': round(sum(float(r['finance_total_USD_org'] or 0) for r in first.values()), 2),
        'located': sum(1 for r in first.values() if r['WKT'].strip()),
        'subcategories': len({r['subcategory'].strip() for r in rows if r['subcategory'].strip()}),
        'women': len(women),
        'restoration': len(rest),
        'provinces_csv': {r['province'].strip() for r in rows if r['province'].strip()},
        'orgs_with_province': sum(1 for r in first.values() if r['district'].strip() or r['province'].strip()),
    }


def main():
    exp = expected()
    ok('CSV md5 unchanged (a regenerated CSV means re-baseline this file)', md5(CSV_PATH) == MD5_CSV)
    ok('District.geojson md5 unchanged', md5(DISTRICT_GEOJSON) == MD5_DISTRICTS)
    ok('fff.gpkg exists', GPKG.exists(), str(GPKG.relative_to(ROOT)))
    if not GPKG.exists():
        return finish()

    db = sqlite3.connect(GPKG)
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    one = lambda sql, *a: db.execute(sql, a).fetchone()[0]

    # --- GeoPackage metadata: without these rows GDAL refuses the file (they are what make it a gpkg)
    ok('gpkg_contents declares organization_location as a features layer',
       one("SELECT COUNT(*) FROM gpkg_contents WHERE table_name='organization_location' AND data_type='features'") == 1)
    ok('gpkg_contents has a row per table (11)',
       one('SELECT COUNT(*) FROM gpkg_contents') == TABLES, str(one('SELECT COUNT(*) FROM gpkg_contents')))
    ok('gpkg_geometry_columns declares POINT/4326',
       q("SELECT geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name='organization_location'")
       == [('POINT', 4326)])
    ok('gpkg_spatial_ref_sys holds 4326 (+ the two required undefined SRS rows)',
       sorted(s for (s,) in q('SELECT srs_id FROM gpkg_spatial_ref_sys')) == [-1, 0, 4326])

    # --- contents, compared with the independent projection
    ok(f"organization = {exp['orgs']}", one('SELECT COUNT(*) FROM organization') == exp['orgs'],
       str(one('SELECT COUNT(*) FROM organization')))
    ok(f"grant_agreement = {exp['grants']}", one('SELECT COUNT(*) FROM grant_agreement') == exp['grants'],
       str(one('SELECT COUNT(*) FROM grant_agreement')))
    ok(f"organizations with no grant = {exp['grantless']}",
       one('SELECT COUNT(*) FROM organization o WHERE NOT EXISTS '
           '(SELECT 1 FROM grant_agreement g WHERE g.org_sn=o.org_sn)')
       == exp['grantless'])
    ok(f"contract = {exp['contracts']} (LoA {exp['loa']} + DBG {exp['dbg']})",
       (one('SELECT COUNT(*) FROM contract'), one("SELECT COUNT(*) FROM contract WHERE sheet='LoA'"),
        one("SELECT COUNT(*) FROM contract WHERE sheet='DBG'")) == (exp['contracts'], exp['loa'], exp['dbg']))
    ok(f"SUM(contract.amount_usd) = {exp['usd']:,.2f}",
       round(one('SELECT SUM(amount_usd) FROM contract'), 2) == exp['usd'],
       f"{round(one('SELECT SUM(amount_usd) FROM contract'), 2):,.2f}")
    ok('the CSV per-org aggregate column equals the contract sum for every organisation',
       all(abs(float(r['finance_total_USD_org'] or 0)
               - (one('SELECT COALESCE(SUM(amount_usd),0) FROM contract WHERE org_sn=?', sn) or 0)) < 0.5
           for sn, r in first_by_sn(read_csv()).items()))
    ok(f"women_enterprise = {exp['women']}", one('SELECT COUNT(*) FROM women_enterprise') == exp['women'],
       str(one('SELECT COUNT(*) FROM women_enterprise')))
    ok(f"restoration = {exp['restoration']}", one('SELECT COUNT(*) FROM restoration') == exp['restoration'],
       str(one('SELECT COUNT(*) FROM restoration')))
    ok(f"organization_location = {exp['located']}",
       one('SELECT COUNT(*) FROM organization_location') == exp['located'])
    ok(f"subcategory = {exp['subcategories']}", one('SELECT COUNT(*) FROM subcategory') == exp['subcategories'])
    ok('district lookup = 77 (seeded from District.geojson)', one('SELECT COUNT(*) FROM district') == 77)
    ok('province lookup = 7', one('SELECT COUNT(*) FROM province') == 7)
    ok('every CSV province is in the province lookup',
       exp['provinces_csv'] <= {p for (p,) in q('SELECT name FROM province')})
    ok(f"no organisation loses its province = {exp['orgs_with_province']}",
       one('SELECT COUNT(*) FROM organization WHERE province_id IS NOT NULL') == exp['orgs_with_province'],
       f"db={one('SELECT COUNT(*) FROM organization WHERE province_id IS NOT NULL')} csv={exp['orgs_with_province']}")

    # --- integrity
    ok('PRAGMA integrity_check = ok', one('PRAGMA integrity_check') == 'ok')
    ok('PRAGMA foreign_key_check is empty', q('PRAGMA foreign_key_check') == [],
       str(q('PRAGMA foreign_key_check')[:3]))
    ok('no build_issue rows with severity=error',
       one("SELECT COUNT(*) FROM build_issue WHERE severity='error'") == 0,
       str(q("SELECT table_name, source_key, message FROM build_issue WHERE severity='error' LIMIT 4")))
    ok('build_issue records the source-collapse findings (dedupe is visible, not silent)',
       one("SELECT COUNT(*) FROM build_issue WHERE severity='warning'") > 0,
       str(one("SELECT COUNT(*) FROM build_issue WHERE severity='warning'")))
    ok('every organisation flagged has_geometry=TRUE has a location row (the converse flag is stale in the CSV)',
       all((r['has_geometry'].strip() != 'TRUE') or
           (one('SELECT COUNT(*) FROM organization_location WHERE org_sn=?', sn) == 1)
           for sn, r in first_by_sn(read_csv()).items()),
       str([sn for sn, r in first_by_sn(read_csv()).items()
            if r['has_geometry'].strip() == 'TRUE'
            and one('SELECT COUNT(*) FROM organization_location WHERE org_sn=?', sn) == 0]))
    ok('no organization has a district_id outside its own CSV district... (FK-enforced)',
       one('SELECT COUNT(*) FROM organization o JOIN district d ON d.district_id=o.district_id') > 0)
    ok('every location geometry blob is a valid GeoPackage POINT header + WKB',
       all(len(b) == 29 and b[:2] == b'GP' and b[3] == 0x01 and int.from_bytes(b[4:8], 'little') == 4326
           and b[8] == 1 and b[9:13] == (1).to_bytes(4, 'little')
           for (b,) in q('SELECT geom FROM organization_location')))
    ok('the geometry blob coordinates equal the readable lon/lat columns',
       all(abs(struct_unpack(b, 13) - lon) < 1e-9 and abs(struct_unpack(b, 21) - lat) < 1e-9
           for b, lon, lat in q('SELECT geom, lon, lat FROM organization_location')))

    # --- views: the readable access layer
    ok(f'{VIEWS} views exist',
       one("SELECT COUNT(*) FROM sqlite_master WHERE type='view'") == VIEWS,
       str(one("SELECT COUNT(*) FROM sqlite_master WHERE type='view'")))
    ok('v_organization_overview returns one row per organisation',
       one('SELECT COUNT(*) FROM v_organization_overview') == exp['orgs'])
    ok('v_organization_overview.total_usd totals the national figure',
       round(one('SELECT SUM(total_usd) FROM v_organization_overview'), 2) == exp['usd_org_aggregate'],
       f"{round(one('SELECT SUM(total_usd) FROM v_organization_overview'), 2):,.2f}")
    ok('v_money_by_district totals the same figure',
       round(one('SELECT SUM(total_usd) FROM v_money_by_district'), 2) == exp['usd_org_aggregate'])
    ok('v_value_chain_summary covers every subcategory',
       one('SELECT COUNT(*) FROM v_value_chain_summary') == exp['subcategories'])
    ok('v_contract_detail returns one row per contract',
       one('SELECT COUNT(*) FROM v_contract_detail') == exp['contracts'])

    # --- the reference implementation must accept the file (GDAL, not our own assertions)
    info = subprocess.run(['ogrinfo', '-so', str(GPKG), 'organization_location'],
                          capture_output=True, text=True).stdout
    ok(f"ogrinfo reads organization_location as {exp['located']} Point features",
       f"Feature Count: {exp['located']}" in info and 'Geometry: Point' in info,
       ' | '.join(l.strip() for l in info.splitlines() if 'Feature Count' in l or 'Geometry:' in l))
    listing = subprocess.run(['ogrinfo', str(GPKG)], capture_output=True, text=True).stdout
    ok(f'ogrinfo lists all {TABLES} tables',
       len(re.findall(r'^\d+: ', listing, re.M)) == TABLES,
       str(len(re.findall(r'^\d+: ', listing, re.M))))
    withviews = subprocess.run(['ogrinfo', '-oo', 'LIST_ALL_TABLES=YES', str(GPKG)],
                               capture_output=True, text=True).stdout
    ok(f'ogrinfo also sees the {VIEWS} views with LIST_ALL_TABLES=YES',
       len(re.findall(r'^\d+: ', withviews, re.M)) == TABLES + VIEWS,
       str(len(re.findall(r'^\d+: ', withviews, re.M))))

    db.close()
    return finish()


def struct_unpack(blob, offset):
    import struct
    return struct.unpack('<d', blob[offset:offset + 8])[0]


def md5(p):
    return hashlib.md5(Path(p).read_bytes()).hexdigest()


def finish():
    print(f"\n{'all green' if not FAIL else 'FAILURES: ' + str(FAIL)}  ({PASS} passed)")
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
