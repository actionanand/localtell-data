import json, sqlite3, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from state_tools import enabled_packs, gzip_deterministic, gzip_matches, load_config, sha256, workspace_paths
from generate_manifest import manifest

class StateToolsTests(unittest.TestCase):
    def config(self, directory, packs=None):
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"workspace": str(Path(directory) / "work"), "sources": {"south": "source/south.pbf"}, "packs": packs or [{"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}]}))
        return path
    def test_config_and_workspace(self):
        with tempfile.TemporaryDirectory() as d:
            config = load_config(self.config(d)); self.assertEqual("TN", config["packs"][0]["id"]); self.assertEqual(Path(d, "work", "output"), workspace_paths(config)[2])
    def test_duplicate_ids_and_codes_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            pack = {"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}
            with self.assertRaisesRegex(ValueError, "duplicate pack id"): load_config(self.config(d, [pack, pack.copy()]))
    def test_duplicate_display_order_in_region_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            first = {"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}
            second = {"id":"KL","name":"Kerala","stateCode":"IN-KL","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}
            with self.assertRaisesRegex(ValueError, "duplicate displayOrder"): load_config(self.config(d, [first, second]))
    def test_same_display_order_in_different_regions_is_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            tamil_nadu = {"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}
            maharashtra = {"id":"MH","name":"Maharashtra","stateCode":"IN-MH","region":"west","displayOrder":1,"source":"south","packVersion":3,"enabled":True}
            config = load_config(self.config(d, [tamil_nadu, maharashtra]))
        self.assertEqual(["TN", "MH"], [pack["id"] for pack in config["packs"]])
    def test_deterministic_gzip_and_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            raw, first, second = (Path(d) / name for name in ("TN.db", "one.gz", "two.gz")); raw.write_bytes(b"schema-v3")
            gzip_deterministic(raw, first); gzip_deterministic(raw, second)
            self.assertEqual(first.read_bytes(), second.read_bytes()); self.assertTrue(gzip_matches(raw, first)); self.assertEqual(sha256(raw), sha256(raw))
    def test_south_order_is_display_order(self):
        config = load_config(Path(__file__).parents[1] / "config" / "india-packs.json")
        self.assertEqual(["TN", "KL", "KA", "AP", "TS", "PY", "AN", "LD"], [pack["id"] for pack in enabled_packs(config, "south")])
        self.assertEqual([1, 2, 3, 4, 5, 6, 7, 8], [pack["displayOrder"] for pack in enabled_packs(config, "south")])
    def test_manifest_emits_region_display_order_and_existing_asset_fields(self):
        with tempfile.TemporaryDirectory() as d:
            packs = [{"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","displayOrder":2,"source":"south","packVersion":3,"enabled":True},
                     {"id":"KL","name":"Kerala","stateCode":"IN-KL","region":"south","displayOrder":1,"source":"south","packVersion":3,"enabled":True}]
            config = load_config(self.config(d, packs)); output = workspace_paths(config)[2]; output.mkdir(parents=True)
            for item in packs:
                database = output / f"{item['id']}.db"
                db = sqlite3.connect(database)
                try:
                    db.executescript("CREATE TABLE place(id); CREATE TABLE place_geometry(id);")
                finally:
                    db.close()
                gzip_deterministic(database, output / f"{item['id']}.db.gz")
            data, _ = manifest(config)
        self.assertEqual(["KL", "TN"], [item["id"] for item in data["packs"]])
        self.assertEqual("south", data["packs"][0]["region"]); self.assertEqual(1, data["packs"][0]["displayOrder"])
        self.assertIn("sha256", data["packs"][0]); self.assertIn("compressedBytes", data["packs"][0]); self.assertEqual(3, data["packs"][0]["version"])

if __name__ == "__main__": unittest.main()
