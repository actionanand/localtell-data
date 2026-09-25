#!/usr/bin/env python3

import csv
import json
import os
import subprocess
import sys
import time
import urllib.parse
from collections import Counter

API_KEY = os.getenv("OPENCELLID_KEY")

if not API_KEY:
    print("OPENCELLID_KEY is not set")
    sys.exit(1)

CENTER_LAT = 8.18
CENTER_LON = 77.34

# ~10–11 km total scan
HALF_SPAN = 0.05

# ~1.7 km per side, safely below 4 km²
TILE_SIZE = 0.016

WANTED_RADIOS = {"LTE", "NR"}

BASE_URL = "https://opencellid.org/cell/getInArea"

min_lat = CENTER_LAT - HALF_SPAN
max_lat = CENTER_LAT + HALF_SPAN
min_lon = CENTER_LON - HALF_SPAN
max_lon = CENTER_LON + HALF_SPAN

cells = {}
request_count = 0
failed_count = 0

lat = min_lat

while lat < max_lat:
    lon = min_lon

    while lon < max_lon:
        north = min(lat + TILE_SIZE, max_lat)
        east = min(lon + TILE_SIZE, max_lon)

        bbox = f"{lat:.6f},{lon:.6f},{north:.6f},{east:.6f}"

        params = {
            "key": API_KEY,
            "BBOX": bbox,
            "format": "json",
            "limit": 50,
        }

        url = BASE_URL + "?" + urllib.parse.urlencode(params)

        request_count += 1

        result = subprocess.run(
            [
                "curl",
                "-sS",
                "--fail-with-body",
                "--max-time",
                "30",
                url,
            ],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            failed_count += 1
            print(
                f"ERROR {bbox}: "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
            lon += TILE_SIZE
            time.sleep(0.5)
            continue

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            failed_count += 1
            print(f"INVALID JSON {bbox}: {result.stdout[:200]}")
            lon += TILE_SIZE
            time.sleep(0.5)
            continue

        modern = [
            cell
            for cell in data.get("cells", [])
            if str(cell.get("radio", "")).upper() in WANTED_RADIOS
        ]

        if modern:
            print(f"{bbox}: {len(modern)} LTE/NR")

        for cell in modern:
            key = (
                cell.get("mcc"),
                cell.get("mnc"),
                cell.get("radio"),
                cell.get("lac"),
                cell.get("cellid"),
            )
            cells[key] = cell

        lon += TILE_SIZE

        # Be polite to the API.
        time.sleep(0.5)

    lat += TILE_SIZE


print()
print(f"Requests made: {request_count}")
print(f"Failed requests: {failed_count}")
print(f"Unique LTE/NR cells found: {len(cells)}")

radio_counts = Counter()
network_counts = Counter()

for cell in cells.values():
    radio = cell.get("radio")
    radio_counts[radio] += 1
    network_counts[
        (cell.get("mcc"), cell.get("mnc"), radio)
    ] += 1

print("\nBy radio:")
for radio, count in sorted(radio_counts.items()):
    print(f"  {radio}: {count}")

print("\nBy network:")
for (mcc, mnc, radio), count in sorted(network_counts.items()):
    print(f"  {mcc}-{mnc} {radio}: {count}")


output = "work/opencellid-modern-nearby.csv"

os.makedirs("work", exist_ok=True)

with open(output, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)

    writer.writerow([
        "mcc",
        "mnc",
        "radio",
        "lac",
        "cellid",
        "lat",
        "lon",
        "range",
        "samples",
    ])

    for cell in sorted(
        cells.values(),
        key=lambda c: (
            c.get("mcc", 0),
            c.get("mnc", 0),
            c.get("radio", ""),
            c.get("cellid", 0),
        ),
    ):
        writer.writerow([
            cell.get("mcc"),
            cell.get("mnc"),
            cell.get("radio"),
            cell.get("lac"),
            cell.get("cellid"),
            cell.get("lat"),
            cell.get("lon"),
            cell.get("range"),
            cell.get("samples"),
        ])

print(f"\nSaved: {output}")