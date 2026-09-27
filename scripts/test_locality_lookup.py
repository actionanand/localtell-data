#!/usr/bin/env python3
"""Mimic LocalTell's schema-v3 RTree/polygon/nearest-place lookup."""
import argparse
import math
import sqlite3

ADMIN_TYPES = {"administrative_boundary"}


def parse_ring(value):
    return [tuple(map(float, pair.split(","))) for pair in value.split(";")]


def contains(ring, lat, lon):
    inside = False
    for index in range(len(ring) - 1):
        lat1, lon1 = ring[index]
        lat2, lon2 = ring[index + 1]
        if (lat1 > lat) != (lat2 > lat):
            crossing = (lon2 - lon1) * (lat - lat1) / (lat2 - lat1) + lon1
            if lon < crossing:
                inside = not inside
    return inside


def distance_meters(lat1, lon1, lat2, lon2):
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def display(row, method):
    keys = ("name", "place_type", "sub_district", "district", "state", "state_code")
    print("\n".join(f"{key}: {row[index]}" for index, key in enumerate(keys)))
    print(f"resolution method: {method}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    args = parser.parse_args()
    if not (-90 <= args.lat <= 90 and -180 <= args.lon <= 180):
        parser.error("coordinates are outside latitude/longitude bounds")
    db = sqlite3.connect(args.database)
    cursor = db.cursor()
    candidates = cursor.execute("""
        SELECT p.name,p.place_type,p.sub_district,p.district,p.state,p.state_code,g.geometry
        FROM place_geometry_rtree r JOIN place_geometry g ON g.id=r.id JOIN place p ON p.id=g.place_id
        WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lng <= ? AND r.max_lng >= ?
        ORDER BY CASE p.place_type WHEN 'neighbourhood' THEN 1 WHEN 'suburb' THEN 2 WHEN 'village' THEN 3 ELSE 4 END
    """, (args.lat, args.lat, args.lon, args.lon)).fetchall()
    for row in candidates:
        if contains(parse_ring(row[6]), args.lat, args.lon):
            display(row[:6], "polygon")
            return
    # Keep administrative areas available for polygon lookup, but do not allow a
    # huge state/district boundary to beat a nearby named settlement in fallback.
    rows = cursor.execute("SELECT name,place_type,sub_district,district,state,state_code,latitude,longitude FROM place WHERE latitude IS NOT NULL AND longitude IS NOT NULL").fetchall()
    rows = [row for row in rows if row[1] not in ADMIN_TYPES]
    if not rows:
        print("No named place with a representative coordinate found.")
        return
    nearest = min(rows, key=lambda row: distance_meters(args.lat, args.lon, row[6], row[7]))
    display(nearest[:6], f"nearest named place fallback ({distance_meters(args.lat, args.lon, nearest[6], nearest[7]):.0f} m)")


if __name__ == "__main__":
    main()
