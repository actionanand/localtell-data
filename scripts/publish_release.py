#!/usr/bin/env python3
"""Publish packaged schema-v3 assets. This script performs no action until invoked."""
import argparse, shutil, subprocess, sys
from pathlib import Path
from generate_manifest import manifest
from state_tools import RELEASE_TAG, REPOSITORY, enabled_packs, load_config, workspace_paths

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--config"); args = parser.parse_args()
    if not shutil.which("gh"): parser.error("GitHub CLI 'gh' is required")
    subprocess.run(["gh", "auth", "status"], check=True)
    config = load_config(args.config); data, details = manifest(config); output = workspace_paths(config)[2]; release_test = workspace_paths(config)[3]
    release_test.mkdir(parents=True, exist_ok=True); manifest_path = release_test / "manifest.json"
    import json; manifest_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    notes = ["# LocalTell geographic packs", "", "Schema version: 3", "", "Available packs:"]
    notes += [f"- {item['id']} — {item['name']}: {item['_places']} places, {item['_geometries']} geometries" for item in details]
    notes += ["", "Contains OpenStreetMap data © OpenStreetMap contributors, available under ODbL."]
    notes_path = release_test / "release-notes.md"; notes_path.write_text("\n".join(notes) + "\n", encoding="utf-8")
    assets = [str(output / f"{pack['id']}.db.gz") for pack in enabled_packs(config)] + [str(manifest_path)]
    subprocess.run(["gh", "release", "view", RELEASE_TAG, "--repo", REPOSITORY], check=True)
    subprocess.run(["gh", "release", "upload", RELEASE_TAG, *assets, "--clobber", "--repo", REPOSITORY], check=True)
    subprocess.run(["gh", "release", "edit", RELEASE_TAG, "--latest", "--notes-file", str(notes_path), "--repo", REPOSITORY], check=True)

if __name__ == "__main__": main()
