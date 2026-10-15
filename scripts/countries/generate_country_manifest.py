#!/usr/bin/env python3
import argparse, datetime, json, sqlite3
from country_tools import SCHEMA_VERSION, enabled, load_country, paths, sha256, verify_gzip
def main():
    args=argparse.ArgumentParser(); args.add_argument("--config"); args=args.parse_args(); config=load_country(args.config); _,_,output,release=paths(config); packs=enabled(config); entries=[]
    if [p["id"] for p in packs] != [p for p in config["requiredPackIds"]]: raise SystemExit("enabled packs do not match configured requiredPackIds")
    for pack in enabled(config):
        raw,gz=output/f"{pack['id']}.db",output/f"{pack['id']}.db.gz"
        if not raw.exists() or not gz.exists(): raise SystemExit(f"missing packaged asset: {pack['id']}")
        try: verify_gzip(raw,gz)
        except ValueError as error: raise SystemExit(f"invalid gzip asset {pack['id']}: {error}")
        meta=dict(sqlite3.connect(raw).execute("SELECT key,value FROM pack_meta"))
        expected={"schema_version":str(SCHEMA_VERSION),"pack_id":pack["id"],"pack_name":pack["name"],"pack_version":str(pack["packVersion"]),"country_code":config["countryCode"],"country_name":config["countryName"],"pack_type":config["packType"],"boundary_code":pack["boundaryCode"],"boundary_admin_level":config["hierarchy"]["packBoundaryAdminLevel"],"district_codes":",".join(sorted(pack["districtCodes"])),"subdistrict_admin_level":"" if config["hierarchy"].get("subDistrictAdminLevel") is None else str(config["hierarchy"]["subDistrictAdminLevel"])}
        if any(meta.get(key)!=value for key,value in expected.items()): raise SystemExit(f"DB metadata mismatch: {pack['id']}")
        entries.append({"id":pack["id"],"name":pack["name"],"adminCode":pack["boundaryCode"],"version":pack["packVersion"],"displayOrder":pack["displayOrder"],"downloadUrl":f"https://github.com/{config['release']['repository']}/releases/download/{config['release']['tag']}/{gz.name}","sha256":sha256(gz),"compressedBytes":gz.stat().st_size,"uncompressedBytes":raw.stat().st_size})
    release.mkdir(parents=True,exist_ok=True); out=release/config["release"]["manifestName"]
    generated=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    out.write_text(json.dumps({"schemaVersion":1,"countryCode":config["countryCode"],"countryName":config["countryName"],"packType":config["packType"],"generatedAt":generated,"packs":entries},indent=2)+"\n")
    print(out)
if __name__=="__main__": main()
