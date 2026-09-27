#!/usr/bin/env python3
"""Build a LocalTell schema-v3 geographic locality pack from a local OSM PBF.

Requires pyosmium: python3 -m pip install osmium
"""
import argparse
import math
import os
import sqlite3
import sys
import time

try:
    import osmium
except ImportError:
    sys.exit("Missing dependency 'osmium'. Install it with: python3 -m pip install osmium")


SETTLEMENT_TYPES = {"city", "town", "village", "hamlet", "suburb", "neighbourhood", "locality"}
ADMIN_LEVELS = {"3", "4", "5", "6", "7", "8"}


def valid_point(point):
    return point and -90 <= point[0] <= 90 and -180 <= point[1] <= 180


def close_ring(points):
    points = [point for point in points if valid_point(point)]
    if len(points) < 3:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    return points if len(set(points[:-1])) >= 3 else None


def perpendicular_distance(point, start, end):
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def simplify_open(points, tolerance):
    if len(points) < 3 or tolerance <= 0:
        return points
    most_distant, index = tolerance, None
    for i in range(1, len(points) - 1):
        distance = perpendicular_distance(points[i], points[0], points[-1])
        if distance > most_distant:
            most_distant, index = distance, i
    if index is None:
        return [points[0], points[-1]]
    return simplify_open(points[:index + 1], tolerance)[:-1] + simplify_open(points[index:], tolerance)


def simplify_ring(ring, tolerance):
    ring = close_ring(ring)
    if not ring:
        return None
    # Douglas-Peucker needs an open line. Preserve validity if simplification
    # would collapse a small polygon.
    simplified = simplify_open(ring[:-1] + [ring[0]], tolerance)
    result = close_ring(simplified[:-1])
    return result if result else ring


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


def bbox(ring):
    lats, lons = zip(*ring)
    return min(lats), max(lats), min(lons), max(lons)


def format_geometry(ring):
    return ";".join(f"{lat:.7f},{lon:.7f}" for lat, lon in ring)


def assemble_rings(way_refs, ways):
    """Join member ways into explicitly closed outer rings."""
    chains = [list(ways[ref]) for ref in way_refs if ref in ways and len(ways[ref]) >= 2]
    rings = []
    while chains:
        chain = chains.pop(0)
        changed = True
        while changed and chain[0] != chain[-1]:
            changed = False
            for index, candidate in enumerate(chains):
                if chain[-1] == candidate[0]:
                    chain.extend(candidate[1:])
                elif chain[-1] == candidate[-1]:
                    chain.extend(reversed(candidate[:-1]))
                elif chain[0] == candidate[-1]:
                    chain = candidate[:-1] + chain
                elif chain[0] == candidate[0]:
                    chain = list(reversed(candidate[1:])) + chain
                else:
                    continue
                chains.pop(index)
                changed = True
                break
        ring = close_ring(chain)
        if ring:
            rings.append(ring)
    return rings


class OSMCollector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.places = []
        self.ways = {}
        self.way_features = []
        self.relation_features = []

    @staticmethod
    def feature_tags(tags):
        name = tags.get("name")
        place_type = tags.get("place")
        is_admin = tags.get("boundary") == "administrative" and tags.get("admin_level") in ADMIN_LEVELS
        if not name or (place_type not in SETTLEMENT_TYPES and not is_admin):
            return None
        return {"name": name, "place_type": place_type or "administrative_boundary",
                "admin_level": tags.get("admin_level"), "iso": tags.get("ISO3166-2") or tags.get("ref:IN") or tags.get("state_code")}

    def node(self, node):
        feature = self.feature_tags(node.tags)
        if feature and node.location.valid():
            feature.update({"source": f"node/{node.id}", "point": (node.location.lat, node.location.lon), "rings": []})
            self.places.append(feature)

    def way(self, way):
        points = []
        for node in way.nodes:
            if node.location.valid():
                points.append((node.location.lat, node.location.lon))
        self.ways[way.id] = points
        feature = self.feature_tags(way.tags)
        if feature:
            feature.update({"source": f"way/{way.id}", "point": None, "rings": [close_ring(points)] if close_ring(points) else []})
            self.way_features.append(feature)

    def relation(self, relation):
        feature = self.feature_tags(relation.tags)
        if not feature or relation.tags.get("type") not in {"multipolygon", "boundary"}:
            return
        outer_refs = [member.ref for member in relation.members if member.type == "w" and member.role != "inner"]
        feature.update({"source": f"relation/{relation.id}", "point": None, "rings": assemble_rings(outer_refs, self.ways)})
        self.relation_features.append(feature)


def representative_point(feature):
    if feature["point"]:
        return feature["point"]
    if feature["rings"]:
        ring = feature["rings"][0][:-1]
        return (sum(point[0] for point in ring) / len(ring), sum(point[1] for point in ring) / len(ring))
    return None


def hierarchy(point, admin_features):
    result = {"state": None, "district": None, "sub_district": None, "state_code": None}
    if not point:
        return result
    matches = []
    for feature in admin_features:
        if any(contains(ring, *point) for ring in feature["rings"]):
            matches.append(feature)
    # Smaller administrative levels take precedence within their category.
    for feature in sorted(matches, key=lambda item: int(item["admin_level"] or 0), reverse=True):
        level = int(feature["admin_level"] or 0)
        if level <= 5 and not result["state"]:
            result["state"], result["state_code"] = feature["name"], feature["iso"]
        elif level == 6 and not result["district"]:
            result["district"] = feature["name"]
        elif level >= 7 and not result["sub_district"]:
            result["sub_district"] = feature["name"]
    return result


def create_database(path, pack_id, pack_name, version, features, tolerance):
    connection = sqlite3.connect(path)
    cursor = connection.cursor()
    cursor.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE pack_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE place (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, place_type TEXT NOT NULL,
            sub_district TEXT, district TEXT, state TEXT, state_code TEXT,
            latitude REAL, longitude REAL
        );
        CREATE TABLE place_geometry (id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL, geometry TEXT NOT NULL,
            FOREIGN KEY(place_id) REFERENCES place(id));
        CREATE VIRTUAL TABLE place_geometry_rtree USING rtree(id, min_lat, max_lat, min_lng, max_lng);
    """)
    cursor.executemany("INSERT INTO pack_meta(key, value) VALUES (?, ?)", [
        ("schema_version", "3"), ("pack_id", pack_id), ("pack_name", pack_name), ("pack_version", str(version)),
    ])
    admin_features = [feature for feature in features if feature["place_type"] == "administrative_boundary"]
    geometry_id = 1
    for place_id, feature in enumerate(features, 1):
        point = representative_point(feature)
        fields = hierarchy(point, admin_features)
        cursor.execute("INSERT INTO place VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (place_id, feature["name"], feature["place_type"], fields["sub_district"], fields["district"],
                        fields["state"], fields["state_code"], point[0] if point else None, point[1] if point else None))
        for ring in feature["rings"]:
            ring = simplify_ring(ring, tolerance)
            if not ring:
                continue
            min_lat, max_lat, min_lng, max_lng = bbox(ring)
            cursor.execute("INSERT INTO place_geometry VALUES (?, ?, ?)", (geometry_id, place_id, format_geometry(ring)))
            cursor.execute("INSERT INTO place_geometry_rtree VALUES (?, ?, ?, ?, ?)",
                           (geometry_id, min_lat, max_lat, min_lng, max_lng))
            geometry_id += 1
    connection.commit()
    cursor.execute("VACUUM")
    connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", required=True, help="Tamil Nadu or India .osm.pbf input")
    parser.add_argument("--output", required=True, help="Output SQLite pack path (must not already exist)")
    parser.add_argument("--pack-id", default="TN")
    parser.add_argument("--pack-name", default="Tamil Nadu")
    parser.add_argument("--version", type=int, default=3)
    parser.add_argument("--simplify-tolerance", type=float, default=0.00015, help="Degrees; default is roughly 17 m")
    args = parser.parse_args()
    start = time.monotonic()
    if args.version != 3:
        parser.error("schema-v3 builder requires --version 3")
    if os.path.exists(args.output):
        parser.error(f"output already exists: {args.output} (choose a new path)")
    output_parent = os.path.dirname(os.path.abspath(args.output))
    if output_parent:
        os.makedirs(output_parent, exist_ok=True)
    collector = OSMCollector()
    collector.apply_file(args.pbf, locations=True)
    features = collector.places + collector.way_features + collector.relation_features
    create_database(args.output, args.pack_id, args.pack_name, args.version, features, args.simplify_tolerance)
    print(f"Built {args.output}: {len(features)} places in {time.monotonic() - start:.1f}s")


if __name__ == "__main__":
    main()
