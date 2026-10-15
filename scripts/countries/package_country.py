#!/usr/bin/env python3
import argparse, gzip, subprocess, sys
from pathlib import Path
from country_tools import enabled, gzip_deterministic, load_country, paths, sha256, verify_gzip
def main():
    args=argparse.ArgumentParser(); args.add_argument("--config"); args=args.parse_args(); config=load_country(args.config); _,_,output,_=paths(config)
    for pack in enabled(config):
        raw=output/f"{pack['id']}.db"; gz=output/f"{pack['id']}.db.gz"
        if not raw.exists(): raise SystemExit(f"missing DB: {raw}")
        command=[sys.executable,str(Path(__file__).with_name("validate_country_pack.py")),str(raw),"--id",pack["id"],"--name",pack["name"],"--version",str(pack["packVersion"]),"--boundary",pack["boundaryCode"],"--boundary-level",config["hierarchy"]["packBoundaryAdminLevel"],"--country-code",config["countryCode"],"--country-name",config["countryName"],"--pack-type",config["packType"],"--subdistrict-level", "" if config["hierarchy"].get("subDistrictAdminLevel") is None else str(config["hierarchy"]["subDistrictAdminLevel"])]+sum((["--district-code",code] for code in pack["districtCodes"]),[])
        subprocess.run(command,check=True)
        gzip_deterministic(raw,gz)
        try: verify_gzip(raw,gz)
        except ValueError as error: raise SystemExit(f"gzip verification failed: {pack['id']}: {error}")
        print(f"{pack['id']}: raw={raw.stat().st_size} gzip={gz.stat().st_size} gzip_sha256={sha256(gz)}")
if __name__=="__main__": main()
