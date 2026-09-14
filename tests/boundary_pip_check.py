"""Guards the boundary-simplification risk: every grantee pin must resolve to the SAME district
before and after simplifying data/District.geojson (mirrors the page's pointInRings ray casting).

    python3 tests/boundary_pip_check.py data/District.geojson          # baseline (exit 0)
    python3 tests/boundary_pip_check.py /tmp/District.min.geojson      # candidate (exit 1 on a mismatch)

Run it before/after any boundary rebuild: simplifying polygons moves the borders, and a pin inside
that moved band silently relabels to the neighbouring district.
"""
import csv, json, sys
from pathlib import Path

WEBMAP = Path(__file__).resolve().parent.parent


def rings(geom):
    if not geom: return []
    if geom['type'] == 'Polygon': return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon': return geom['coordinates']
    return []


def in_ring(pts, x, y):
    inside, n = False, len(pts)
    for i in range(n):
        x1, y1 = pts[i][0], pts[i][1]
        x2, y2 = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: inside = not inside
    return inside


def resolves(geom, x, y):
    for poly in rings(geom):
        if poly and in_ring(poly[0], x, y): return True
    return False


def districts(path):
    feats = json.load(open(path, encoding='utf-8'))['features']
    return [(f['geometry'], (f.get('properties') or {}).get('DISTRICT')) for f in feats]


def pins():
    out = {}
    with open(WEBMAP / 'data' / 'Grantees.combined.geocsv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            w = (r.get('WKT') or '').strip()
            if w.startswith('POINT'):
                xy = w[w.find('(') + 1:w.find(')')].replace(',', ' ').split()
                out[r['S_N']] = (float(xy[0]), float(xy[1]), r['org_name_geojson'])
    return out


def resolve(ds, x, y):
    for geom, name in ds:
        if resolves(geom, x, y): return name
    return None


def main(candidate):
    before = districts(WEBMAP / 'data' / 'District.geojson')
    after = districts(candidate)
    pts = pins()
    rows = [(sn, nm, resolve(before, x, y), resolve(after, x, y)) for sn, (x, y, nm) in sorted(pts.items(), key=lambda kv: int(kv[0]))]
    bad = [r for r in rows if r[2] != r[3]]
    unresolved = [r for r in rows if r[3] is None]
    print(f'pins {len(rows)}  districts {len(before)} -> {len(after)}  mismatches {len(bad)}  unresolved {len(unresolved)}')
    for sn, nm, b, a in bad: print(f'  S_N {sn} {nm[:44]:46s} {b} -> {a}')
    if not bad and not unresolved:
        print('OK — every pin still resolves to the same district')
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else str(WEBMAP / 'data' / 'District.geojson')))
