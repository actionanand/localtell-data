#!/usr/bin/env python3
"""Release-quality validator for one isolated Sri Lanka province DB."""
import argparse, sqlite3, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_geographic_pack import interior_point
from country_tools import SCHEMA_VERSION
TYPES={"neighbourhood","suburb","locality","hamlet","village","town","city","administrative_boundary"}
TABLES={"pack_meta","place","place_geometry","place_geometry_rtree"}
PLACE={"id","name","place_type","admin_level","sub_district","district","state","state_code","latitude","longitude"}
GEOMETRY={"id","place_id","geometry"}
def contains(ring,lat,lon):
    inside=False
    for (a,b),(c,d) in zip(ring,ring[1:]):
        if (a>lat)!=(c>lat) and lon < (d-b)*(lat-a)/(c-a)+b: inside=not inside
    return inside
def parse(geometry):
    try: ring=[tuple(map(float,p.split(","))) for p in geometry.split(";")]
    except (TypeError,ValueError): raise ValueError("malformed geometry")
    if len(ring)<4 or ring[0]!=ring[-1] or len(set(ring[:-1]))<3: raise ValueError("open or invalid geometry ring")
    if any(not(-90<=a<=90 and -180<=b<=180) for a,b in ring): raise ValueError("geometry coordinate outside range")
    return ring
def main():
    p=argparse.ArgumentParser(); p.add_argument("database"); p.add_argument("--id",required=True); p.add_argument("--name",required=True); p.add_argument("--version",required=True); p.add_argument("--boundary",required=True); p.add_argument("--boundary-level",default="4"); p.add_argument("--country-code",required=True); p.add_argument("--country-name",required=True); p.add_argument("--pack-type",required=True); p.add_argument("--district-code",action="append",default=[]); p.add_argument("--subdistrict-level",required=True); a=p.parse_args()
    db=sqlite3.connect(a.database); db.row_factory=sqlite3.Row
    if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok": raise SystemExit("integrity_check failed")
    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','virtual table')")}
    if not TABLES<=tables: raise SystemExit("missing required tables")
    if not PLACE<={r[1] for r in db.execute("PRAGMA table_info(place)")}: raise SystemExit("place schema mismatch")
    if not GEOMETRY<={r[1] for r in db.execute("PRAGMA table_info(place_geometry)")}: raise SystemExit("place_geometry schema mismatch")
    meta=dict(db.execute("SELECT key,value FROM pack_meta")); expected={"schema_version":str(SCHEMA_VERSION),"pack_id":a.id,"pack_name":a.name,"pack_version":str(a.version),"country_code":a.country_code,"country_name":a.country_name,"pack_type":a.pack_type,"boundary_code":a.boundary,"boundary_admin_level":a.boundary_level}
    if any(meta.get(k)!=v for k,v in expected.items()): raise SystemExit("country pack metadata mismatch")
    if meta.get("district_codes") != ",".join(sorted(a.district_code)): raise SystemExit("district configuration metadata mismatch")
    if meta.get("subdistrict_admin_level") != a.subdistrict_level: raise SystemExit("subdistrict policy metadata mismatch")
    if not db.execute("SELECT 1 FROM place").fetchone() or not db.execute("SELECT 1 FROM place_geometry").fetchone(): raise SystemExit("empty country pack")
    if db.execute("SELECT 1 FROM place WHERE place_type NOT IN (%s)" % ",".join("?"*len(TYPES)),tuple(TYPES)).fetchone(): raise SystemExit("unsupported place_type")
    if db.execute("SELECT 1 FROM place WHERE latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180").fetchone(): raise SystemExit("invalid place coordinate")
    prefix=a.country_code + "-%"
    foreign=db.execute("SELECT state_code FROM place WHERE admin_level=? AND place_type='administrative_boundary' AND state_code LIKE ? AND state_code<>?",(a.boundary_level,prefix,a.boundary)).fetchone()
    if foreign: raise SystemExit("foreign province extent present")
    if db.execute("SELECT 1 FROM place WHERE state_code LIKE ? AND state_code<>?",(prefix,a.boundary)).fetchone(): raise SystemExit("foreign country subdivision state_code present")
    districts=db.execute("SELECT id,name FROM place WHERE place_type='administrative_boundary' AND admin_level='5'").fetchall()
    if len(districts)!=len(a.district_code) or len({row['name'] for row in districts})!=len(districts) or any(not row['name'] for row in districts): raise SystemExit("stored districts do not match configured district count")
    if any(not db.execute("SELECT 1 FROM place_geometry WHERE place_id=?",(row['id'],)).fetchone() for row in districts): raise SystemExit("stored district lacks geometry")
    district_names={row['name'] for row in districts}
    if db.execute("SELECT 1 FROM place WHERE district IS NOT NULL AND district NOT IN (%s)" % ",".join("?"*len(district_names)),tuple(district_names)).fetchone(): raise SystemExit("row has unapproved district name")
    if a.subdistrict_level == "" and db.execute("SELECT 1 FROM place WHERE sub_district IS NOT NULL").fetchone(): raise SystemExit("subdistrict must be null when unavailable")
    extent_places=db.execute("SELECT id,state,state_code FROM place WHERE place_type='administrative_boundary' AND admin_level=? AND state_code=?",(a.boundary_level,a.boundary)).fetchall()
    if len(extent_places)!=1: raise SystemExit("requested province must have exactly one logical level-4 extent")
    if extent_places[0][1] != a.name or extent_places[0][2] != a.boundary: raise SystemExit("province extent hierarchy is inconsistent")
    extents=db.execute("SELECT g.geometry FROM place p JOIN place_geometry g ON g.place_id=p.id WHERE p.place_type='administrative_boundary' AND p.admin_level=? AND p.state_code=?",(a.boundary_level,a.boundary)).fetchall()
    if not extents: raise SystemExit("missing requested province extent geometry")
    for row in db.execute("SELECT geometry FROM place_geometry"):
        ring=parse(row[0])
    ring=parse(extents[0][0]); point=interior_point(ring)
    if not point or not contains(ring,*point): raise SystemExit("province extent has no usable interior test point")
    db.close(); print(f"VALID {a.id}")
if __name__=="__main__": main()
