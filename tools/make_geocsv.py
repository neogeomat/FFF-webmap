#!/usr/bin/env python3
"""
make_geocsv.py — grant-level GeoCSV combining all FFF sources.

Outputs Webmap/data/Grantees.combined.geocsv (grant-level, one row per grant_sn)
so the user can manually verify completeness across all data layers.

Sources merged (same Registry / ALIASES logic as consolidate_grantees_attributes.py):
  - Webmap/data/Grantees.geojson              (65 feat, S_N key, X/Y lon/lat)
  - Webmap/data/moreDataFromFFF/*.csv         (Enterprise Commodity + Nature of Enterprises → grants[73])
  - Webmap/data/DRAFT_FFF_FFPOs_Details.xlsx  (org_type, municipality, district, province, HH, area)
  - Webmap/data/moreDataFromFFF: Women Led + Restoration (n-per-org)
  - Webmap/data/DBG & LoA (2019-2026).xlsx  (LoA 67 rows + DBG 24 rows, finance per contract)

Join key: String(S_N) == String(org_id) via Registry (ALIASES/SYNONYMS, substring>=8, difflib 0.80 review).
Grant grain: one output row per grants[].grant_sn (73 rows).  Geometry repeated per org.
Finance rows are NOT 1:1 with grants (per-contract), so they are aggregated per org onto each grant row
as *_aggregates + JSON, preserving checkability without duplicating grants.

Run: python3 make_geocsv.py   (from project root /home/ubentu/ssd/baato/FAO/FFF)
Requires: openpyxl
"""
import os, re, csv, json, difflib
from pathlib import Path
import openpyxl
from datetime import datetime, date

# Lives at Webmap/tools/, so the served site root is one level up (this file used to sit in
# the (unversioned) project root; the move is what put the pipeline under git).
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MORE = DATA / "moreDataFromFFF"
GEOJSON = DATA / "Grantees.geojson"
DRAFT_XLSX = DATA / "DRAFT_FFF_FFPOs_Details.xlsx"
FINANCE_XLSX = DATA / "DBG & LoA (2019-2026).xlsx"

OUT_CSV  = DATA / "Grantees.combined.geocsv"
OUT_CSV2 = DATA / "Grantees.combined.csv"
OUT_UNMATCHED = DATA / "unmatched_orgs_geocsv.txt"

# ---------------------------------------------------------------------------
# Name normalization & matching (copied from consolidate_grantees_attributes.py)
# ---------------------------------------------------------------------------
def normalize(name):
    if name is None:
        return ''
    s = str(name).lower().replace('\u2019', "'").replace('\u2018', "'")
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def synonym(n):
    return SYNONYMS.get(n, n)

ALIASES = {
    'cdcan': 6,
    'central dairy cooperative association ltd nepal': 6,
    'central dairy cooperative association ltd nepal cdcan': 6,
    'kendriya dugda sahakari sangh ltd central dairy cooperative association nepal of setidevi cooperative and deurali dairy cooperative': 67,
    'nfgf': 5,
    'nfgt national farmer group federation': 5,
    # NFGF full-name spellings — all one org as S_N 5 (S_N 21 and 34 were duplicate rows)
    'national farmer group federation': 5,
    'national farmer group federation nfgf': 5,
    'nfgf national farmer group federation': 5,
    'national farmer group federation nfgf nepal': 5,
    'national farmers group federation nepal': 34,
    'national farmers group federation nepal of shivashakti krishi sahakari jyoti samajik udhyami mahila sahakari digo niji banjanya upaj tatha krishi sahakari': 71,
    'national farmers group federation nepal jyoti samajik udhyami mahila sahakari': 71,
    'association of family forest owners nepal': 3,
    'affon': 3,
    'green foundation nepal': 24,
    'green foundation nepal gfn': 24,
    'bungdal community forest user group': 11,
    'bungdhal community forest': 11,
    'bungdal cfugs': 11,
    'binayi community forest user group': 33,
    'binayi cfugs': 33,
    'binayi samudayik ban upobhokta samu': 66,
    'sakriya mahila agriculture cooperative': 38,
    'sakriye mahila sahakari limited': 38,
    'sakriya mahila krisi sahakari sanstha sa lt': 38,
    'himawanti': 40,
    'our rajakot multipurpose cooperative': 72,
    'hamro rajakot bahuuddeshye sahakari sanstha limited hrbssl': 41,
    'fecofun': 1,
    'federation of community forestry users nepal fecofun': 1,
    'federation of community forestry user nepal': 1,
    'kemalipur community forest user group': 49,
    'kemlipur cfug': 49,
    'kemlipur cfug minapa07': 49,
    'sundardeep mahila machhapalan ssl': 57,
    'sundardeep mahila macchapalan ssl': 57,
    'adhar ekta women producer group': 2,
    'adhar ekta mahila sanstha': 2,
    'aadhar ekta mahila krishak samuha': 2,
    'piple pokhara cfug': 45,
    'piplepokhara community forest': 45,
    'piple pokhara sbus': 45,
    'rajapani community forest users group': 63,
    'coffee cooperative union ltd': 58,
    'cofee sahakari sangh ltd': 58,
    'asmita nepal': 4,
    'dangdunge community forest': 15,
    'phulabari cfugs': 31,
    'belapakha cfugs': 35,
    'belapkaha community forest kavre fecofun': 35,
    'pashupati community forest': 39,
    'pasupati cfugs': 39,
    'central livestock co operative fed ltd nepal': 50,
    'ratu mahila cfug': 48,
    'shivnagar samudayik ban upabhokta samuha': 53,
    'shankarnagar samudayek van upabhokta samuha': 54,
    'chuchchekhola samudayik ban u samu': 46,
    'chuchchekhola samudayik ban u samuha': 46,
    'jaldevi samudayik ban upbhokta samuha': 47,
    'hile jaljale ka samudayik ban upabhokta samuha': 44,
    'aankur aadarsha cfug': 52,
    'aankur aadarsha samudayik ban upavo': 52,
    'gobardiha kastha tatha furniture udhyog': 62,
    'mithila jadibuti sahakari sanstha ltd': 56,
    'sana kishan krishi sahakari sastha': 55,
    'sana kishan krishi sahakari sanstha': 55,
    'shree korak sana kisan krishi sahakari sanstha ltd': 59,
    'shree chhotadanda agriculture cooperative': 61,
    'kunchhal krishi sahakari sa ltd': 60,
    'sundardeep mahila machhapalan s s l': 57,
    'shree mishreet fish farming limited': 64,
    'hanuman krishi sahakari sanstha ltd': 68,
    'hatemalo beekeeping cooperative ltd': 69,
    'jadibuti samrakshyan tatha upayog sahakari sanstha ltd': 70,
    'our rajakot multi purpose cooperative society limited': 72,
    'sakriya mahila krishi sahakari sanstha limited': 38,
    'shree shivashakti krishi sahakari limited member of nfgf': 27,
    'aadhunik krishi sahakari limited': 42,
    'national indigenous women forum': 29,
    'samudayik udhami mahila krishi krishak samuha': 51,
    'kanaya farmers group': 10,
    'kanaihya farmer group': 10,
    'jagaran women agri producer group': 8,
    'jagaran community development centre and the madhyavindu lime fruits and vegetable producers group': 8,
    'association of family forest owners nepal affon': 3,
    'association of family forest owners nepal pratapkot agroforestry cooperative': 3,
    'affon handmade paper group': 3,
    'affon setidevi women entrepreneur farmers group': 3,
    'aadhar ekata mahila krishak samuha': 2,
    'central dairy cooperative association ltd nepal cdcan kendriya dughda sahakari sangh ltd': 67,
    'green foundation nepal pakare agroforestry entrepreneur group': 24,
    'shivashakti cooperative': 27,
    'banganga women bee keeping group shuakamana': 12,
    'bungdal samudayeik ban upabhokta samuha bungdal cfug': 32,
    'aadhunik krishi sahakari limited aadhunik agriculture co operative ltd': 42,
    'shree kalika malika kissan jaluke cfug supported via green foundation nepal': 7,
    'central livestock co operative fed ltd nepal felificon': 50,
    'shiva community forest': 13,
    # --- finance-truncated aliases (DBG & LoA (2019-2026).xlsx) for grant-level verification ---
    'adhar ekata mahila santha': 2,
    'dangdunge ban upabhokta sa': 15,
    'jagaran samudayik bikash kendra': 8,
    'kanaya krishak samuha': 10,
    'shiva samudayik ban upabhokta samiti': 13,
    'suvakamana samajik bikash sastha': 12,
    'sustainable research and development center nepal': 30,
    'national indigenous women forum niwf': 29,
    'aankur aadarsha samudayik ban upabhokta samuha': 52,
    'pashupati community forest users group': 39,
    'aadhunik agriculture co operative l': 42,
    'himalayan grassroots women s natural resource management association of nepal himawanti': 40,
    'himalayan grassroots women s natural resource management association of nepal h': 40,
    'sakriya mahila krisi shakari sa lt': 38,
    'bhatighari samudayik ban upabhokta samuha': 65,
}
SYNONYMS = {'sundari cfug': 'sundari community forest'}

# Two rows in the source coordinate sheet can be the SAME organization — same CFUG,
# identical coordinates, one row per grant. Fold the duplicate onto the surviving S_N.
# 66 == 33: 'Binayi Samudayik Ban Upobhokta Samu' (DBG 2025-26) is the same CFUG as
# S_N 33 (LoA 2023-24): Binayi Triveni RM, Dumkibas, identical point geometry.
SAME_ORG = {66: 33, 34: 5, 21: 5}


def canonical_org(oid):
    """Fold duplicate geojson rows (SAME_ORG) onto the surviving org_id."""
    return SAME_ORG.get(oid, oid)


class Registry:
    def __init__(self, geojson_path):
        self.orgs = {}
        self.name_to_id = {}
        self.fuzzy_display = {}
        self.review = []
        self.new_orgs = []
        self._synth = 0
        fc = json.load(open(geojson_path, encoding='utf-8'))
        for f in fc['features']:
            p = f['properties']
            s_n = p.get('S_N')
            if s_n is None:
                continue
            oid = int(s_n)
            geom = f.get('geometry')
            self.orgs[oid] = {
                'org_id': oid,
                'name': p.get('Name_of_Organization', ''),
                'location': p.get('Location', ''),
                'type_of_grant': p.get('Type_of_Grant', ''),
                'commodities': p.get('Commodities', ''),
                'has_geometry': bool(geom),
                'coordinates': geom['coordinates'] if geom else None,
                'organization_type': None,
                'municipality': '', 'district': '', 'province': '',
                'direct_hh': None, 'total_hh': None, 'area_ha': None,
            }
            self.name_to_id[normalize(p.get('Name_of_Organization', ''))] = oid
        self._rebuild_fuzzy()
    def _rebuild_fuzzy(self):
        self.fuzzy_display = {normalize(o['name']): o['name'] for o in self.orgs.values()}
        self.fuzzy_pool = list(self.fuzzy_display.keys())
    def _new_org(self, name, section=None):
        self._synth += 1
        oid = f'A{self._synth}'
        self.orgs[oid] = {
            'org_id': oid, 'name': name, 'location': '', 'type_of_grant': '', 'commodities': '',
            'has_geometry': False, 'coordinates': None,
            'organization_type': section, 'municipality': '', 'district': '', 'province': '',
            'direct_hh': None, 'total_hh': None, 'area_ha': None,
        }
        self.name_to_id[synonym(normalize(name))] = oid
        self.new_orgs.append({'org_id': oid, 'name': name})
        return oid
    def resolve(self, name, ctx='', section=None):
        n = synonym(normalize(name))
        if not n:
            return None
        if n in ALIASES:
            return canonical_org(ALIASES[n])
        if n in self.name_to_id:
            return canonical_org(self.name_to_id[n])
        best_oid, best_len = None, -1
        for cn, oid in self.name_to_id.items():
            shorter = cn if len(cn) <= len(n) else n
            longer = n if len(cn) <= len(n) else cn
            if len(shorter) >= 8 and shorter in longer:
                if len(shorter) > best_len:
                    best_oid, best_len = oid, len(shorter)
        if best_oid is not None:
            return canonical_org(best_oid)
        best = difflib.get_close_matches(n, self.fuzzy_pool, n=1, cutoff=0.80)
        suggestion = None
        if best:
            cand = best[0]
            suggestion = {'name': self.fuzzy_display.get(cand, cand), 'org_id': self.name_to_id[cand], 'ratio': round(difflib.SequenceMatcher(None, n, cand).ratio(), 3)}
        self.review.append({'context': ctx, 'source_name': name, 'suggestion': suggestion})
        return self._new_org(name, section)
    def register_or_get(self, name, section=None):
        n = synonym(normalize(name))
        if not n:
            return None
        if n in ALIASES:
            return canonical_org(ALIASES[n])
        if n in self.name_to_id:
            return canonical_org(self.name_to_id[n])
        best_oid, best_len = None, -1
        for cn, oid in self.name_to_id.items():
            shorter = cn if len(cn) <= len(n) else n
            longer = n if len(cn) <= len(n) else cn
            if len(shorter) >= 8 and shorter in longer:
                if len(shorter) > best_len:
                    best_oid, best_len = oid, len(shorter)
        if best_oid is not None:
            return canonical_org(best_oid)
        return self._new_org(name, section)

def _colmap_from_header(rows):
    for i, r in enumerate(rows):
        if any(str(c).strip().upper().startswith('S.N') for c in r):
            hdr = [str(c).strip() for c in r]
            return i, {h: idx for idx, h in enumerate(hdr) if h}
    return None, {}

def parse_grants(reg):
    def load(name):
        with open(MORE / name, encoding='utf-8-sig', errors='replace') as fh:
            return list(csv.reader(fh))
    comm_rows = load('Map Categories_Final.xlsx - Enterprise Commodity Map.csv')
    nat_rows  = load('Map Categories_Final.xlsx - Nature of Enterprises Map.csv')
    def rows_as_dict(rows):
        hdr_idx, colmap = _colmap_from_header(rows)
        if hdr_idx is None:
            return {}, {}
        sn_col = colmap.get('S.N', colmap.get('S.N.'))
        out = {}
        for r in rows[hdr_idx + 1:]:
            if not r or not any(c.strip() for c in r):
                continue
            sn = r[sn_col].strip() if sn_col is not None and sn_col < len(r) else ''
            if not sn.isdigit():
                continue
            out[sn] = (r, colmap)
        return out
    comm = rows_as_dict(comm_rows)
    nat  = rows_as_dict(nat_rows)
    def col(r, colmap, name):
        i = colmap.get(name)
        return r[i].strip() if i is not None and i < len(r) else ''
    grants = []
    for sn in sorted(comm.keys(), key=int):
        r, ccol = comm[sn]
        nr, ncol = nat.get(sn, ([], {}))
        grantee = col(r, ccol, 'Grantee')
        oid = reg.resolve(grantee, ctx=f'grants S.N.{sn}')
        grants.append({
            'grant_sn': int(sn),
            'org_id': oid,
            'grantee_name_raw': grantee,
            'implementation_period': col(r, ccol, 'Implementation Period'),
            'grant_title': col(r, ccol, 'Grant Title'),
            'enterprise_commodity': col(r, ccol, 'Enterprise / Commodity'),
            'main_category': col(r, ccol, 'Main Category'),
            'subcategory': col(r, ccol, 'Subcategory'),
            'enterprise_classification': col(nr, ncol, 'Enterprise Classification'),
        })
    return grants

def parse_draft_orgs(reg):
    wb = openpyxl.load_workbook(str(DRAFT_XLSX), data_only=True)
    ws = wb['Sheet 1']
    section = None
    def num(x):
        if x is None or str(x).strip() == '':
            return None
        try:
            return float(str(x).replace(',', ''))
        except ValueError:
            return None
    for row in ws.iter_rows(values_only=True):
        vals = [('' if v is None else str(v).strip()) for v in row]
        if not any(vals):
            continue
        joined = ' '.join(vals).strip()
        if joined.upper() == 'COOPERATIVES':
            section = 'cooperative'; continue
        if joined.upper() == 'FARMERS GROUPS':
            section = 'farmers_group'; continue
        if joined.upper().startswith('FOREST SECTOR'):
            section = 'forest_sector'; continue
        if vals[0].upper().startswith('S.N'):
            continue
        if not vals[0].replace('.', '').isdigit():
            continue
        name = vals[1]; municipality = vals[2]; full_location = vals[3]
        district = province = ''
        m = re.search(r'([A-Za-z ]+?) District', full_location)
        if m: district = m.group(1).strip()
        m = re.search(r'([A-Za-z ]+?) Province', full_location)
        if m: province = m.group(1).strip()
        oid = reg.register_or_get(name, section)
        if oid is None: continue
        o = reg.orgs[oid]
        if section and not o['organization_type']:
            o['organization_type'] = section
        o['municipality'] = o['municipality'] or municipality
        o['district'] = o['district'] or district
        o['province'] = o['province'] or province
        if o['direct_hh'] is None: o['direct_hh'] = num(vals[4])
        if o['total_hh'] is None:  o['total_hh']  = num(vals[5])
        if o['area_ha'] is None:   o['area_ha']   = num(vals[6])
    return reg

def parse_women(reg):
    with open(MORE / 'Map Categories_Final.xlsx - Women Led Enterprise Map.csv', encoding='utf-8-sig', errors='replace') as fh:
        rows = list(csv.reader(fh))
    hdr_idx, colmap = _colmap_from_header(rows)
    if hdr_idx is None: return []
    sn_col = colmap.get('S.N', colmap.get('S.N.'))
    name_col = colmap.get('Name of Producer Group')
    women_col = colmap.get('Producer Number (women)')
    prod_col = colmap.get('Product')
    year = None; out=[]
    for r in rows[hdr_idx+1:]:
        if not any(c.strip() for c in r): continue
        joined=' '.join(c.strip() for c in r).strip()
        if re.fullmatch(r'\d{4}([-–]\d{4})?', joined):
            year=joined; continue
        sn = r[sn_col].strip() if sn_col is not None and sn_col<len(r) else ''
        if not sn.isdigit(): continue
        name = r[name_col].strip() if name_col is not None and name_col<len(r) else ''
        women = r[women_col].strip() if women_col is not None and women_col<len(r) else ''
        product = r[prod_col].strip() if prod_col is not None and prod_col<len(r) else ''
        if women.lower() in ('total',): continue
        oid = reg.resolve(name, ctx=f'women {year}')
        out.append({'org_id':oid,'producer_group':name,'year_block':year,'women_count':int(women) if women.isdigit() else None,'product':product})
    return out

def parse_restoration(reg):
    with open(MORE / 'Map Categories_Final.xlsx - Restoration_Landscape Impact Ma.csv', encoding='utf-8-sig', errors='replace') as fh:
        rows = list(csv.reader(fh))
    def detect_cols(r):
        hdr=[str(c).strip() for c in r]
        cols={'sn':None,'name':None,'direct':None,'contributed':None,'people':None}
        for idx,h in enumerate(hdr):
            u=h.upper()
            if not h: continue
            if u.startswith('S.N'): cols['sn']=idx
            elif 'DIRECT' in u and cols['direct'] is None: cols['direct']=idx
            elif 'CONTRIBUTED' in u and cols['contributed'] is None: cols['contributed']=idx
            elif 'PEOPLE' in u and cols['people'] is None: cols['people']=idx
            elif cols['name'] is None: cols['name']=idx
        return cols
    def num(x):
        x=str(x).replace(',','').strip()
        if x=='': return None
        try: return float(x)
        except ValueError: return None
    out=[]; year=None; cols=None
    for r in rows:
        if not any(c.strip() for c in r): continue
        joined=' '.join(c.strip() for c in r).strip()
        if re.fullmatch(r'\d{4}( and \d{4})?', joined) or re.fullmatch(r'\d{4}', joined):
            year=joined; continue
        if any(str(c).strip().upper().startswith('S.N') for c in r):
            cols=detect_cols(r); continue
        if cols is None: continue
        sn=r[cols['sn']].strip() if cols['sn'] is not None and cols['sn']<len(r) else ''
        if not sn.isdigit(): continue
        name=r[cols['name']].strip() if cols['name'] is not None and cols['name']<len(r) else ''
        direct=r[cols['direct']].strip() if cols['direct'] is not None and cols['direct']<len(r) else ''
        contributed=r[cols['contributed']].strip() if cols['contributed'] is not None and cols['contributed']<len(r) else ''
        people=r[cols['people']].strip() if cols['people'] is not None and cols['people']<len(r) else ''
        oid=reg.resolve(name, ctx=f'restoration {year}')
        out.append({'org_id':oid,'org_name':name,'year_block':year,'area_direct_ha':num(direct),'area_contributed_ha':num(contributed),'people_benefited':num(people)})
    return out

def parse_finance(reg):
    wb = openpyxl.load_workbook(str(FINANCE_XLSX), data_only=True)
    # LoA sheet: header is row 1 (A empty, B=Organization Name), first data row 2
    ws_loa = wb['LoA (2019-26)']
    rows_loa = list(ws_loa.iter_rows(values_only=True))
    hdr_loa = [str(c).strip() if c else '' for c in rows_loa[0]]
    # index by name
    def idx_map(hdr): return {h:i for i,h in enumerate(hdr) if h}
    lm = idx_map(hdr_loa)
    loa=[]; 
    for r in rows_loa[1:]:
        org = r[lm['Organization Name']] if lm.get('Organization Name') is not None and lm['Organization Name']<len(r) else None
        if org is None or not str(org).strip():
            continue
        # skip total-like rows? LoA has no total row, but check if org is empty
        s = r[lm['Service Start Date']] if lm.get('Service Start Date') is not None else None
        e = r[lm['Service End Date']] if lm.get('Service End Date') is not None else None
        cur = r[lm['CUR']] if lm.get('CUR') is not None else None
        npr = r[lm['CUR Net Value']] if lm.get('CUR Net Value') is not None else None
        usd = r[lm['USD Net Value']] if lm.get('USD Net Value') is not None else None
        def to_iso(d):
            if d is None or str(d).strip()=='':
                return ''
            if isinstance(d, (datetime, date)):
                return d.strftime('%Y-%m-%d')
            s=str(d).strip()
            # try parse
            for fmt in ('%Y-%m-%d %H:%M:%S','%Y-%m-%d','%d.%m.%Y'):
                try: return datetime.strptime(s.split()[0], '%Y-%m-%d').strftime('%Y-%m-%d')
                except: pass
            return s
        def to_float(v):
            if v is None or str(v).strip()=='':
                return None
            try: return float(str(v).replace(',',''))
            except: return None
        org_s=str(org).strip()
        oid=reg.resolve(org_s, ctx='finance LoA')
        loa.append({
            'org_id':oid,'org_name_raw':org_s,
            'sheet':'LoA','site_code':'',
            'service_start':to_iso(s),'service_end':to_iso(e),
            'cur':str(cur).strip() if cur else '',
            'cur_value':to_float(npr),'usd_value':to_float(usd)
        })
    # DBG sheet: header at row 2 (index 1), data from row 3 (index 2)
    ws_dbg = wb['DBG (2023-26)']
    rows_dbg = list(ws_dbg.iter_rows(values_only=True))
    hdr_dbg = [str(c).strip() if c else '' for c in rows_dbg[1]]
    dm = idx_map(hdr_dbg)
    dbg=[]
    for r in rows_dbg[2:]:
        org = r[dm['Organization Name']] if dm.get('Organization Name') is not None and dm['Organization Name']<len(r) else None
        if org is None or not str(org).strip():
            # this is the totals row (col H has 115131693, org empty) — skip
            continue
        s = r[dm['Service Start Date']] if dm.get('Service Start Date') is not None else None
        e = r[dm['Service End Date']] if dm.get('Service End Date') is not None else None
        cur = r[dm['CUR']] if dm.get('CUR') is not None else None
        npr = r[dm['CUR Net Ordered Value']] if dm.get('CUR Net Ordered Value') is not None else None
        usd = r[dm['USD Net Ordered Value']] if dm.get('USD Net Ordered Value') is not None else None
        site = r[dm['Site Code']] if dm.get('Site Code') is not None else ''
        def to_iso(d):
            if d is None or str(d).strip()=='':
                return ''
            if isinstance(d, (datetime, date)):
                return d.strftime('%Y-%m-%d')
            return str(d).strip()
        def to_float(v):
            if v is None or str(v).strip()=='':
                return None
            try: return float(str(v).replace(',',''))
            except: return None
        org_s=str(org).strip()
        oid=reg.resolve(org_s, ctx='finance DBG')
        dbg.append({
            'org_id':oid,'org_name_raw':org_s,
            'sheet':'DBG','site_code':str(site).strip() if site else '',
            'service_start':to_iso(s),'service_end':to_iso(e),
            'cur':str(cur).strip() if cur else '',
            'cur_value':to_float(npr),'usd_value':to_float(usd)
        })
    return loa, dbg

def main():
    print(f"ROOT={ROOT} DATA={DATA}")
    reg = Registry(str(GEOJSON))
    grants = parse_grants(reg)
    parse_draft_orgs(reg)
    women = parse_women(reg)
    restoration = parse_restoration(reg)
    loa, dbg = parse_finance(reg)

    # group finance/women/restoration by org_id for aggregates
    from collections import defaultdict
    finance_by_org = defaultdict(list)
    for rec in loa+dbg:
        finance_by_org[str(rec['org_id'])].append(rec)
    women_by_org = defaultdict(list)
    for w in women:
        women_by_org[str(w['org_id'])].append(w)
    restoration_by_org = defaultdict(list)
    for r in restoration:
        restoration_by_org[str(r['org_id'])].append(r)

    # Build grant-level rows (73)
    rows=[]
    for g in sorted(grants, key=lambda x: x['grant_sn']):
        oid=str(g['org_id'])
        org=reg.orgs.get(g['org_id']) or reg.orgs.get(int(g['org_id'])) if isinstance(g['org_id'], int) else reg.orgs.get(g['org_id'])
        # org may be synthetic A* string key
        if org is None:
            # shouldn't happen
            org={'org_id':g['org_id'],'name':g['grantee_name_raw'],'location':'','type_of_grant':'','commodities':'','has_geometry':False,'coordinates':None,'organization_type':'','municipality':'','district':'','province':'','direct_hh':None,'total_hh':None,'area_ha':None}
        geom=org.get('coordinates')
        has_geom=bool(geom)
        lon = geom[0] if geom and len(geom)>=2 else ''
        lat = geom[1] if geom and len(geom)>=2 else ''
        wkt = f"POINT ({lon} {lat})" if has_geom else ''
        # aggregates for this org
        f_recs=finance_by_org.get(oid, [])
        loa_recs=[r for r in f_recs if r['sheet']=='LoA']
        dbg_recs=[r for r in f_recs if r['sheet']=='DBG']
        def sum_usd(recs): return sum(r['usd_value'] or 0 for r in recs)
        def sum_npr(recs): return sum(r['cur_value'] or 0 for r in recs if (r['cur'] or '').upper()=='NPR') + sum(r['cur_value'] or 0 for r in recs if (r['cur'] or '').upper()=='USD')  # USD already NPR? keep separate
        # better keep NPR and USD separate: total_NPR sum where cur==NPR, total_USD sum all usd_value
        total_npr = sum(r['cur_value'] or 0 for r in f_recs if (r['cur'] or '').upper()=='NPR')
        # also include USD contracts in NPR? no
        total_usd = sum(r['usd_value'] or 0 for r in f_recs)
        loa_npr = sum(r['cur_value'] or 0 for r in loa_recs if (r['cur'] or '').upper()=='NPR')
        loa_usd = sum(r['usd_value'] or 0 for r in loa_recs)
        dbg_npr = sum(r['cur_value'] or 0 for r in dbg_recs)
        dbg_usd = sum(r['usd_value'] or 0 for r in dbg_recs)
        # women/restoration sums per org
        w_recs=women_by_org.get(oid, [])
        w_count=sum(w['women_count'] or 0 for w in w_recs)
        r_recs=restoration_by_org.get(oid, [])
        r_direct=sum(r['area_direct_ha'] or 0 for r in r_recs)
        r_contrib=sum(r['area_contributed_ha'] or 0 for r in r_recs)
        r_people=sum(r['people_benefited'] or 0 for r in r_recs)
        rows.append({
            'grant_sn': g['grant_sn'],
            'S_N': org['org_id'],
            'org_name_geojson': org['name'],
            'grantee_name_grantCSV': g['grantee_name_raw'],
            'has_geometry': has_geom,
            'X': lon,
            'Y': lat,
            'WKT': wkt,
            'Location_geojson': org['location'],
            'Type_of_Grant_geojson': org['type_of_grant'],
            'Commodities_geojson': org['commodities'],
            'organization_type': org.get('organization_type') or '',
            'municipality': org.get('municipality') or '',
            'district': org.get('district') or '',
            'province': org.get('province') or '',
            'direct_hh': org.get('direct_hh'),
            'total_hh': org.get('total_hh'),
            'area_ha_org': org.get('area_ha'),
            'grant_title': g['grant_title'],
            'implementation_period': g['implementation_period'],
            'enterprise_commodity': g['enterprise_commodity'],
            'main_category': g['main_category'],
            'subcategory': g['subcategory'],
            'enterprise_classification': g['enterprise_classification'],
            # org-level aggregates repeated per grant so the web map needs no second file
            'women_records_org': len(w_recs),
            'women_count_org': w_count,
            'women_json': json.dumps(w_recs, ensure_ascii=False) if w_recs else '',
            'restoration_records_org': len(r_recs),
            'area_direct_total_org': r_direct if r_recs else '',
            'area_contributed_total_org': r_contrib if r_recs else '',
            'people_benefited_total_org': r_people if r_recs else '',
            'restoration_json': json.dumps(r_recs, ensure_ascii=False) if r_recs else '',
            'loa_contracts_org': len(loa_recs),
            'loa_total_NPR_org': loa_npr if loa_recs else '',
            'loa_total_USD_org': loa_usd if loa_recs else '',
            'dbg_contracts_org': len(dbg_recs),
            'dbg_total_NPR_org': dbg_npr if dbg_recs else '',
            'dbg_total_USD_org': dbg_usd if dbg_recs else '',
            'finance_contracts_org': len(f_recs),
            'finance_total_NPR_org': total_npr if f_recs else '',
            'finance_total_USD_org': total_usd if f_recs else '',
            'finance_sites_org': '; '.join(sorted(set(r['site_code'] for r in f_recs if r['site_code']))),
            # per-contract rows (service_start/end + usd_value) so the evolution chart can use real dates
            'finance_json': json.dumps(f_recs, ensure_ascii=False) if f_recs else '',
        })

    # --- Add 6 member orgs with HH but no grant (so they appear in same spreadsheet) ---
    # These are synthetic A* orgs created from DRAFT_FFF_FFPOs_Details that never got a grant row.
    # Filter: synthetic A* with household/area data and no grant_sn yet. That's the 6:
    # A1 Setidevi, A2 Deurali, A3 Milan, A4 Sirjanshil, A5 Chabeli, A6 Gangamala.
    grant_org_ids = set(str(g['org_id']) for g in grants)
    for oid, org in sorted(reg.orgs.items(), key=lambda kv: str(kv[0])):
        if not isinstance(oid, str) or not oid.startswith('A'):
            continue
        if str(oid) in grant_org_ids:
            continue
        has_hh = org.get('direct_hh') is not None or org.get('total_hh') is not None or org.get('area_ha') is not None
        if not has_hh:
            continue
        oid_s = str(oid)
        geom = org.get('coordinates')
        has_geom = bool(geom)
        lon = geom[0] if geom and len(geom) >= 2 else ''
        lat = geom[1] if geom and len(geom) >= 2 else ''
        wkt = f"POINT ({lon} {lat})" if has_geom else ''
        f_recs = finance_by_org.get(oid_s, [])
        loa_recs = [r for r in f_recs if r['sheet'] == 'LoA']
        dbg_recs = [r for r in f_recs if r['sheet'] == 'DBG']
        total_npr = sum(r['cur_value'] or 0 for r in f_recs if (r['cur'] or '').upper() == 'NPR')
        total_usd = sum(r['usd_value'] or 0 for r in f_recs)
        loa_npr = sum(r['cur_value'] or 0 for r in loa_recs if (r['cur'] or '').upper() == 'NPR')
        loa_usd = sum(r['usd_value'] or 0 for r in loa_recs)
        dbg_npr = sum(r['cur_value'] or 0 for r in dbg_recs)
        dbg_usd = sum(r['usd_value'] or 0 for r in dbg_recs)
        w_recs = women_by_org.get(oid_s, [])
        w_count = sum(w['women_count'] or 0 for w in w_recs)
        r_recs = restoration_by_org.get(oid_s, [])
        r_direct = sum(r['area_direct_ha'] or 0 for r in r_recs)
        r_contrib = sum(r['area_contributed_ha'] or 0 for r in r_recs)
        r_people = sum(r['people_benefited'] or 0 for r in r_recs)
        rows.append({
            'grant_sn': '',
            'S_N': org['org_id'],
            'org_name_geojson': org['name'],
            'grantee_name_grantCSV': '',
            'has_geometry': has_geom,
            'X': lon,
            'Y': lat,
            'WKT': wkt,
            'Location_geojson': org['location'],
            'Type_of_Grant_geojson': org['type_of_grant'],
            'Commodities_geojson': org['commodities'],
            'organization_type': org.get('organization_type') or '',
            'municipality': org.get('municipality') or '',
            'district': org.get('district') or '',
            'province': org.get('province') or '',
            'direct_hh': org.get('direct_hh'),
            'total_hh': org.get('total_hh'),
            'area_ha_org': org.get('area_ha'),
            'grant_title': '',
            'implementation_period': '',
            'enterprise_commodity': '',
            'main_category': '',
            'subcategory': '',
            'enterprise_classification': '',
            'women_records_org': len(w_recs),
            'women_count_org': w_count if w_recs else '',
            'women_json': json.dumps(w_recs, ensure_ascii=False) if w_recs else '',
            'restoration_records_org': len(r_recs),
            'area_direct_total_org': r_direct if r_recs else '',
            'area_contributed_total_org': r_contrib if r_recs else '',
            'people_benefited_total_org': r_people if r_recs else '',
            'restoration_json': json.dumps(r_recs, ensure_ascii=False) if r_recs else '',
            'loa_contracts_org': len(loa_recs),
            'loa_total_NPR_org': loa_npr if loa_recs else '',
            'loa_total_USD_org': loa_usd if loa_recs else '',
            'dbg_contracts_org': len(dbg_recs),
            'dbg_total_NPR_org': dbg_npr if dbg_recs else '',
            'dbg_total_USD_org': dbg_usd if dbg_recs else '',
            'finance_contracts_org': len(f_recs),
            'finance_total_NPR_org': total_npr if f_recs else '',
            'finance_total_USD_org': total_usd if f_recs else '',
            'finance_sites_org': '; '.join(sorted(set(r['site_code'] for r in f_recs if r['site_code']))),
            # per-contract rows (service_start/end + usd_value) so the evolution chart can use real dates
            'finance_json': json.dumps(f_recs, ensure_ascii=False) if f_recs else '',
        })

    # Define header order (grant grain, geometry first for CSV → QGIS autodetect)
    # Lean for spreadsheet: no JSON blobs — only counts/totals for quick scanning.
    # Full JSON available in grantees_attributes.json / finance sheets if needed.
    header = ['grant_sn','S_N','org_name_geojson','grantee_name_grantCSV','has_geometry','X','Y','WKT',
              'Location_geojson','Type_of_Grant_geojson','Commodities_geojson',
              'organization_type','municipality','district','province','direct_hh','total_hh','area_ha_org',
              'grant_title','implementation_period','enterprise_commodity','main_category','subcategory','enterprise_classification',
              'women_records_org','women_count_org','women_json',
              'restoration_records_org','area_direct_total_org','area_contributed_total_org','people_benefited_total_org','restoration_json',
              'loa_contracts_org','loa_total_NPR_org','loa_total_USD_org',
              'dbg_contracts_org','dbg_total_NPR_org','dbg_total_USD_org',
              'finance_contracts_org','finance_total_NPR_org','finance_total_USD_org','finance_sites_org','finance_json']

    # Write GeoCSV
    with open(OUT_CSV, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=header, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for r in rows:
            w.writerow({k: ('' if r[k] is None else r[k]) for k in header})

    # .csv copy so GDAL/QGIS can open it (the .geocsv extension is not recognised)
    import shutil
    shutil.copy(OUT_CSV, OUT_CSV2)

    # unmatched report
    with open(OUT_UNMATCHED, 'w', encoding='utf-8') as f:
        f.write('GeoCSV build — org-name matching review\n')
        f.write('='*70+'\n\n')
        f.write('FUZZY MATCHES — confirm or add to ALIASES in make_geocsv.py / consolidate...\n')
        f.write('-'*70+'\n\n')
        for u in reg.review:
            if u['suggestion']:
                s=u['suggestion']
                f.write(f"[{u['context']}] {u['source_name']}\n  -> {s['name']}  (org_id {s['org_id']}, ratio {s['ratio']})\n\n")
            else:
                f.write(f"[{u['context']}] {u['source_name']}\n  -> NO SUGGESTION\n\n")
        f.write('\n\nAUTO-CREATED NEW ORGS (no geometry)\n'+'-'*70+'\n\n')
        for n in reg.new_orgs:
            f.write(f"{n['org_id']}: {n['name']}\n")
        f.write(f"\n\nFinance: LoA {len(loa)} rows, DBG {len(dbg)} rows\n")
        f.write(f"Grants: {len(grants)} rows (grant-level output)\n")

    print(f"Wrote {OUT_CSV} ({len(rows)} grant rows)")
    print(f"Wrote {OUT_CSV2}")
    print(f"Wrote {OUT_UNMATCHED}")
    stats={'grant_rows':len(rows),'has_geometry':sum(1 for r in rows if r['has_geometry']),'with_finance':sum(1 for r in rows if r['finance_contracts_org']),'with_women':sum(1 for r in rows if r['women_records_org']),'with_restoration':sum(1 for r in rows if r['restoration_records_org']),'new_orgs':len(reg.new_orgs),'fuzzy_review':len(reg.review)}
    print(json.dumps(stats, indent=2))

if __name__ == '__main__':
    main()
