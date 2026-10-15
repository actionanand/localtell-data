#!/usr/bin/env python3
import argparse
from country_tools import enabled, load_country, paths, safe_child
from build_country_geographic_pack import collect_country_features
from build_geographic_pack import interior_point, point_in_feature

def usable(feature): return bool(feature.get("name") and feature.get("rings"))
def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--config"); args=parser.parse_args(); config=load_country(args.config)
    _,source,_,_=paths(config); pbf=safe_child(source,config["source"]["fileName"])
    if not pbf.is_file(): raise SystemExit(f"source PBF missing: {pbf}")
    features,_=collect_country_features(pbf); levels=config["hierarchy"]; packs=enabled(config)
    province_level,district_level=levels["packBoundaryAdminLevel"],levels["districtAdminLevel"]
    provinces=[f for f in features if f["place_type"]=="administrative_boundary" and f.get("admin_level")==province_level]
    districts=[f for f in features if f["place_type"]=="administrative_boundary" and f.get("admin_level")==district_level]
    missing_p=[]; duplicate_p=[]; unusable_p=[]; missing_d=[]; duplicate_d=[]; unusable_d=[]; misplaced=[]
    expected_p={p["boundaryCode"] for p in packs}; expected_d={code for p in packs for code in p["districtCodes"]}
    for pack in packs:
        matches=[f for f in provinces if f.get("iso")==pack["boundaryCode"]]
        if not matches: missing_p.append(pack["boundaryCode"]); continue
        if len(matches)!=1: duplicate_p.append(pack["boundaryCode"]); continue
        province=matches[0]
        if not usable(province): unusable_p.append(pack["boundaryCode"]); continue
        for code in pack["districtCodes"]:
            found=[f for f in districts if f.get("iso")==code]
            if not found: missing_d.append(code); continue
            if len(found)!=1: duplicate_d.append(code); continue
            district=found[0]
            if not usable(district): unusable_d.append(code); continue
            point=interior_point(district["rings"][0])
            if not point or not point_in_feature(point,province): misplaced.append(code)
    unrelated4=[f"{f.get('iso') or '<none>'} / {f.get('name') or '<unnamed>'}" for f in provinces if f.get("iso") not in expected_p]
    unrelated5=[f"{f.get('iso') or '<none>'} / {f.get('name') or '<unnamed>'}" for f in districts if f.get("iso") not in expected_d]
    usable_p_count=len(expected_p)-len(missing_p)-len(duplicate_p)-len(unusable_p)
    usable_d_count=len(expected_d)-len(missing_d)-len(duplicate_d)-len(unusable_d)-len(misplaced)
    print(f"Expected {config['countryName']} provinces usable: {usable_p_count}/{len(expected_p)}\nExpected {config['countryName']} districts usable: {usable_d_count}/{len(expected_d)}\nmissing provinces: {missing_p}\nduplicate provinces: {duplicate_p}\nunusable provinces: {unusable_p}\nmissing districts: {missing_d}\nduplicate districts: {duplicate_d}\nunusable districts: {unusable_d}\nmisplaced districts: {misplaced}\nwarning unrelated level-4: {unrelated4}\nwarning unrelated level-5: {unrelated5}")
    print("subdistrict hierarchy: disabled / unavailable" if levels.get("subDistrictAdminLevel") is None else f"subdistrict hierarchy: admin_level {levels['subDistrictAdminLevel']}")
    if any((missing_p,duplicate_p,unusable_p,missing_d,duplicate_d,unusable_d,misplaced)): raise SystemExit(f"{config['countryName']} boundary inspection failed")
if __name__=="__main__": main()
