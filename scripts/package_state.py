#!/usr/bin/env python3
import argparse, gzip
from state_tools import find_pack, gzip_deterministic, gzip_matches, load_config, sha256, workspace_paths
import validate_state

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("pack_id"); parser.add_argument("--config"); args = parser.parse_args()
    config = load_config(args.config); pack = find_pack(config, args.pack_id)
    # Validate before writing a distributable artifact.
    import sys
    original = sys.argv; sys.argv = ["validate_state.py", pack["id"]] + (["--config", args.config] if args.config else [])
    try: validate_state.main()
    finally: sys.argv = original
    output = workspace_paths(config)[2]; database = output / f"{pack['id']}.db"; archive = output / f"{pack['id']}.db.gz"
    gzip_deterministic(database, archive)
    if not gzip_matches(database, archive): raise SystemExit("gzip integrity/hash verification failed")
    print(f"raw_sha256: {sha256(database)}\ngzip_sha256: {sha256(archive)}\ncompressed_bytes: {archive.stat().st_size}\nuncompressed_bytes: {database.stat().st_size}")

if __name__ == "__main__": main()
