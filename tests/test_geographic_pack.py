import os
import subprocess
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import build_geographic_pack as pack


def feature(name, kind, level=None, iso=None, ring=None, point=None):
    return pack.prepare_feature({"name": name, "place_type": kind, "admin_level": level,
        "iso": iso, "rings": [ring] if ring else [], "point": point})


STATE = [(8, 77), (8, 79), (11, 79), (11, 77), (8, 77)]
DISTRICT = [(8, 77), (8, 78), (9, 78), (9, 77), (8, 77)]
TALUK = [(8, 77), (8, 77.5), (8.5, 77.5), (8.5, 77), (8, 77)]


class GeographicPackTests(unittest.TestCase):
    def test_indian_hierarchy_and_state_filter(self):
        features = [feature("Tamil Nadu", "administrative_boundary", "4", "IN-TN", STATE),
                    feature("Kanniyakumari", "administrative_boundary", "5", ring=DISTRICT),
                    feature("Kalkulam", "administrative_boundary", "6", ring=TALUK),
                    feature("TN village", "village", point=(8.2, 77.2)),
                    feature("Kerala village", "village", point=(8.2, 76.2))]
        filtered, _ = pack.filter_for_state(features, "IN-TN")
        self.assertEqual({item["name"] for item in filtered}, {"Tamil Nadu", "Kanniyakumari", "Kalkulam", "TN village"})
        self.assertEqual(pack.hierarchy((8.2, 77.2), filtered), {"state": "Tamil Nadu", "district": "Kanniyakumari", "sub_district": "Kalkulam", "state_code": "IN-TN"})

    def test_concave_representative_and_simplification(self):
        ring = [(0, 0), (0, 4), (1, 4), (1, 1), (4, 1), (4, 0), (0, 0)]
        point = pack.interior_point(ring)
        self.assertTrue(pack.contains(ring, *point))
        simplified = pack.simplify_ring(ring, 0.00015)
        self.assertEqual(simplified[0], simplified[-1]); self.assertGreaterEqual(len(set(simplified[:-1])), 3)

    def test_state_boundary_must_exist(self):
        with self.assertRaisesRegex(ValueError, "state boundary"):
            pack.filter_for_state([feature("Elsewhere", "village", point=(8, 77))], "IN-TN")

    def test_admin_boundary_with_place_state_is_normalized(self):
        result = pack.OSMCollector.feature_tags({"name": "Maharashtra", "place": "state", "boundary": "administrative", "admin_level": "4", "ISO3166-2": "IN-MH"})
        self.assertIsNotNone(result)
        self.assertEqual("administrative_boundary", result["place_type"])
        self.assertEqual("4", result["admin_level"])
        self.assertEqual("IN-MH", result["iso"])

    def test_foreign_level_four_boundary_is_excluded(self):
        target_ring = [(10, 70), (10, 80), (20, 80), (20, 70), (10, 70)]
        target = feature("Karnataka", "administrative_boundary", "4", "IN-KA", target_ring)
        # Deliberately give the foreign state a representative point inside KA.
        foreign = feature("Maharashtra", "administrative_boundary", "4", "IN-MH", point=(15, 75))
        village = feature("Karnataka village", "village", point=(15, 75))
        filtered, _ = pack.filter_for_state([target, foreign, village], "IN-KA")
        self.assertEqual({"Karnataka", "Karnataka village"}, {item["name"] for item in filtered})

    def test_polygon_priority_and_nearest_excludes_admin(self):
        state = feature("Tamil Nadu", "administrative_boundary", "4", "IN-TN", STATE)
        district = feature("Kanniyakumari", "administrative_boundary", "5", ring=DISTRICT)
        village = feature("Village", "village", ring=[(8.1, 77.1), (8.1, 77.4), (8.4, 77.4), (8.4, 77.1), (8.1, 77.1)])
        neighbourhood = feature("Neighbourhood", "neighbourhood", ring=[(8.15, 77.15), (8.15, 77.25), (8.25, 77.25), (8.25, 77.15), (8.15, 77.15)])
        outside = feature("Fallback town", "town", point=(10.5, 80.5))
        with tempfile.TemporaryDirectory() as directory:
            database = os.path.join(directory, "TN.db")
            pack.create_database(database, "TN", "Tamil Nadu", 3, [state, district, village, neighbourhood, outside], 0.00015)
            helper = os.path.join(os.path.dirname(__file__), "..", "scripts", "test_locality_lookup.py")
            polygon = subprocess.check_output([sys.executable, helper, database, "--lat", "8.2", "--lon", "77.2"], text=True)
            nearest = subprocess.check_output([sys.executable, helper, database, "--lat", "8.8", "--lon", "77.8"], text=True)
            outside_pack = subprocess.check_output([sys.executable, helper, database, "--lat", "10.45", "--lon", "80.45"], text=True)
        self.assertIn("name: Neighbourhood", polygon)
        self.assertIn("resolution_method: polygon", polygon)
        self.assertIn("name: Village", nearest)
        self.assertIn("resolution_method: nearest_place_fallback", nearest)
        self.assertEqual("resolution_method: outside_pack\n", outside_pack)

    def test_admin_levels_are_persisted_and_tn_extent_validates(self):
        features = [feature("Tamil Nadu", "administrative_boundary", "4", "IN-TN", STATE),
                    feature("Kanniyakumari", "administrative_boundary", "5", ring=DISTRICT),
                    feature("Kalkulam", "administrative_boundary", "6", ring=TALUK),
                    feature("Village", "village", point=(8.2, 77.2))]
        with tempfile.TemporaryDirectory() as directory:
            database = os.path.join(directory, "TN.db")
            pack.create_database(database, "TN", "Tamil Nadu", 3, features, 0.00015)
            connection = sqlite3.connect(database)
            try:
                levels = dict(connection.execute("SELECT name, admin_level FROM place"))
            finally:
                connection.close()
            validator = os.path.join(os.path.dirname(__file__), "..", "scripts", "validate_geographic_pack.py")
            result = subprocess.run([sys.executable, validator, database, "--expected-state-code", "IN-TN", "--expected-pack-id", "TN"], text=True, capture_output=True, check=False)
        self.assertEqual({"Tamil Nadu": "4", "Kanniyakumari": "5", "Kalkulam": "6", "Village": None}, levels)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_validator_rejects_unsupported_type_and_foreign_level_four(self):
        target = feature("Karnataka", "administrative_boundary", "4", "IN-KA", STATE)
        foreign = feature("Maharashtra", "administrative_boundary", "4", "IN-MH", DISTRICT)
        with tempfile.TemporaryDirectory() as directory:
            database = os.path.join(directory, "KA.db")
            pack.create_database(database, "KA", "Karnataka", 3, [target, foreign], 0.00015)
            validator = os.path.join(os.path.dirname(__file__), "..", "scripts", "validate_geographic_pack.py")
            foreign_result = subprocess.run([sys.executable, validator, database, "--expected-state-code", "IN-KA", "--expected-pack-id", "KA"], text=True, capture_output=True, check=False)
            connection = sqlite3.connect(database)
            try:
                connection.execute("UPDATE place SET place_type='state', state_code='IN-KA' WHERE name='Maharashtra'")
                connection.commit()
            finally:
                connection.close()
            type_result = subprocess.run([sys.executable, validator, database, "--expected-state-code", "IN-KA", "--expected-pack-id", "KA"], text=True, capture_output=True, check=False)
        self.assertNotEqual(0, foreign_result.returncode)
        self.assertIn("foreign level-4", foreign_result.stderr)
        self.assertNotEqual(0, type_result.returncode)
        self.assertIn("unsupported place types", type_result.stderr)


if __name__ == "__main__":
    unittest.main()
