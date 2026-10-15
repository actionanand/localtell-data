#!/usr/bin/env python3
import argparse, hashlib, os, re, sys, urllib.request
from pathlib import Path
from country_tools import load_country, paths, safe_child
def md5sum(path):
    digest=hashlib.md5()
    with open(path,"rb") as data:
        for block in iter(lambda:data.read(1024*1024),b""): digest.update(block)
    return digest.hexdigest()
def expected_md5(path):
    tokens=path.read_text(encoding="utf-8").split()
    if not tokens or not re.fullmatch(r"[0-9a-fA-F]{32}",tokens[0]):
        raise ValueError("invalid MD5 checksum file")
    return tokens[0].lower()
def fetch(url,target,finalize=True):
    part=Path(str(target)+".part")
    try:
        with urllib.request.urlopen(url) as response, open(part,"wb") as out:
            for block in iter(lambda:response.read(1024*1024),b""): out.write(block)
        if finalize: os.replace(part,target)
        return part
    except Exception:
        part.unlink(missing_ok=True); raise
def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--force",action="store_true"); parser.add_argument("--config"); args=parser.parse_args()
    config=load_country(args.config); _,source,_,_=paths(config); source.mkdir(parents=True,exist_ok=True)
    pbf=safe_child(source,config["source"]["fileName"]); md5=safe_child(source,config["source"]["checksumFileName"])
    if pbf.exists() and md5.exists() and not args.force:
        expected=expected_md5(md5); actual=md5sum(pbf)
        if actual == expected: print(f"Verified existing source: {pbf}"); return
        print("Existing source checksum mismatch; downloading a fresh copy.")
    fetch(config["source"]["checksumUrl"],md5); expected=expected_md5(md5)
    part=fetch(config["source"]["url"],pbf,finalize=False)
    actual=md5sum(part)
    if actual != expected: part.unlink(missing_ok=True); raise SystemExit("MD5 checksum mismatch")
    os.replace(part,pbf)
    print(f"Downloaded and verified: {pbf}")
if __name__=="__main__": main()
