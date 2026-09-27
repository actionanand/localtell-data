#!/usr/bin/env python3
"""Validate a LocalTell schema-v3 geographic SQLite pack."""
import argparse
import math
import sqlite3
import sys

REQUIRED = {"pack_meta", "place", "place_geometry", "place_geometry_rtree"}
PLACE_COLUMNS = {"id", "name", "place_type", "sub_district", "district", "state", "state_code", "latitude", "longitude"}
REQUIRED_META = {"schema_version", "pack_id", "pack_name", "pack_version"}


def parse_ring(value):
    points = []
    for pair in value.split(";"):
        lat, lon = pair.split(",")
        point = float(lat), float(lon)
        if not all(math.isfinite(number) for number in point) or not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180):
            raise ValueError(f"invalid coordinate {pair}")
        points.append(point)
    if len(points) < 4 or points[0] != points[-1] or len(set(points[:-1])) < 3:
        raise ValueError("ring is not an explicitly closed polygon")
    return points


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    args = parser.parse_args()
    db = sqlite3.connect(args.database)
    cursor = db.cursor()
    integrity = cursor.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        sys.exit(f"integrity_check failed: {integrity}")
    tables = {row[0] for row in cursor.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
    missing = REQUIRED - tables
    if missing:
        sys.exit(f"missing required tables: {', '.join(sorted(missing))}")
    meta = dict(cursor.execute("SELECT key, value FROM pack_meta"))
    if meta.get("schema_version") != "3":
        sys.exit(f"schema_version must be 3, found {meta.get('schema_version')!r}")
    if REQUIRED_META - set(meta):
        sys.exit(f"missing pack metadata: {', '.join(sorted(REQUIRED_META - set(meta)))}")
    columns = {row[1] for row in cursor.execute("PRAGMA table_info(place)")}
    if PLACE_COLUMNS - columns:
        sys.exit(f"place is missing columns: {', '.join(sorted(PLACE_COLUMNS - columns))}")
    geometry_count = cursor.execute("SELECT COUNT(*) FROM place_geometry").fetchone()[0]
    rtree_count = cursor.execute("SELECT COUNT(*) FROM place_geometry_rtree").fetchone()[0]
    if geometry_count != rtree_count:
        sys.exit(f"RTree rows ({rtree_count}) do not match geometry rows ({geometry_count})")
    missing_rtree = cursor.execute("SELECT COUNT(*) FROM place_geometry g LEFT JOIN place_geometry_rtree r ON r.id=g.id WHERE r.id IS NULL").fetchone()[0]
    if missing_rtree:
        sys.exit(f"{missing_rtree} geometry rows have no RTree entry")
    dangling = cursor.execute("SELECT COUNT(*) FROM place_geometry g LEFT JOIN place p ON p.id=g.place_id WHERE p.id IS NULL").fetchone()[0]
    if dangling:
        sys.exit(f"{dangling} geometries reference missing places")
    for geometry_id, geometry in cursor.execute("SELECT id, geometry FROM place_geometry"):
        try:
            parse_ring(geometry)
        except (ValueError, TypeError) as error:
            sys.exit(f"malformed geometry {geometry_id}: {error}")
    for place_id, lat, lon in cursor.execute("SELECT id, latitude, longitude FROM place WHERE latitude IS NOT NULL OR longitude IS NOT NULL"):
        if lat is None or lon is None or not all(math.isfinite(value) for value in (lat, lon)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            sys.exit(f"malformed representative coordinate for place {place_id}")
    print(f"VALID: schema-v3, {geometry_count} geometry rows, {cursor.execute('SELECT COUNT(*) FROM place').fetchone()[0]} places")


if __name__ == "__main__":
    main()
