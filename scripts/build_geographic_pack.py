#!/usr/bin/env python3
"""Build a LocalTell schema-v3 geographic pack from a local OSM PBF."""
import argparse
import math
import os
import sqlite3
import sys
import time
from pathlib import Path
from progress_logging import ProgressReporter

try:
    import osmium
except ImportError:  # Unit tests can exercise geometry/database code without this.
    osmium = None

SETTLEMENT_TYPES = ("neighbourhood", "suburb", "locality", "hamlet", "village", "town", "city")
SETTLEMENT_SET = set(SETTLEMENT_TYPES)
ADMIN_LEVELS = {"4", "5", "6", "7", "8"}
SCHEMA_VERSION = 3


def valid_point(point):
    return point and -90 <= point[0] <= 90 and -180 <= point[1] <= 180


def close_ring(points):
    points = [point for point in points if valid_point(point)]
    if len(points) < 3:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    return points if len(set(points[:-1])) >= 3 else None


def bbox(ring):
    lats, lons = zip(*ring)
    return min(lats), max(lats), min(lons), max(lons)


def point_in_bbox(point, bounds):
    return bounds[0] <= point[0] <= bounds[1] and bounds[2] <= point[1] <= bounds[3]


def contains(ring, lat, lon):
    """Even/odd point-in-ring test compatible with Android's single-ring contract."""
    inside = False
    for (lat1, lon1), (lat2, lon2) in zip(ring, ring[1:]):
        if (lat1 > lat) != (lat2 > lat):
            crossing = (lon2 - lon1) * (lat - lat1) / (lat2 - lat1) + lon1
            if lon < crossing:
                inside = not inside
    return inside


def point_in_feature(point, feature):
    return any(point_in_bbox(point, bounds) and contains(ring, *point)
               for ring, bounds in zip(feature["rings"], feature["bounds"]))


def polygon_centroid(ring):
    area_twice = cx = cy = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(ring, ring[1:]):
        cross = lon1 * lat2 - lon2 * lat1
        area_twice += cross
        cx += (lon1 + lon2) * cross
        cy += (lat1 + lat2) * cross
    return None if abs(area_twice) < 1e-15 else (cy / (3 * area_twice), cx / (3 * area_twice))


def interior_point(ring):
    """Return a deterministic strictly interior point; never an unchecked average."""
    ring = close_ring(ring)
    if not ring:
        return None
    min_lat, max_lat, min_lon, max_lon = bbox(ring)
    candidates = [polygon_centroid(ring), ((min_lat + max_lat) / 2, (min_lon + max_lon) / 2)]
    for candidate in candidates:
        if candidate and contains(ring, *candidate):
            return candidate
    # Scan between each pair of vertex latitudes. A valid polygon always has
    # an interior span on at least one such scanline.
    latitudes = sorted(set(point[0] for point in ring[:-1]))
    for lower, upper in zip(latitudes, latitudes[1:]):
        scan_lat = (lower + upper) / 2
        crossings = sorted((lon2 - lon1) * (scan_lat - lat1) / (lat2 - lat1) + lon1
                           for (lat1, lon1), (lat2, lon2) in zip(ring, ring[1:])
                           if (lat1 > scan_lat) != (lat2 > scan_lat))
        spans = [(right - left, (left + right) / 2) for left, right in zip(crossings[::2], crossings[1::2]) if right > left]
        if spans:
            _, scan_lon = max(spans)
            if contains(ring, scan_lat, scan_lon):
                return scan_lat, scan_lon
    return None


def perpendicular_distance(point, start, end):
    x, y = point; x1, y1 = start; x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    return math.hypot(x - x1, y - y1) if dx == 0 and dy == 0 else abs(dy*x - dx*y + x2*y1 - y2*x1) / math.hypot(dx, dy)


def simplify_open(points, tolerance):
    if len(points) < 3 or tolerance <= 0:
        return points
    distance, index = tolerance, None
    for current in range(1, len(points) - 1):
        candidate = perpendicular_distance(points[current], points[0], points[-1])
        if candidate > distance:
            distance, index = candidate, current
    return [points[0], points[-1]] if index is None else simplify_open(points[:index + 1], tolerance)[:-1] + simplify_open(points[index:], tolerance)


def simplify_ring(ring, tolerance):
    original = close_ring(ring)
    if not original:
        return None
    simplified = close_ring(simplify_open(original[:-1] + [original[0]], tolerance)[:-1])
    return simplified if simplified and interior_point(simplified) else original


def prepare_feature(feature):
    feature["rings"] = [ring for raw in feature.get("rings", []) if (ring := close_ring(raw))]
    feature["bounds"] = [bbox(ring) for ring in feature["rings"]]
    if not feature.get("point") and feature["rings"]:
        feature["point"] = interior_point(feature["rings"][0])
    return feature


def assemble_rings(way_refs, ways):
    chains = [list(ways[ref]) for ref in way_refs if ref in ways and len(ways[ref]) >= 2]
    rings = []
    while chains:
        chain = chains.pop(0)
        while chain[0] != chain[-1]:
            for index, candidate in enumerate(chains):
                if chain[-1] == candidate[0]: chain.extend(candidate[1:])
                elif chain[-1] == candidate[-1]: chain.extend(reversed(candidate[:-1]))
                elif chain[0] == candidate[-1]: chain = candidate[:-1] + chain
                elif chain[0] == candidate[0]: chain = list(reversed(candidate[1:])) + chain
                else: continue
                chains.pop(index); break
            else: break
        if ring := close_ring(chain):
            rings.append(ring)
    return rings


_OSMBase = osmium.SimpleHandler if osmium else object


class OSMCollector(_OSMBase):
    def __init__(self):
        super().__init__()
        self.places, self.ways, self.way_features, self.relation_features = [], {}, [], []
        self.skipped_relation_rings = 0
        self.needed_way_refs = None

    @staticmethod
    def feature_tags(tags):
        name, place_type = tags.get("name"), tags.get("place")
        is_admin = tags.get("boundary") == "administrative" and tags.get("admin_level") in ADMIN_LEVELS
        if not name or (place_type not in SETTLEMENT_SET and not is_admin):
            return None
        return {"name": name, "place_type": place_type if place_type in SETTLEMENT_SET else "administrative_boundary", "admin_level": tags.get("admin_level"),
                "iso": tags.get("ISO3166-2") or tags.get("ref:IN") or tags.get("state_code")}

    def node(self, node):
        if feature := self.feature_tags(node.tags):
            if node.location.valid():
                feature.update({"source": f"node/{node.id}", "point": (node.location.lat, node.location.lon), "rings": []})
                self.places.append(prepare_feature(feature))

    def way(self, way):
        points = [(node.location.lat, node.location.lon) for node in way.nodes if node.location.valid()]
        if self.needed_way_refs is None or way.id in self.needed_way_refs:
            self.ways[way.id] = points
        if feature := self.feature_tags(way.tags):
            feature.update({"source": f"way/{way.id}", "point": None, "rings": [points]})
            self.way_features.append(prepare_feature(feature))

    def relation(self, relation):
        feature = self.feature_tags(relation.tags)
        if not feature or relation.tags.get("type") not in {"multipolygon", "boundary"}:
            return
        refs = [member.ref for member in relation.members if member.type == "w" and member.role != "inner"]
        rings = assemble_rings(refs, self.ways)
        self.skipped_relation_rings += max(0, len(refs) - len(rings))
        feature.update({"source": f"relation/{relation.id}", "point": None, "rings": rings})
        self.relation_features.append(prepare_feature(feature))


class RelationIndex(_OSMBase):
    """First pass: retain only way IDs needed by relevant place/admin relations."""
    def __init__(self):
        super().__init__()
        self.way_refs = set()

    def relation(self, relation):
        feature = OSMCollector.feature_tags(relation.tags)
        if feature and relation.tags.get("type") in {"multipolygon", "boundary"}:
            self.way_refs.update(member.ref for member in relation.members
                                 if member.type == "w" and member.role != "inner")


def find_state(features, state_code):
    matches = [feature for feature in features if feature["place_type"] == "administrative_boundary"
               and feature.get("admin_level") == "4" and feature.get("iso") == state_code and feature["rings"]]
    if not matches:
        raise ValueError(f"requested state boundary not found or not assemblable: {state_code}")
    return matches


def filter_for_state(features, state_code):
    states = find_state(features, state_code)
    def included(feature):
        if feature in states:
            return True
        # A foreign state/UT may have an interior point inside the requested
        # state near a border. It is never hierarchy data for this pack.
        if feature["place_type"] == "administrative_boundary" and feature.get("admin_level") == "4":
            return False
        return feature.get("point") and any(point_in_feature(feature["point"], state) for state in states)
    return [feature for feature in features if included(feature)], states


def hierarchy(point, admin_features):
    result = {"state": None, "district": None, "sub_district": None, "state_code": None}
    if not point: return result
    for feature in admin_features:
        if point_in_feature(point, feature):
            if feature.get("admin_level") == "4":
                result["state"], result["state_code"] = feature["name"], feature.get("iso")
            elif feature.get("admin_level") == "5": result["district"] = feature["name"]
            elif feature.get("admin_level") == "6": result["sub_district"] = feature["name"]
    return result


def format_geometry(ring):
    return ";".join(f"{lat:.7f},{lon:.7f}" for lat, lon in ring)


def create_database(path, pack_id, pack_name, version, features, tolerance):
    connection = sqlite3.connect(path); cursor = connection.cursor()
    cursor.executescript("""PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE pack_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, place_type TEXT NOT NULL, admin_level TEXT NULL, sub_district TEXT, district TEXT, state TEXT, state_code TEXT, latitude REAL, longitude REAL);
CREATE TABLE place_geometry (id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL, geometry TEXT NOT NULL, FOREIGN KEY(place_id) REFERENCES place(id));
CREATE VIRTUAL TABLE place_geometry_rtree USING rtree(id, min_lat, max_lat, min_lng, max_lng);""")
    cursor.executemany("INSERT INTO pack_meta VALUES (?, ?)", [("schema_version", str(SCHEMA_VERSION)), ("pack_id", pack_id), ("pack_name", pack_name), ("pack_version", str(version))])
    admins = [feature for feature in features if feature["place_type"] == "administrative_boundary"]; geometry_id = 1
    for place_id, feature in enumerate(features, 1):
        point = feature.get("point"); fields = hierarchy(point, admins)
        cursor.execute("INSERT INTO place VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (place_id, feature["name"], feature["place_type"], feature.get("admin_level"), fields["sub_district"], fields["district"], fields["state"], fields["state_code"], point[0] if point else None, point[1] if point else None))
        for ring in feature["rings"]:
            if not (ring := simplify_ring(ring, tolerance)): continue
            min_lat, max_lat, min_lng, max_lng = bbox(ring)
            cursor.execute("INSERT INTO place_geometry VALUES (?, ?, ?)", (geometry_id, place_id, format_geometry(ring)))
            cursor.execute("INSERT INTO place_geometry_rtree VALUES (?, ?, ?, ?, ?)", (geometry_id, min_lat, max_lat, min_lng, max_lng)); geometry_id += 1
    connection.commit(); cursor.execute("VACUUM"); connection.close()


def collect_features(pbf, progress=None):
    """Parse an OSM PBF once and return reusable feature records plus diagnostics."""
    if osmium is None:
        raise RuntimeError("missing dependency 'osmium'; install with: python3 -m pip install osmium")
    progress = progress or ProgressReporter()
    with progress.phase("Relation-index pass"):
        relation_index = RelationIndex(); relation_index.apply_file(pbf)
    progress.line(f"[{progress.label}] Relation-index references: {len(relation_index.way_refs)}")
    collector = OSMCollector(); collector.needed_way_refs = relation_index.way_refs
    with progress.phase("Main feature/geometry collection pass"):
        collector.apply_file(pbf, locations=True)
    progress.line(f"[{progress.label}] Collected places={len(collector.places)}, ways={len(collector.way_features)}, relations={len(collector.relation_features)}")
    return collector.places + collector.way_features + collector.relation_features, collector.skipped_relation_rings


def build_pack_from_features(features, output, pack_id, pack_name, state_code, pack_version, tolerance=0.00015, progress=None):
    """Filter one state/UT and write its pack from an already collected PBF."""
    progress = progress or ProgressReporter()
    with progress.phase("Filtering"):
        filtered, _ = filter_for_state(features, state_code)
    progress.line(f"[{progress.label}] Retained features: {len(filtered)}")
    with progress.phase("DB writing"):
        create_database(output, pack_id, pack_name, pack_version, filtered, tolerance)
    return len(filtered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", required=True); parser.add_argument("--output", required=True); parser.add_argument("--pack-id", default="TN"); parser.add_argument("--pack-name", default="Tamil Nadu"); parser.add_argument("--pack-version", "--version", dest="pack_version", type=int, default=3); parser.add_argument("--state-code"); parser.add_argument("--progress", action="store_true"); parser.add_argument("--simplify-tolerance", type=float, default=0.00015, help="Degrees, roughly 17 m")
    args = parser.parse_args()
    if osmium is None: parser.error("missing dependency 'osmium'; install with: python3 -m pip install osmium")
    if os.path.exists(args.output): parser.error(f"output already exists: {args.output}")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    start = time.monotonic()
    try:
        reporter = ProgressReporter(args.progress, Path(args.pbf).stem)
        features, skipped = collect_features(args.pbf, reporter)
        count = build_pack_from_features(features, args.output, args.pack_id, args.pack_name, args.state_code, args.pack_version, args.simplify_tolerance, reporter) if args.state_code else (create_database(args.output, args.pack_id, args.pack_name, args.pack_version, features, args.simplify_tolerance) or len(features))
    except (RuntimeError, ValueError) as error:
        parser.error(str(error))
    print(f"Built {args.output}: {count} places in {time.monotonic()-start:.1f}s; tolerance={args.simplify_tolerance}; skipped relation rings={skipped}")

if __name__ == "__main__":
    main()
