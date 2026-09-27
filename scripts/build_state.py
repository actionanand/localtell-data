#!/usr/bin/env python3
import argparse, subprocess, sys
from state_tools import find_pack, load_config, source_path, workspace_paths

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pack_id"); parser.add_argument("--force", action="store_true"); parser.add_argument("--config")
    args = parser.parse_args(); config = load_config(args.config); pack = find_pack(config, args.pack_id)
    if not pack["enabled"]: parser.error(f"pack {args.pack_id} is disabled")
    _, _, output, _ = workspace_paths(config); pbf = source_path(config, pack); database = output / f"{pack['id']}.db"
    if not pbf.is_file(): parser.error(f"source PBF missing: {pbf}")
    if database.exists() and not args.force: parser.error(f"output exists: {database}; use --force to replace it")
    output.mkdir(parents=True, exist_ok=True)
    if database.exists(): database.unlink()
    command = [sys.executable, str(__import__("pathlib").Path(__file__).with_name("build_geographic_pack.py")),
        "--pbf", str(pbf), "--output", str(database), "--pack-id", pack["id"], "--pack-name", pack["name"],
        "--state-code", pack["stateCode"], "--pack-version", str(pack["packVersion"])]
    print("Running:", " ".join(command)); subprocess.run(command, check=True)

if __name__ == "__main__": main()
