import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from state_tools import load_config, workspace_paths
from validate_region import select_packs, validate_region

def pack(identifier, region, order, enabled=True):
    return {"id": identifier, "name": identifier, "stateCode": f"IN-{identifier}", "region": region,
            "displayOrder": order, "source": "source", "packVersion": 3, "enabled": enabled}

class ValidateRegionTests(unittest.TestCase):
    def config(self, directory, packs):
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"workspace": str(Path(directory) / "work"), "sources": {"source": "source/data.pbf"}, "packs": packs}))
        return load_config(path)
    def touch_databases(self, config, packs):
        output = workspace_paths(config)[2]; output.mkdir(parents=True)
        for item in packs: (output / f"{item['id']}.db").write_bytes(b"db")
    def test_region_selection_order_disabled_case_and_all(self):
        with tempfile.TemporaryDirectory() as d:
            config = self.config(d, [pack("GJ","west",2), pack("MH","west",1), pack("TN","south",1), pack("XX","west",3,False)])
        self.assertEqual(["MH","GJ"], [p["id"] for p in select_packs(config, "WEST")])
        self.assertEqual(["TN"], [p["id"] for p in select_packs(config, "South")])
        self.assertEqual(["TN","MH","GJ"], [p["id"] for p in select_packs(config, "all")])
    def test_all_pass_and_individual_runner_order(self):
        with tempfile.TemporaryDirectory() as d:
            packs = [pack("MH","west",1), pack("GJ","west",2)]; config = self.config(d, packs); self.touch_databases(config, packs)
            called, lines = [], []
            result = validate_region(config, "west", runner=lambda item, _: called.append(item["id"]) or True, emit=lambda message, flush=True: lines.append(message))
        self.assertTrue(result); self.assertEqual(["MH","GJ"], called); self.assertIn("Regional validation complete: 2/2 passed", lines)
    def test_failures_and_missing_database_continue(self):
        with tempfile.TemporaryDirectory() as d:
            packs = [pack("MH","west",1), pack("GJ","west",2), pack("GA","west",3)]; config = self.config(d, packs)
            self.touch_databases(config, [packs[0], packs[2]])
            called, lines = [], []
            result = validate_region(config, "west", runner=lambda item, _: called.append(item["id"]) or item["id"] != "GA", emit=lambda message, flush=True: lines.append(message))
        self.assertFalse(result); self.assertEqual(["MH","GA"], called)
        self.assertIn("FAILED: database missing:", "\n".join(lines)); self.assertIn("Failed packs: GJ, GA", lines)

if __name__ == "__main__": unittest.main()
