"""Country-isolated schema-v3 writer for Sri Lanka province packs."""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_geographic_pack import (  # Shared geometry primitives only.
    ADMIN_LEVELS, SETTLEMENT_SET, assemble_rings, bbox, close_ring,
    format_geometry, interior_point, osmium, point_in_feature, simplify_ring,
)
from country_tools import SCHEMA_VERSION


def _prepare(feature):
    feature["rings"] = [ring for raw in feature.get("rings", []) if (ring := close_ring(raw))]
    feature["bounds"] = [bbox(ring) for ring in feature["rings"]]
    if not feature.get("point") and feature["rings"]:
        feature["point"] = interior_point(feature["rings"][0])
    return feature


_OSM_BASE = osmium.SimpleHandler if osmium else object


class CountryCollector(_OSM_BASE):
    """Collect generic OSM fields; never infer a code from ref:IN."""
    def __init__(self):
        super().__init__()
        self.places, self.ways, self.way_features, self.relation_features = [], {}, [], []
        self.needed_way_refs, self.skipped_relation_rings = None, 0

    @staticmethod
    def feature_tags(tags):
        place_type = tags.get("place")
        is_admin = tags.get("boundary") == "administrative" and tags.get("admin_level") in ADMIN_LEVELS

        # Sri Lanka administrative boundaries should use the English OSM name
        # when available, while settlements retain their normal OSM name.
        name = (tags.get("name:en") or tags.get("name")) if is_admin else tags.get("name")

        if not name or (place_type not in SETTLEMENT_SET and not is_admin):
            return None

        return {
            "name": name,
            "place_type": place_type if place_type in SETTLEMENT_SET else "administrative_boundary",
            "admin_level": tags.get("admin_level"),
            "iso": tags.get("ISO3166-2"),
        }

    def node(self, node):
        if (feature := self.feature_tags(node.tags)) and node.location.valid():
            feature.update({"point": (node.location.lat, node.location.lon), "rings": []})
            self.places.append(_prepare(feature))

    def way(self, way):
        points = [(node.location.lat, node.location.lon) for node in way.nodes if node.location.valid()]
        if self.needed_way_refs is None or way.id in self.needed_way_refs:
            self.ways[way.id] = points
        if feature := self.feature_tags(way.tags):
            feature.update({"point": None, "rings": [points]})
            self.way_features.append(_prepare(feature))

    def relation(self, relation):
        feature = self.feature_tags(relation.tags)
        if not feature or relation.tags.get("type") not in {"multipolygon", "boundary"}:
            return
        refs = [member.ref for member in relation.members if member.type == "w" and member.role != "inner"]
        rings = assemble_rings(refs, self.ways)
        self.skipped_relation_rings += max(0, len(refs) - len(rings))
        feature.update({"point": None, "rings": rings})
        self.relation_features.append(_prepare(feature))


class CountryRelationIndex(_OSM_BASE):
    def __init__(self):
        super().__init__()
        self.way_refs = set()

    def relation(self, relation):
        if CountryCollector.feature_tags(relation.tags) and relation.tags.get("type") in {"multipolygon", "boundary"}:
            self.way_refs.update(member.ref for member in relation.members if member.type == "w" and member.role != "inner")


def collect_country_features(pbf, progress=None):
    if osmium is None:
        raise RuntimeError("missing dependency 'osmium'; install with: python3 -m pip install osmium")
    if progress: progress.line("Relation-index pass starting")
    index = CountryRelationIndex(); index.apply_file(pbf)
    if progress:
        progress.line(f"Relation-index pass complete: {len(index.way_refs)} references")
        progress.line("Main feature/geometry collection pass starting")
    collector = CountryCollector(); collector.needed_way_refs = index.way_refs
    collector.apply_file(pbf, locations=True)
    if progress: progress.line(f"Collection complete: places={len(collector.places)}, ways={len(collector.way_features)}, relations={len(collector.relation_features)}")
    return collector.places + collector.way_features + collector.relation_features, collector.skipped_relation_rings


def _filter(features, boundary_code, level):
    extents = [f for f in features if f["place_type"] == "administrative_boundary" and f.get("admin_level") == level and f.get("iso") == boundary_code and f["rings"]]
    if not extents: raise ValueError(f"province boundary not found or not assemblable: {boundary_code}")
    def included(feature):
        if feature in extents: return True
        if feature["place_type"] == "administrative_boundary" and feature.get("admin_level") == level: return False
        return bool(feature.get("point")) and any(point_in_feature(feature["point"], extent) for extent in extents)
    return [feature for feature in features if included(feature)]


def _hierarchy(point, admins, levels, district_codes, province_code):
    result = {"state": None, "district": None, "sub_district": None, "state_code": None}
    if not point: return result
    for feature in admins:
        if point_in_feature(point, feature):
            if feature.get("admin_level") == levels["packBoundaryAdminLevel"] and feature.get("iso")==province_code: result["state"], result["state_code"] = feature["name"], feature.get("iso")
            elif feature.get("admin_level") == levels["districtAdminLevel"] and feature.get("iso") in district_codes: result["district"] = feature["name"]
            elif levels.get("subDistrictAdminLevel") and feature.get("admin_level") == levels["subDistrictAdminLevel"]: result["sub_district"] = feature["name"]
    return result


def _write_database(path, pack, config, features, tolerance=0.00015):
    connection = sqlite3.connect(path); cursor = connection.cursor()
    cursor.executescript("""PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE pack_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, place_type TEXT NOT NULL, admin_level TEXT NULL, sub_district TEXT, district TEXT, state TEXT, state_code TEXT, latitude REAL, longitude REAL);
CREATE TABLE place_geometry (id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL, geometry TEXT NOT NULL, FOREIGN KEY(place_id) REFERENCES place(id));
CREATE VIRTUAL TABLE place_geometry_rtree USING rtree(id, min_lat, max_lat, min_lng, max_lng);""")
    meta = [("schema_version", str(SCHEMA_VERSION)), ("pack_id", pack["id"]), ("pack_name", pack["name"]), ("pack_version", str(pack["packVersion"])), ("country_code", config["countryCode"]), ("country_name", config["countryName"]), ("pack_type", config["packType"]), ("boundary_code", pack["boundaryCode"]), ("boundary_admin_level", config["hierarchy"]["packBoundaryAdminLevel"]), ("district_codes", ",".join(sorted(pack["districtCodes"]))), ("subdistrict_admin_level", "" if config["hierarchy"].get("subDistrictAdminLevel") is None else str(config["hierarchy"]["subDistrictAdminLevel"]))]
    cursor.executemany("INSERT INTO pack_meta VALUES (?, ?)", meta)
    admins, geometry_id = [f for f in features if f["place_type"] == "administrative_boundary"], 1
    for place_id, feature in enumerate(features, 1):
        point = feature.get("point"); fields = _hierarchy(point, admins, config["hierarchy"], set(pack["districtCodes"]), pack["boundaryCode"])
        cursor.execute("INSERT INTO place VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (place_id, feature["name"], feature["place_type"], feature.get("admin_level"), fields["sub_district"], fields["district"], fields["state"], fields["state_code"], point[0] if point else None, point[1] if point else None))
        for ring in feature["rings"]:
            if not (ring := simplify_ring(ring, tolerance)): continue
            min_lat, max_lat, min_lng, max_lng = bbox(ring)
            cursor.execute("INSERT INTO place_geometry VALUES (?, ?, ?)", (geometry_id, place_id, format_geometry(ring)))
            cursor.execute("INSERT INTO place_geometry_rtree VALUES (?, ?, ?, ?, ?)", (geometry_id, min_lat, max_lat, min_lng, max_lng)); geometry_id += 1
    connection.commit(); cursor.execute("VACUUM"); connection.close()


def build_province(features, output, pack, config, progress=None):
    if progress: progress.line("Filtering start")
    filtered = _filter(features, pack["boundaryCode"], config["hierarchy"]["packBoundaryAdminLevel"])
    levels=config["hierarchy"]; allowed={levels["packBoundaryAdminLevel"]: {pack["boundaryCode"]}, levels["districtAdminLevel"]: set(pack["districtCodes"])}
    if levels.get("subDistrictAdminLevel"): allowed[levels["subDistrictAdminLevel"]]=None
    filtered=[feature for feature in filtered if feature["place_type"] != "administrative_boundary" or (feature.get("admin_level") in allowed and (allowed[feature.get("admin_level")] is None or feature.get("iso") in allowed[feature.get("admin_level")]))]
    if progress: progress.line(f"Filtering complete: retained features={len(filtered)}"); progress.line("DB writing start")
    _write_database(output, pack, config, filtered)
    if progress: progress.line("DB completion")
    return len(filtered)
