#!/usr/bin/env python3
import argparse, subprocess, sys
from pathlib import Path
from state_tools import enabled_packs, load_config
def main():
    parser = argparse.ArgumentParser(); parser.add_argument("region"); parser.add_argument("--force", action="store_true"); parser.add_argument("--config"); args = parser.parse_args()
    packs = enabled_packs(load_config(args.config), None if args.region == "all" else args.region)
    if not packs: parser.error(f"no enabled packs for region {args.region}")
    failed = []
    for pack in packs:
        command = [sys.executable, str(Path(__file__).with_name("build_state.py")), pack["id"]] + (["--force"] if args.force else []) + (["--config", args.config] if args.config else [])
        if subprocess.run(command).returncode: failed.append(pack["id"])
    if failed: raise SystemExit(f"failed state builds: {', '.join(failed)}")
if __name__ == "__main__": main()
