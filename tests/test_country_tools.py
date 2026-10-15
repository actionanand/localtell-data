import gzip, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts" / "countries"))
from country_tools import enabled, gzip_deterministic, load_country, paths, safe_child, workspace
from build_country_geographic_pack import CountryCollector, _filter

class CountryToolsTests(unittest.TestCase):
    def test_sri_lanka_config_has_exactly_nine_ordered_lk_packs(self):
        config = load_country(); packs = enabled(config)
        self.assertEqual("LK", config["countryCode"])
        self.assertEqual([f"LK-{n}" for n in range(1,10)], [pack["id"] for pack in packs])
        self.assertEqual([pack["id"] for pack in packs], [pack["boundaryCode"] for pack in packs])
        districts=[code for pack in packs for code in pack["districtCodes"]]
        self.assertEqual(25, len(districts)); self.assertEqual(25, len(set(districts)))
        self.assertTrue(all(code.startswith("LK-") for code in districts))
        self.assertIsNone(config["hierarchy"]["subDistrictAdminLevel"])
    def test_workspace_escape_and_deterministic_gzip(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); self.assertRaises(ValueError, safe_child, root, "../india.db")
            raw, one, two = root/"LK-1.db", root/"one.gz", root/"two.gz"; raw.write_bytes(b"LK")
            gzip_deterministic(raw,one); gzip_deterministic(raw,two)
            self.assertEqual(one.read_bytes(),two.read_bytes())
            one.write_bytes(one.read_bytes()+b"bad")
            with self.assertRaises(OSError):
                gzip.open(one,"rb").read()

    def test_country_collector_uses_only_iso3166_2_for_boundary_identity(self):
        tags = {"name": "Western Province", "boundary": "administrative", "admin_level": "4", "ref:IN": "IN-TN"}
        self.assertIsNone(CountryCollector.feature_tags(tags)["iso"])
        tags["ISO3166-2"] = "LK-1"
        self.assertEqual("LK-1", CountryCollector.feature_tags(tags)["iso"])

    def test_country_admin_boundary_prefers_english_name(self):
        tags = {
            "name": "Kurunǣgala",
            "name:en": "Kurunegala District",
            "boundary": "administrative",
            "admin_level": "5",
            "ISO3166-2": "LK-61",
        }
        feature = CountryCollector.feature_tags(tags)
        self.assertEqual("Kurunegala District", feature["name"])

    def test_country_admin_boundary_falls_back_to_default_name(self):
        tags = {
            "name": "Example District",
            "boundary": "administrative",
            "admin_level": "5",
            "ISO3166-2": "LK-99",
        }
        feature = CountryCollector.feature_tags(tags)
        self.assertEqual("Example District", feature["name"])

    def test_country_settlement_keeps_default_osm_name(self):
        tags = {
            "name": "Local Name",
            "name:en": "English Name",
            "place": "village",
        }
        feature = CountryCollector.feature_tags(tags)
        self.assertEqual("Local Name", feature["name"])

    def test_province_filter_excludes_other_level_four_extent(self):
        western_ring = [(0, 0), (0, 2), (2, 2), (2, 0), (0, 0)]
        eastern_ring = [(1, 1), (1, 3), (3, 3), (3, 1), (1, 1)]
        features = [
            {"name": "West", "place_type": "administrative_boundary", "admin_level": "4", "iso": "LK-1", "point": (1, 1), "rings": [western_ring], "bounds": [(0, 2, 0, 2)]},
            {"name": "East", "place_type": "administrative_boundary", "admin_level": "4", "iso": "LK-2", "point": (1.5, 1.5), "rings": [eastern_ring], "bounds": [(1, 3, 1, 3)]},
            {"name": "Settlement", "place_type": "village", "admin_level": None, "iso": None, "point": (1, 1), "rings": [], "bounds": []},
        ]
        self.assertEqual(["West", "Settlement"], [feature["name"] for feature in _filter(features, "LK-1", "4")])

    def test_india_root_workspace_is_rejected(self):
        config = load_country(); config["workspace"] = "~/localtell-osm-work"
        with self.assertRaises(ValueError): workspace(config)

    def test_country_workspace_requires_a_country_child(self):
        config=load_country(); config["workspace"]="~/localtell-osm-work/countries/sri-lanka"
        self.assertEqual(("countries", "sri-lanka"), workspace(config).parts[-2:])
        for path in ("~/localtell-osm-work/countries", "~/localtell-osm-work/source/LK", "~/localtell-osm-work/output/LK", "~/localtell-osm-work/release-test/LK"):
            config["workspace"]=path
            with self.assertRaises(ValueError): workspace(config)

if __name__=="__main__": unittest.main()
