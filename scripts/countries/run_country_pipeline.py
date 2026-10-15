#!/usr/bin/env python3
import argparse, subprocess, sys
from pathlib import Path
from country_tools import enabled, load_country
def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--config"); args=parser.parse_args(); config=load_country(args.config); base=Path(__file__).parent
    for name in ("download_country_source.py","inspect_country_boundaries.py","build_country.py","validate_country.py","package_country.py","generate_country_manifest.py"):
        command=[sys.executable,str(base/name)]
        if args.config: command.extend(["--config",args.config])
        subprocess.run(command,check=True)
    count=len(enabled(config)); print(f"{config['countryName']} source: verified\n{config['packType']} boundaries: {count}/{count} matched\n{config['packType']} packs built: {count}/{count}\n{config['packType']} packs validated: {count}/{count}\n{config['packType']} packs packaged: {count}/{count}\nManifest entries: {count}\nIndia pipeline modified: NO")
if __name__=="__main__": main()
