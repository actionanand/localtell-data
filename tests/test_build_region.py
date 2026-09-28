import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from build_region import build_region, group_by_source
from state_tools import enabled_packs, load_config, workspace_paths

def pack(identifier, region, source, order, enabled=True):
    return {"id": identifier, "name": identifier, "stateCode": f"IN-{identifier}", "region": region,
            "displayOrder": order, "source": source, "packVersion": 3, "enabled": enabled}

class BuildRegionTests(unittest.TestCase):
    def config(self, directory, packs):
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"workspace": str(Path(directory) / "work"),
            "sources": {"south": "source/south.pbf", "west": "source/west.pbf"}, "packs": packs}))
        return load_config(path)
    def test_region_selection_order_disabled_and_source_grouping(self):
        with tempfile.TemporaryDirectory() as d:
            config = self.config(d, [pack("KL","south","south",2), pack("TN","south","south",1),
                pack("MH","west","west",1), pack("GJ","west","west",2), pack("XX","west","west",3,False)])
        self.assertEqual(["TN","KL"], [p["id"] for p in enabled_packs(config, "south")])
        self.assertEqual(["MH","GJ"], [p["id"] for p in enabled_packs(config, "west")])
        self.assertEqual(["west"], list(group_by_source(enabled_packs(config, "west"))))
    def test_two_sources_create_two_groups(self):
        groups = group_by_source([pack("TN","south","south",1), pack("AN","south","west",2)])
        self.assertEqual({"south", "west"}, set(groups))
    def test_existing_output_fails_before_collection_and_force_reuses_one_collection(self):
        with tempfile.TemporaryDirectory() as d:
            config = self.config(d, [pack("TN","south","south",1), pack("KL","south","south",2)])
            _, source_dir, output, _ = workspace_paths(config); source_dir.mkdir(parents=True); (source_dir / "south.pbf").write_bytes(b"pbf")
            output.mkdir(); existing = output / "TN.db"; existing.write_bytes(b"old")
            calls = []
            with self.assertRaisesRegex(ValueError, "output already exists"):
                build_region(config, "south", collector=lambda *_: calls.append(1), builder=lambda *_args, **_kwargs: 0)
            self.assertEqual([], calls)
            built = []
            def collector(path, progress=None): calls.append(path); return (["features"], 0)
            def builder(features, target, *args, **kwargs): built.append((features, target.name)); target.write_bytes(b"new"); return 1
            build_region(config, "south", force=True, collector=collector, builder=builder)
        self.assertEqual(1, len(calls)); self.assertEqual([(["features"], "TN.db"), (["features"], "KL.db")], built)
    def test_progress_reports_source_and_pack_without_extra_collection(self):
        with tempfile.TemporaryDirectory() as d:
            config = self.config(d, [pack("TN","south","south",1)])
            _, source_dir, output, _ = workspace_paths(config); source_dir.mkdir(parents=True); (source_dir / "south.pbf").write_bytes(b"pbf")
            calls, lines = [], []
            class Reporter:
                def __init__(self, enabled, label): self.label = label
                def line(self, message): lines.append(message)
            def collector(path, progress): calls.append(path); progress.line("[south] collection test"); return (["features"], 0)
            def builder(features, target, *args, progress=None): progress.line("[TN] pack test"); target.parent.mkdir(exist_ok=True); target.write_bytes(b"db"); return 1
            build_region(config, "south", progress=True, collector=collector, builder=builder, reporter_factory=Reporter)
        self.assertEqual(1, len(calls)); self.assertTrue(any("Source PBF" in line for line in lines)); self.assertTrue(any("Building TN" in line for line in lines)); self.assertTrue(any("pack test" in line for line in lines))

if __name__ == "__main__": unittest.main()
