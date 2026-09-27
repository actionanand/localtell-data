#!/usr/bin/env python3
import argparse, sqlite3, subprocess, sys
from pathlib import Path
from state_tools import find_pack, load_config, workspace_paths

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("pack_id"); parser.add_argument("--config"); args = parser.parse_args()
    config = load_config(args.config); pack = find_pack(config, args.pack_id); database = workspace_paths(config)[2] / f"{pack['id']}.db"
    if not database.is_file(): parser.error(f"database missing: {database}")
    subprocess.run([sys.executable, str(Path(__file__).with_name("validate_geographic_pack.py")), str(database),
        "--expected-state-code", pack["stateCode"], "--expected-pack-id", pack["id"]], check=True)
    with sqlite3.connect(database) as db:
        meta = dict(db.execute("SELECT key,value FROM pack_meta"))
        places = db.execute("SELECT count(*) FROM place").fetchone()[0]; geometries = db.execute("SELECT count(*) FROM place_geometry").fetchone()[0]
    if meta.get("schema_version") != "3" or meta.get("pack_version") != str(pack["packVersion"]) or not places or not geometries:
        raise SystemExit("state pack sanity check failed")
    print(f"VALID {pack['id']}: places={places}, geometries={geometries}, pack_version={meta['pack_version']}")

if __name__ == "__main__": main()
