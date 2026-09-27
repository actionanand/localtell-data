import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from state_tools import gzip_deterministic, gzip_matches, load_config, sha256, workspace_paths

class StateToolsTests(unittest.TestCase):
    def config(self, directory, packs=None):
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"workspace": str(Path(directory) / "work"), "sources": {"south": "source/south.pbf"}, "packs": packs or [{"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","source":"south","packVersion":3,"enabled":True}]}))
        return path
    def test_config_and_workspace(self):
        with tempfile.TemporaryDirectory() as d:
            config = load_config(self.config(d)); self.assertEqual("TN", config["packs"][0]["id"]); self.assertEqual(Path(d, "work", "output"), workspace_paths(config)[2])
    def test_duplicate_ids_and_codes_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            pack = {"id":"TN","name":"Tamil Nadu","stateCode":"IN-TN","region":"south","source":"south","packVersion":3,"enabled":True}
            with self.assertRaisesRegex(ValueError, "duplicate pack id"): load_config(self.config(d, [pack, pack.copy()]))
    def test_deterministic_gzip_and_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            raw, first, second = (Path(d) / name for name in ("TN.db", "one.gz", "two.gz")); raw.write_bytes(b"schema-v3")
            gzip_deterministic(raw, first); gzip_deterministic(raw, second)
            self.assertEqual(first.read_bytes(), second.read_bytes()); self.assertTrue(gzip_matches(raw, first)); self.assertEqual(sha256(raw), sha256(raw))

if __name__ == "__main__": unittest.main()
