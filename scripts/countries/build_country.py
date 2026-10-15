#!/usr/bin/env python3
import argparse, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_country_geographic_pack import build_province, collect_country_features
from country_tools import enabled, load_country, paths, safe_child
from progress_logging import ProgressReporter
def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--force",action="store_true"); parser.add_argument("--progress",action="store_true"); parser.add_argument("--config"); args=parser.parse_args()
    config=load_country(args.config); _,source,output,_=paths(config); pbf=safe_child(source,config["source"]["fileName"]); packs=enabled(config)
    if not pbf.is_file(): parser.error(f"source PBF missing: {pbf}")
    targets=[output/f"{p['id']}.db" for p in packs]
    if not args.force and any(p.exists() for p in targets): parser.error("output exists; use --force")
    output.mkdir(parents=True,exist_ok=True)
    if args.force:
        for target in targets: target.unlink(missing_ok=True)
    started=time.monotonic(); reporter=ProgressReporter(args.progress, "sri-lanka")
    if args.progress:
        reporter.line(f"Sri Lanka build: packs={', '.join(p['id'] for p in packs)}; source={pbf}; count={len(packs)}")
    features, skipped=collect_country_features(pbf, reporter if args.progress else None)
    for index,pack in enumerate(packs,1):
        target=output/f"{pack['id']}.db"; pack_start=time.monotonic()
        if args.progress: reporter.line(f"[{index}/{len(packs)}] Building {pack['id']} — {pack['name']}")
        count=build_province(features,target,pack,config,reporter if args.progress else None)
        if args.progress: reporter.line(f"[{index}/{len(packs)}] Pack elapsed {time.monotonic()-pack_start:.1f}s")
        print(f"[{index}/{len(packs)}] {pack['id']}: places={count}, bytes={target.stat().st_size}")
    print(f"{config['countryName']} packs built: {len(packs)}/{len(packs)}; elapsed={time.monotonic()-started:.1f}s; skipped relation rings={skipped}")
if __name__=="__main__": main()
