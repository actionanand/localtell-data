#!/usr/bin/env python3
"""Build enabled regional packs, parsing each configured PBF source once."""
import argparse
from collections import defaultdict
from pathlib import Path

from build_geographic_pack import build_pack_from_features, collect_features
from progress_logging import ProgressReporter
from state_tools import enabled_packs, load_config, source_path, workspace_paths


def group_by_source(packs):
    groups = defaultdict(list)
    for pack in packs:
        groups[pack["source"]].append(pack)
    return {source: sorted(group, key=lambda pack: (pack["displayOrder"], pack["id"])) for source, group in groups.items()}


def build_region(config, region, force=False, progress=False, collector=collect_features, builder=build_pack_from_features, reporter_factory=ProgressReporter):
    packs = enabled_packs(config, None if region == "all" else region)
    if not packs:
        raise ValueError(f"no enabled packs for region {region}")
    _, _, output, _ = workspace_paths(config)
    targets = [(pack, output / f"{pack['id']}.db") for pack in packs]
    existing = [str(path) for _, path in targets if path.exists()]
    if existing and not force:
        raise ValueError(f"output already exists; use --force to replace: {', '.join(existing)}")
    groups = group_by_source(packs)
    sources = {source: source_path(config, group[0]) for source, group in groups.items()}
    missing = [str(path) for path in sources.values() if not path.is_file()]
    if missing:
        raise ValueError(f"source PBF missing: {', '.join(missing)}")
    output.mkdir(parents=True, exist_ok=True)
    if force:
        for _, path in targets:
            if path.exists(): path.unlink()
    total_start = __import__("time").monotonic()
    if progress:
        print(f"Region requested: {region}", flush=True)
        pack_summary = ", ".join(f"{pack['id']} — {pack['name']}" for pack in packs)
        print(f"Packs ({len(packs)}): {pack_summary}", flush=True)
    for source, group in groups.items():
        source_reporter = reporter_factory(progress, source)
        source_reporter.line(f"[{source}] Source PBF: {sources[source]} ({sources[source].stat().st_size} bytes); packs={len(group)}")
        print(f"Collecting {source} once for: {', '.join(pack['id'] for pack in group)}", flush=True)
        features, skipped = collector(sources[source], source_reporter)
        for index, pack in enumerate(group, 1):
            target = output / f"{pack['id']}.db"
            pack_reporter = reporter_factory(progress, pack["id"])
            pack_reporter.line(f"[{index}/{len(group)}] Building {pack['id']} — {pack['name']}")
            count = builder(features, target, pack["id"], pack["name"], pack["stateCode"], pack["packVersion"], progress=pack_reporter)
            pack_reporter.line(f"[{pack['id']}] Pack complete; retained features={count}")
            print(f"Built {target}: {count} places; skipped relation rings={skipped}", flush=True)
    if progress: print(f"Regional build complete: packs={len(packs)}, unique PBF sources={len(groups)}, elapsed={__import__('time').monotonic()-total_start:.1f}s", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("region"); parser.add_argument("--force", action="store_true"); parser.add_argument("--progress", action="store_true"); parser.add_argument("--config")
    args = parser.parse_args()
    try:
        build_region(load_config(args.config), args.region, args.force, args.progress)
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
