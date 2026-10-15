"""Isolated country-pipeline helpers; no India config or release semantics."""
import gzip, hashlib, json, os
from pathlib import Path
SCHEMA_VERSION = 3

def config_path(): return Path(__file__).resolve().parents[2] / "config" / "countries" / "sri-lanka.json"
def load_country(path=None):
    try: data = json.loads(Path(path or config_path()).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error: raise ValueError(f"invalid country config: {error}") from error
    if not data.get("countryCode") or not data.get("countryName") or not data.get("packType"): raise ValueError("country config requires countryCode, countryName, and packType")
    packs = data.get("packs")
    required=data.get("requiredPackIds")
    if not isinstance(packs, list) or not isinstance(required,list): raise ValueError("country config requires packs and requiredPackIds")
    ids, codes, orders = set(), set(), set()
    for pack in packs:
        if not pack.get("id") or not pack.get("boundaryCode") or not isinstance(pack.get("displayOrder"),int): raise ValueError(f"invalid country pack identity: {pack}")
        if pack["id"] in ids or pack["boundaryCode"] in codes or pack["displayOrder"] in orders: raise ValueError("duplicate Sri Lanka pack id, boundary code, or display order")
        ids.add(pack["id"]); codes.add(pack["boundaryCode"]); orders.add(pack["displayOrder"])
    if {p["id"] for p in packs if p.get("enabled")} != set(required): raise ValueError("enabled pack IDs must match requiredPackIds")
    district_codes=[code for pack in packs if pack.get("enabled") for code in pack.get("districtCodes",[])]
    if (data.get("expectedDistrictCount") is not None and len(district_codes)!=data["expectedDistrictCount"]) or len(set(district_codes))!=len(district_codes) or any(not code.startswith(data["countryCode"]+"-") for code in district_codes): raise ValueError("configured district codes must have expected count, be unique, and country-prefixed")
    return data
def workspace(config):
    root = Path(os.path.expanduser(config["workspace"])).resolve()
    # Country outputs must never share the legacy India workspace or its children.
    india_root = Path(os.path.expanduser("~/localtell-osm-work")).resolve()
    countries_root = india_root / "countries"
    if root == countries_root or not root.is_relative_to(countries_root):
        raise ValueError("country workspace must be a child of the dedicated countries workspace")
    return root
def paths(config):
    root = workspace(config); return root, root/"source", root/"output", root/"release-test"
def safe_child(root, name):
    path = (root/name).resolve()
    if root.resolve() not in path.parents: raise ValueError("path escapes country workspace")
    return path
def enabled(config): return sorted((p for p in config["packs"] if p["enabled"]), key=lambda p:(p["displayOrder"],p["id"]))
def sha256(path):
    digest=hashlib.sha256()
    with open(path,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): digest.update(block)
    return digest.hexdigest()
def verify_gzip(raw, compressed):
    digest=hashlib.sha256()
    try:
        with gzip.open(compressed,"rb") as data:
            for block in iter(lambda:data.read(1024*1024),b""): digest.update(block)
    except OSError as error: raise ValueError(f"invalid gzip: {error}") from error
    if digest.hexdigest()!=sha256(raw): raise ValueError("gzip contents do not match raw DB")
def gzip_deterministic(source,target):
    with open(source,"rb") as raw, open(target,"wb") as out:
        with gzip.GzipFile(filename="",mode="wb",fileobj=out,compresslevel=9,mtime=0) as gz:
            for block in iter(lambda:raw.read(1024*1024),b""): gz.write(block)
