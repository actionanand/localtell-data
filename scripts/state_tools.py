"""Shared, Python-only helpers for state-pack automation."""
import gzip
import hashlib
import json
import os
from pathlib import Path

REPOSITORY = "actionanand/localtell-data"
RELEASE_TAG = "cell-data-v3"
MANIFEST_SCHEMA_VERSION = 2


def repo_root():
    return Path(__file__).resolve().parents[1]


def load_config(path=None):
    path = Path(path or repo_root() / "config" / "india-packs.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid pack configuration {path}: {error}") from error
    if not isinstance(data.get("packs"), list) or not isinstance(data.get("sources"), dict):
        raise ValueError("config must contain object 'sources' and array 'packs'")
    ids, codes, region_orders = set(), set(), set()
    for pack in data["packs"]:
        required = ("id", "name", "stateCode", "region", "displayOrder", "source", "packVersion", "enabled")
        if not isinstance(pack, dict) or any(key not in pack for key in required):
            raise ValueError("each pack must include id, name, stateCode, region, displayOrder, source, packVersion, enabled")
        if pack["id"] in ids: raise ValueError(f"duplicate pack id: {pack['id']}")
        if pack["stateCode"] in codes: raise ValueError(f"duplicate state code: {pack['stateCode']}")
        if pack["source"] not in data["sources"]: raise ValueError(f"unknown source {pack['source']} for {pack['id']}")
        if not isinstance(pack["region"], str) or not pack["region"].strip() or pack["region"] != pack["region"].strip(): raise ValueError(f"invalid region for {pack['id']}")
        if not isinstance(pack["displayOrder"], int) or isinstance(pack["displayOrder"], bool) or pack["displayOrder"] <= 0: raise ValueError(f"invalid displayOrder for {pack['id']}")
        if (pack["region"], pack["displayOrder"]) in region_orders: raise ValueError(f"duplicate displayOrder {pack['displayOrder']} in region {pack['region']}")
        ids.add(pack["id"]); codes.add(pack["stateCode"])
        region_orders.add((pack["region"], pack["displayOrder"]))
    return data


def workspace(config):
    return Path(os.path.expanduser(config.get("workspace", "~/localtell-osm-work"))).resolve()


def workspace_paths(config):
    root = workspace(config)
    return root, root / "source", root / "output", root / "release-test"


def source_path(config, pack):
    relative = Path(config["sources"][pack["source"]])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"unsafe source path for {pack['source']}")
    return workspace(config) / relative


def find_pack(config, pack_id):
    for pack in config["packs"]:
        if pack["id"] == pack_id:
            return pack
    raise ValueError(f"unknown pack id: {pack_id}")


def enabled_packs(config, region=None):
    return sorted((pack for pack in config["packs"] if pack["enabled"] and (region is None or pack["region"] == region)), key=lambda pack: (pack["region"], pack["displayOrder"], pack["id"]))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""): digest.update(block)
    return digest.hexdigest()


def gzip_deterministic(source, target):
    with open(source, "rb") as raw, open(target, "wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
            for block in iter(lambda: raw.read(1024 * 1024), b""): compressed.write(block)


def gzip_matches(source, compressed):
    digest = hashlib.sha256()
    with gzip.open(compressed, "rb") as archive:
        for block in iter(lambda: archive.read(1024 * 1024), b""): digest.update(block)
    return digest.hexdigest() == sha256(source)
