#!/usr/bin/env python3
import argparse, datetime, json, sqlite3
from state_tools import RELEASE_TAG, MANIFEST_SCHEMA_VERSION, enabled_packs, load_config, sha256, workspace_paths

def manifest(config):
    output = workspace_paths(config)[2]; entries = []
    for pack in enabled_packs(config):
        database, archive = output / f"{pack['id']}.db", output / f"{pack['id']}.db.gz"
        if not database.is_file() or not archive.is_file(): raise ValueError(f"missing packaged files for {pack['id']}")
        with sqlite3.connect(database) as db:
            places = db.execute("SELECT count(*) FROM place").fetchone()[0]; geometries = db.execute("SELECT count(*) FROM place_geometry").fetchone()[0]
        entries.append({"id": pack["id"], "name": pack["name"], "version": pack["packVersion"],
            "downloadUrl": f"https://github.com/actionanand/localtell-data/releases/download/{RELEASE_TAG}/{pack['id']}.db.gz",
            "sha256": sha256(archive), "compressedBytes": archive.stat().st_size, "uncompressedBytes": database.stat().st_size,
            "_places": places, "_geometries": geometries})
    return {"schemaVersion": MANIFEST_SCHEMA_VERSION, "generatedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "packs": [{key: value for key, value in entry.items() if not key.startswith("_")} for entry in entries]}, entries

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--config"); parser.add_argument("--output"); args = parser.parse_args()
    config = load_config(args.config); data, _ = manifest(config); target = __import__("pathlib").Path(args.output) if args.output else workspace_paths(config)[3] / "manifest.json"
    target.parent.mkdir(parents=True, exist_ok=True); target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8"); print(target)

if __name__ == "__main__": main()
