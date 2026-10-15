#!/usr/bin/env python3
import argparse, subprocess, sys
from pathlib import Path
from country_tools import enabled, load_country, paths
def main():
    args=argparse.ArgumentParser(); args.add_argument("--config"); args=args.parse_args(); config=load_country(args.config); _,_,output,_=paths(config); failed=[]; packs=enabled(config)
    for pack in packs:
        db=output/f"{pack['id']}.db"
        command=[sys.executable,str(Path(__file__).with_name("validate_country_pack.py")),str(db),"--id",pack["id"],"--name",pack["name"],"--version",str(pack["packVersion"]),"--boundary",pack["boundaryCode"],"--boundary-level",config["hierarchy"]["packBoundaryAdminLevel"],"--country-code",config["countryCode"],"--country-name",config["countryName"],"--pack-type",config["packType"],"--subdistrict-level", "" if config["hierarchy"].get("subDistrictAdminLevel") is None else str(config["hierarchy"]["subDistrictAdminLevel"])]+sum((["--district-code",code] for code in pack["districtCodes"]),[])
        result=subprocess.run(command) if db.exists() else None
        if result is None or result.returncode: failed.append(pack["id"])
    if failed: raise SystemExit(f"{config['countryName']} validation failed: {', '.join(failed)}")
    print(f"{config['countryName']} validation complete: {len(packs)}/{len(packs)} passed")
if __name__=="__main__": main()
