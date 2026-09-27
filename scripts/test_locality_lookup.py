#!/usr/bin/env python3
"""Mimic Android schema-v3 lookup: RTree, deterministic polygon priority, nearest settlement."""
import argparse
import math
import sqlite3

SETTLEMENT_TYPES = ("neighbourhood", "suburb", "locality", "hamlet", "village", "town", "city")
PRIORITY_SQL = """CASE p.place_type
 WHEN 'neighbourhood' THEN 1 WHEN 'suburb' THEN 2 WHEN 'locality' THEN 3
 WHEN 'hamlet' THEN 4 WHEN 'village' THEN 5 WHEN 'town' THEN 6
 WHEN 'city' THEN 7 ELSE 99 END"""

def parse_ring(value):
    return [tuple(map(float, pair.split(","))) for pair in value.split(";")]

def contains(ring, lat, lon):
    inside = False
    for (lat1, lon1), (lat2, lon2) in zip(ring, ring[1:]):
        if (lat1 > lat) != (lat2 > lat):
            crossing = (lon2-lon1)*(lat-lat1)/(lat2-lat1)+lon1
            if lon < crossing: inside = not inside
    return inside

def distance_meters(lat1, lon1, lat2, lon2):
    radius = 6371000.0; phi1, phi2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((phi2-phi1)/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lon2-lon1)/2)**2
    return 2 * radius * math.asin(math.sqrt(a))

def display(row, method, distance=None):
    for index, key in enumerate(("name", "place_type", "sub_district", "district", "state", "state_code")):
        print(f"{key}: {row[index]}")
    print(f"resolution_method: {method}")
    if distance is not None: print(f"distance_metres: {distance:.0f}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database"); parser.add_argument("--lat", type=float, required=True); parser.add_argument("--lon", type=float, required=True)
    args = parser.parse_args()
    if not (-90 <= args.lat <= 90 and -180 <= args.lon <= 180): parser.error("coordinates are outside latitude/longitude bounds")
    db = sqlite3.connect(args.database); db.create_function("haversine", 4, distance_meters); cursor = db.cursor()
    state_rings = cursor.execute("""SELECT g.geometry FROM place_geometry_rtree r
JOIN place_geometry g ON g.id=r.id JOIN place p ON p.id=g.place_id
WHERE r.min_lat<=? AND r.max_lat>=? AND r.min_lng<=? AND r.max_lng>=?
  AND p.place_type='administrative_boundary' AND p.admin_level='4'
ORDER BY r.id""", (args.lat,args.lat,args.lon,args.lon)).fetchall()
    if not any(contains(parse_ring(row[0]), args.lat, args.lon) for row in state_rings):
        print("resolution_method: outside_pack")
        return
    # Tie-break by smaller RTree bounding-box area, then stable ids. This means
    # a taluk beats district/state if no user-facing locality matches.
    candidates = cursor.execute(f"""SELECT p.name,p.place_type,p.sub_district,p.district,p.state,p.state_code,g.geometry
FROM place_geometry_rtree r JOIN place_geometry g ON g.id=r.id JOIN place p ON p.id=g.place_id
WHERE r.min_lat<=? AND r.max_lat>=? AND r.min_lng<=? AND r.max_lng>=?
  AND p.place_type IN ('neighbourhood','suburb','locality','hamlet','village','town','city')
ORDER BY {PRIORITY_SQL}, ((r.max_lat-r.min_lat)*(r.max_lng-r.min_lng)), p.id, g.id""", (args.lat,args.lat,args.lon,args.lon)).fetchall()
    for row in candidates:
        if contains(parse_ring(row[6]), args.lat, args.lon):
            display(row[:6], "polygon"); return
    placeholders = ",".join("?" for _ in SETTLEMENT_TYPES)
    nearest = cursor.execute(f"""SELECT name,place_type,sub_district,district,state,state_code,latitude,longitude,
haversine(?, ?, latitude, longitude) AS metres FROM place
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND place_type IN ({placeholders})
ORDER BY metres, id LIMIT 1""", (args.lat,args.lon,*SETTLEMENT_TYPES)).fetchone()
    if not nearest: print("No named settlement with a representative coordinate found."); return
    display(nearest[:6], "nearest_place_fallback", nearest[8])

if __name__ == "__main__":
    main()
