#!/usr/bin/env python3
import argparse, shutil
from state_tools import load_config, workspace_paths
def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--confirm", action="store_true"); parser.add_argument("--config"); args = parser.parse_args()
    root, *targets = workspace_paths(load_config(args.config)); root = root.resolve()
    for target in targets:
        target = target.resolve()
        if root not in target.parents or target == root: raise SystemExit(f"unsafe cleanup target: {target}")
        print(("REMOVE" if args.confirm else "WOULD REMOVE"), target)
        if args.confirm and target.exists(): shutil.rmtree(target)
if __name__ == "__main__": main()
