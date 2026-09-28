#!/usr/bin/env python3
"""Validate every enabled pack in a configured region, sequentially."""
import argparse
import subprocess
import sys
from pathlib import Path

from state_tools import enabled_packs, load_config, workspace_paths


def select_packs(config, region):
    normalized = region.lower()
    return enabled_packs(config) if normalized == "all" else [pack for pack in enabled_packs(config) if pack["region"].lower() == normalized]


def run_state_validator(pack, config_path=None):
    command = [sys.executable, str(Path(__file__).with_name("validate_state.py")), pack["id"]]
    if config_path: command += ["--config", str(config_path)]
    return subprocess.run(command).returncode == 0


def validate_region(config, region, config_path=None, runner=run_state_validator, emit=print):
    packs = select_packs(config, region)
    if not packs:
        raise ValueError(f"no enabled packs for region {region}")
    output = workspace_paths(config)[2]
    failed = []
    for index, pack in enumerate(packs, 1):
        emit(f"[{index}/{len(packs)}] {pack['id']} — {pack['name']}", flush=True)
        database = output / f"{pack['id']}.db"
        if not database.is_file():
            emit(f"FAILED: database missing: {database}", flush=True)
            failed.append(pack["id"])
            continue
        if runner(pack, config_path):
            emit("VALID", flush=True)
        else:
            emit("FAILED", flush=True)
            failed.append(pack["id"])
    if failed:
        emit(f"Regional validation failed: {len(packs)-len(failed)}/{len(packs)} passed", flush=True)
        emit(f"Failed packs: {', '.join(failed)}", flush=True)
        return False
    emit(f"Regional validation complete: {len(packs)}/{len(packs)} passed", flush=True)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("region"); parser.add_argument("--config")
    args = parser.parse_args()
    try:
        success = validate_region(load_config(args.config), args.region, args.config)
    except ValueError as error:
        parser.error(str(error))
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
