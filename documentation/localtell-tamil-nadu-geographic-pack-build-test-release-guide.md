# LocalTell Tamil Nadu Geographic Pack — Build, Test & Release Guide

This is the end-to-end operational guide for generating the **Tamil Nadu schema-v3 geographic pack** for LocalTell, validating it, testing it, compressing it, generating `manifest.json`, publishing it through GitHub Releases, and verifying the published asset.

Repository:

```text
https://github.com/actionanand/localtell-data
```

Related documentation:

```text
documentation/localtell-osm-python-environment-setup.md
documentation/localtell-osm-map-data-download-and-build-guide.md
```

---

## 1. End-to-end flow

```text
Geofabrik Southern Zone OSM PBF
        ↓
provider MD5 verification
        ↓
LocalTell schema-v3 builder
        ↓
TN.db
        ↓
schema + locality + border validation
        ↓
raw TN.db SHA-256
        ↓
deterministic gzip
        ↓
TN.db.gz
        ↓
compressed SHA-256
        ↓
manifest.json
        ↓
GitHub Release
        ↓
re-download + verify
        ↓
Android offline test
```

LocalTell schema v3 resolves the phone's GNSS coordinate against offline geographic data. It does **not** require a continuously maintained all-India Cell-ID → locality database.

---

## 2. Important version distinction

These are separate concepts:

```text
manifest.json schemaVersion
    = JSON manifest format version

TN.db pack_meta.schema_version
    = SQLite database schema version

pack version
    = downloadable pack update version
```

For the first working Tamil Nadu V3 release:

```text
manifest.json schemaVersion = 2
TN.db schema_version         = 3
pack version                 = 3
GitHub tag                   = cell-data-v3
```

Do not automatically make the manifest schema equal to the SQLite schema.

---

## 3. Prerequisites

Open the repository:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

Activate the Conda environment:

```bash
conda activate wsl2
```

Verify:

```bash
python --version
python -c "import osmium; print('pyosmium OK')"
```

Run tests:

```bash
python -m unittest discover -s tests -v
```

Compile-check scripts:

```bash
python -m py_compile scripts/*.py
```

Check Git state:

```bash
git status
```

---

## 4. Check disk and memory

WSL2 can report a logical virtual disk larger than the real Windows physical disk.

```bash
df -h ~
df -h /mnt/c
free -h
```

Interpretation:

```text
df -h ~      → WSL virtual filesystem
df -h /mnt/c → Windows C: filesystem
free -h      → RAM and swap
```

Prefer the native WSL filesystem for the large PBF and generated databases.

---

## 5. Create working folders

```bash
mkdir -p ~/localtell-osm-work/source
mkdir -p ~/localtell-osm-work/output
```

Recommended structure:

```text
~/localtell-osm-work/
├── source/
│   ├── southern-zone-latest.osm.pbf
│   └── southern-zone-latest.osm.pbf.md5
├── output/
│   ├── TN.db
│   ├── TN.db.sha256
│   ├── TN.db.gz
│   ├── TN.db.gz.sha256
│   ├── manifest.json
│   ├── TN-build.log
│   └── release-notes-v3.md
└── release-test/
    └── TN.db.gz
```

---

## 6. Download OpenStreetMap source

```bash
curl -L --fail --retry 3 -C - \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
```

Check:

```bash
ls -lh ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

The first successful build used a source of roughly 532 MB. The exact size changes as OSM changes.

---

## 7. Download and verify the provider MD5

```bash
curl -L --fail \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5
```

Verify:

```bash
cd ~/localtell-osm-work/source
md5sum -c southern-zone-latest.osm.pbf.md5
```

Expected:

```text
southern-zone-latest.osm.pbf: OK
```

Return to the repository:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

Do not build from a PBF whose checksum fails.

### Why MD5 here?

The provider MD5 answers:

> Did the large downloaded OSM file arrive intact and match the provider's file?

It is a source-download integrity check. LocalTell release assets use SHA-256 later.

---

## 8. Build `TN.db`

Remove any older candidate:

```bash
rm -f ~/localtell-osm-work/output/TN.db
```

Build and save the log:

```bash
{ time python scripts/build_geographic_pack.py \
  --pbf ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  --output ~/localtell-osm-work/output/TN.db \
  --pack-id TN \
  --pack-name "Tamil Nadu" \
  --version 3 \
  --state-code IN-TN; } 2>&1 | tee ~/localtell-osm-work/output/TN-build.log
```

Current builder options include:

```text
--pbf
--output
--pack-id
--pack-name
--version
--state-code
--simplify-tolerance
```

Default simplification tolerance:

```text
0.00015 degrees
roughly 17 m
```

The builder writes:

```text
pack_meta.schema_version = 3
```

---

## 9. How Tamil Nadu is selected

The Southern Zone extract contains multiple states. The builder identifies Tamil Nadu with:

```text
boundary=administrative
admin_level=4
ISO3166-2=IN-TN
```

India hierarchy used by the builder:

```text
admin_level 4 → State / Union Territory
admin_level 5 → District
admin_level 6 → Taluk / Subdistrict / Tehsil
```

Flow:

```text
Southern Zone PBF
        ↓
find Tamil Nadu level-4 boundary
        ↓
filter to IN-TN
        ↓
extract places + hierarchy
        ↓
simplify geometry
        ↓
build SQLite + RTree
        ↓
TN.db
```

---

## 10. User-facing locality types

The geographic resolver recognizes:

```text
neighbourhood
suburb
locality
hamlet
village
town
city
```

Priority:

```text
1. neighbourhood
2. suburb
3. locality
4. hamlet
5. village
6. town
7. city
```

Administrative boundaries are stored for pack extent/hierarchy but are not returned as the user's locality.

---

## 11. Inspect the generated DB

```bash
ls -lh ~/localtell-osm-work/output/TN.db
du -h ~/localtell-osm-work/output/TN.db
```

Known-good first V3 build:

```text
TN.db: 5,976,064 bytes (~5.7 MB)
places: 22,692
build time: about 7m 35s
```

These are reference values only.

---

## 12. Validate schema v3

```bash
python scripts/validate_geographic_pack.py \
  ~/localtell-osm-work/output/TN.db \
  --expected-state-code IN-TN \
  --expected-pack-id TN
```

Known-good result:

```text
VALID: schema-v3, 990 geometry rows, 22692 places
```

Do not publish if validation fails.

---

## 13. Inspect pack contents

```bash
python - <<'PY'
import sqlite3
from pathlib import Path

db = Path.home() / "localtell-osm-work/output/TN.db"
con = sqlite3.connect(db)
cur = con.cursor()

print("PACK META")
for k, v in cur.execute("SELECT key, value FROM pack_meta ORDER BY key"):
    print(f"{k}: {v}")

print("\nPLACE TYPES")
for kind, count in cur.execute(
    "SELECT place_type, COUNT(*) FROM place "
    "GROUP BY place_type ORDER BY COUNT(*) DESC"
):
    print(f"{kind}: {count}")

print("\nADMIN LEVELS")
for level, count in cur.execute(
    "SELECT COALESCE(admin_level, 'NULL'), COUNT(*) FROM place "
    "GROUP BY admin_level ORDER BY admin_level"
):
    print(f"{level}: {count}")

print("\nCOUNTS")
print("places:", cur.execute("SELECT COUNT(*) FROM place").fetchone()[0])
print("geometries:", cur.execute("SELECT COUNT(*) FROM place_geometry").fetchone()[0])
print("rtree:", cur.execute("SELECT COUNT(*) FROM place_geometry_rtree").fetchone()[0])

con.close()
PY
```

First V3 reference:

```text
village: 12291
hamlet: 7611
suburb: 979
neighbourhood: 759
town: 417
administrative_boundary: 326
locality: 285
city: 24

places: 22692
geometries: 990
rtree: 990
```

---

## 14. Basic locality lookup

General form:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat LATITUDE \
  --lon LONGITUDE
```

Use actual numeric coordinates. Do not type literal `YOUR_LAT` / `YOUR_LON`.

---

## 15. Known-area regression test

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.181910 \
  --lon 77.352330
```

First V3 result:

```text
name: Koduppaikuzhi
place_type: village
sub_district: Kalkulam
district: Kanniyakumari
state: Tamil Nadu
state_code: IN-TN
resolution_method: nearest_place_fallback
distance_metres: 56
```

---

## 16. Geographic-variety tests

```bash
DB=~/localtell-osm-work/output/TN.db

echo "===== NAGERCOIL ====="
python scripts/test_locality_lookup.py "$DB" --lat 8.1833 --lon 77.4119

echo
echo "===== MADURAI ====="
python scripts/test_locality_lookup.py "$DB" --lat 9.9252 --lon 78.1198

echo
echo "===== COIMBATORE ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.0168 --lon 76.9558

echo
echo "===== CHENNAI ====="
python scripts/test_locality_lookup.py "$DB" --lat 13.0827 --lon 80.2707

echo
echo "===== OOTY / NILGIRIS ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.4064 --lon 76.6932

echo
echo "===== KODAIKANAL ====="
python scripts/test_locality_lookup.py "$DB" --lat 10.2381 --lon 77.4892

echo
echo "===== RAMESWARAM ====="
python scripts/test_locality_lookup.py "$DB" --lat 9.2876 --lon 79.3129

echo
echo "===== TIRUNELVELI ====="
python scripts/test_locality_lookup.py "$DB" --lat 8.7139 --lon 77.7567

echo
echo "===== VELLORE ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.9165 --lon 79.1325

echo
echo "===== CUDDALORE ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.7447 --lon 79.7680
```

Review:

```text
name
place_type
sub_district
district
state
state_code
resolution_method
distance_metres
```

A suburb/neighbourhood can be a valid result instead of the larger city name.

---

## 17. Polygon vs nearest fallback

Possible:

```text
resolution_method: polygon
```

or:

```text
resolution_method: nearest_place_fallback
```

Nearest fallback is normal because many OSM settlements are points rather than complete polygons.

Useful review guideline:

```text
0–500 m       excellent
500 m–1 km    generally reasonable
1–3 km        inspect manually
>3 km         investigate carefully
```

These are practical review guidelines, not strict correctness rules.

---

## 18. Mandatory outside-state test

Kerala example:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.5241 \
  --lon 76.9366
```

Expected:

```text
resolution_method: outside_pack
```

A Tamil Nadu pack must not return a nearby Tamil Nadu settlement for a coordinate outside the state.

---

## 19. Border tests

### Kanyakumari ↔ Kerala

Tamil Nadu:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.32278 \
  --lon 77.15389
```

Kerala:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.34290 \
  --lon 77.15478
```

Additional Kerala-side test:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.38950 \
  --lon 77.17287
```

### Coimbatore ↔ Kerala

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 10.89068 \
  --lon 76.90829
```

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 10.84350 \
  --lon 76.83911
```

### Hosur ↔ Karnataka

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 12.76840 \
  --lon 77.79143
```

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 12.77826 \
  --lon 77.77128
```

### Thiruvallur ↔ Andhra Pradesh

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 13.54257 \
  --lon 80.06960
```

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 13.58960 \
  --lon 80.03290
```

All non-Tamil-Nadu points should return:

```text
resolution_method: outside_pack
```

---

## 20. Release gate

Before compression/publication, verify:

```text
PBF MD5 passes
        ↓
build succeeds
        ↓
validator passes
        ↓
known-area lookup passes
        ↓
geographic variety tests are sensible
        ↓
outside-state test passes
        ↓
Kerala/Karnataka/Andhra border tests pass
        ↓
candidate accepted
```

Once accepted, release the exact database that was tested.

---

## 21. Save the raw DB SHA-256

```bash
sha256sum ~/localtell-osm-work/output/TN.db \
  > ~/localtell-osm-work/output/TN.db.sha256
```

View:

```bash
cat ~/localtell-osm-work/output/TN.db.sha256
```

First V3 raw DB SHA-256:

```text
5dbb2fb3fb09b7650e97a49df8575b7ad37d77781b156367aa3fcdbb48b99a44
```

### Why SHA-256?

SHA-256 identifies the exact file that was tested/released.

Two hashes matter:

```text
TN.db SHA-256
→ validated uncompressed DB

TN.db.gz SHA-256
→ downloadable release asset
```

They are expected to differ.

---

## 22. Create deterministic gzip

```bash
gzip -n -9 -c ~/localtell-osm-work/output/TN.db \
  > ~/localtell-osm-work/output/TN.db.gz
```

Options:

```text
-n  omit original filename/timestamp metadata
-9  maximum compression
-c  write output to stdout
```

Check:

```bash
ls -lh \
  ~/localtell-osm-work/output/TN.db \
  ~/localtell-osm-work/output/TN.db.gz
```

First V3:

```text
TN.db     ~5.7 MB
TN.db.gz  ~1.9 MB
```

---

## 23. Verify gzip integrity

```bash
gzip -t ~/localtell-osm-work/output/TN.db.gz && echo "GZIP OK"
```

Expected:

```text
GZIP OK
```

---

## 24. Calculate the compressed SHA-256

```bash
sha256sum ~/localtell-osm-work/output/TN.db.gz \
  | tee ~/localtell-osm-work/output/TN.db.gz.sha256
```

First V3 compressed SHA-256:

```text
cd4829bec836159899c06428462b7683fda55a10b2003a20800bc8c8788df588
```

This is the checksum that belongs in `manifest.json`.

---

## 25. Prove gzip returns the exact validated DB

```bash
gzip -dc ~/localtell-osm-work/output/TN.db.gz | sha256sum
```

First V3 expected:

```text
5dbb2fb3fb09b7650e97a49df8575b7ad37d77781b156367aa3fcdbb48b99a44  -
```

This proves the compressed asset contains the exact validated DB.

---

## 26. Generate `manifest.json`

```bash
OUT=~/localtell-osm-work/output
TAG=cell-data-v3

COMPRESSED_SHA=$(sha256sum "$OUT/TN.db.gz" | awk '{print $1}')
COMPRESSED_BYTES=$(stat -c%s "$OUT/TN.db.gz")
UNCOMPRESSED_BYTES=$(stat -c%s "$OUT/TN.db")
GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$OUT/manifest.json" <<EOF
{
  "schemaVersion": 2,
  "generatedAt": "$GENERATED_AT",
  "packs": [
    {
      "id": "TN",
      "name": "Tamil Nadu",
      "version": 3,
      "downloadUrl": "https://github.com/actionanand/localtell-data/releases/download/$TAG/TN.db.gz",
      "sha256": "$COMPRESSED_SHA",
      "compressedBytes": $COMPRESSED_BYTES,
      "uncompressedBytes": $UNCOMPRESSED_BYTES
    }
  ]
}
EOF
```

Inspect:

```bash
cat "$OUT/manifest.json"
```

First V3 reference:

```text
compressedBytes: 1988105
uncompressedBytes: 5976064
sha256: cd4829bec836159899c06428462b7683fda55a10b2003a20800bc8c8788df588
```

---

## 27. Validate manifest syntax

```bash
python -m json.tool "$OUT/manifest.json"
```

Any malformed JSON fails here.

---

## 28. Validate manifest values

```bash
python - <<'PY'
import hashlib
import json
from pathlib import Path

out = Path.home() / "localtell-osm-work/output"

manifest = json.loads((out / "manifest.json").read_text())
pack = manifest["packs"][0]

assert manifest["schemaVersion"] == 2
assert pack["id"] == "TN"
assert pack["name"] == "Tamil Nadu"
assert pack["version"] == 3

compressed = out / "TN.db.gz"
uncompressed = out / "TN.db"

h = hashlib.sha256()
with compressed.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)

assert pack["sha256"] == h.hexdigest()
assert pack["compressedBytes"] == compressed.stat().st_size
assert pack["uncompressedBytes"] == uncompressed.stat().st_size

print("Manifest validation: OK")
print("Compressed SHA-256:", h.hexdigest())
print("Compressed bytes:", compressed.stat().st_size)
print("Uncompressed bytes:", uncompressed.stat().st_size)
PY
```

Expected:

```text
Manifest validation: OK
```

---

## 29. Prepare release notes

```bash
cat > ~/localtell-osm-work/output/release-notes-v3.md <<'EOF'
## LocalTell Geographic Data v3

Introduces the first schema-v3 geographic locality pack for Tamil Nadu.

### What's new

- GNSS-coordinate-based offline locality resolution
- Tamil Nadu geographic coverage derived from OpenStreetMap data
- Level-4 Tamil Nadu state-boundary validation
- Settlement polygon lookup
- Nearest named settlement fallback
- District and sub-district hierarchy
- SQLite RTree spatial indexing
- No dependency on maintaining Cell ID → locality mappings

### Tamil Nadu pack

- Pack: `TN`
- Database schema: `3`
- Places: 22,692
- Geometry rows: 990
- Uncompressed size: about 5.7 MB
- Compressed size: about 1.9 MB

The pack was validated against locations across Tamil Nadu and state-border checks with Kerala, Karnataka, and Andhra Pradesh.

Locality resolution is performed entirely on-device after the pack is installed.

Data source includes OpenStreetMap data.

© OpenStreetMap contributors.
EOF
```

Inspect before publication:

```bash
cat ~/localtell-osm-work/output/release-notes-v3.md
```

Update counts and sizes for future releases.

---

## 30. Files to upload to GitHub Releases

Upload only:

```text
manifest.json
TN.db.gz
```

Normally do not upload:

```text
TN.db
TN.db.sha256
TN.db.gz.sha256
TN-build.log
release-notes-v3.md
```

Those are local build/verification artifacts.

---

## 31. Publish the GitHub Release

Open:

```text
https://github.com/actionanand/localtell-data/releases/new
```

First V3 values:

```text
Tag:           cell-data-v3
Target:        master
Release title: LocalTell Geographic Data v3
Release label: Latest
```

Do not mark it as `Pre-release` if the app should consume it using the `/releases/latest/` URL.

Attach:

```text
manifest.json
TN.db.gz
```

Paste the reviewed release notes and publish.

---

## 32. Why “Latest” matters

LocalTell loads:

```text
https://github.com/actionanand/localtell-data/releases/latest/download/manifest.json
```

Therefore the active data release must be GitHub's **Latest** release.

---

## 33. Optional GitHub CLI release

GitHub CLI is optional.

If `gh` is installed and authenticated:

```bash
gh release create cell-data-v3 \
  ~/localtell-osm-work/output/TN.db.gz \
  ~/localtell-osm-work/output/manifest.json \
  --repo actionanand/localtell-data \
  --target master \
  --title "LocalTell Geographic Data v3" \
  --notes-file ~/localtell-osm-work/output/release-notes-v3.md
```

The browser workflow is fine for occasional releases.

---

## 34. Verify the published manifest

```bash
curl -L --fail \
  https://github.com/actionanand/localtell-data/releases/latest/download/manifest.json
```

Use the raw URL in the terminal, not Markdown link syntax.

Confirm the expected:

```text
version
downloadUrl
compressedBytes
uncompressedBytes
sha256
```

---

## 35. Re-download the published pack

```bash
mkdir -p ~/localtell-osm-work/release-test

curl -L --fail \
  -o ~/localtell-osm-work/release-test/TN.db.gz \
  https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/TN.db.gz
```

---

## 36. Verify the published compressed asset

```bash
sha256sum ~/localtell-osm-work/release-test/TN.db.gz
```

First V3 expected:

```text
cd4829bec836159899c06428462b7683fda55a10b2003a20800bc8c8788df588
```

---

## 37. Verify the published asset decompresses to the validated DB

```bash
gzip -dc ~/localtell-osm-work/release-test/TN.db.gz | sha256sum
```

First V3 expected:

```text
5dbb2fb3fb09b7650e97a49df8575b7ad37d77781b156367aa3fcdbb48b99a44  -
```

Complete integrity chain:

```text
provider PBF
   │
   ├── MD5 verified
   ↓
validated TN.db
   │
   ├── raw SHA-256
   ↓
TN.db.gz
   │
   ├── compressed SHA-256
   ↓
GitHub Release
   │
   ├── re-download
   ↓
same compressed SHA-256
   │
   ├── gunzip
   ↓
same raw TN.db SHA-256
```

---

## 38. First released V3 reference values

```text
Tag:
cell-data-v3

Release:
LocalTell Geographic Data v3

TN.db:
5,976,064 bytes

TN.db.gz:
1,988,105 bytes

Places:
22,692

Geometry rows:
990

Raw TN.db SHA-256:
5dbb2fb3fb09b7650e97a49df8575b7ad37d77781b156367aa3fcdbb48b99a44

Compressed TN.db.gz SHA-256:
cd4829bec836159899c06428462b7683fda55a10b2003a20800bc8c8788df588
```

These are historical reference values. Future OSM builds should produce different counts, sizes and hashes.

---

## 39. Android smoke test after release

### Online installation

1. Install an Android build with schema-v3 support.
2. Keep internet ON.
3. Open **Offline data**.
4. Refresh.
5. Confirm `Tamil Nadu`, `Version 3`.
6. Download/install.
7. Confirm it shows `Installed`.

### Offline pack-list test

Turn off:

```text
Wi-Fi
Mobile data
```

Close and reopen LocalTell.

The installed Tamil Nadu pack should remain visible. A network refresh error is acceptable, but installed data must not disappear.

### Offline locality test

Keep:

```text
Android Location ON
Wi-Fi OFF
Mobile data OFF
```

Then:

```text
Home
→ Refresh locality
```

Expected:

```text
cellular diagnostics
        ↓
one-shot GNSS fix
        ↓
TN.db lookup
        ↓
current locality
```

Internet should not be required after the pack is installed.

---

## 40. Strong proof schema v3 works

A valuable real-device test is:

```text
new/unknown Cell ID
        ↓
not present in old V1/V2 mapping
        ↓
GNSS coordinate
        ↓
schema-v3 TN.db
        ↓
locality still resolves
```

This demonstrates the key benefit of the geographic architecture.

---

## 41. Future Tamil Nadu updates

For later OSM refreshes:

1. download a fresh Southern Zone PBF;
2. download the matching current MD5;
3. verify the source;
4. rebuild `TN.db`;
5. validate schema;
6. rerun known-area, variety and border tests;
7. save a new raw SHA-256;
8. create deterministic gzip;
9. save the new compressed SHA-256;
10. increment the pack version/tag;
11. generate a new manifest;
12. publish a new Latest release;
13. re-download and verify;
14. test Android update/install/offline lookup.

Prefer a new release/tag instead of silently replacing a materially different published pack.

---

## 42. Cleanup

Inspect sizes:

```bash
du -sh ~/localtell-osm-work
du -sh ~/localtell-osm-work/source
du -sh ~/localtell-osm-work/output
```

Remove temporary release verification:

```bash
rm -rf ~/localtell-osm-work/release-test
```

When intentionally rebuilding:

```bash
rm -f ~/localtell-osm-work/output/TN.db
rm -f ~/localtell-osm-work/output/TN.db.gz
rm -f ~/localtell-osm-work/output/TN.db.sha256
rm -f ~/localtell-osm-work/output/TN.db.gz.sha256
rm -f ~/localtell-osm-work/output/manifest.json
```

---

## 43. Release checklist

```text
[ ] Conda environment active
[ ] Python works
[ ] pyosmium imports
[ ] unit tests pass
[ ] scripts compile
[ ] current Southern Zone PBF downloaded
[ ] provider MD5 passes
[ ] TN.db build succeeds
[ ] schema-v3 validator passes
[ ] known-area lookup passes
[ ] geographic variety tests look sensible
[ ] Kerala outside test returns outside_pack
[ ] Kerala border tests pass
[ ] Karnataka border test passes
[ ] Andhra Pradesh border test passes
[ ] raw TN.db SHA-256 saved
[ ] deterministic gzip created
[ ] gzip integrity passes
[ ] gunzip hash equals raw TN.db hash
[ ] TN.db.gz SHA-256 saved
[ ] manifest.json generated
[ ] manifest JSON parses
[ ] manifest sizes/hashes match files
[ ] release notes reviewed
[ ] GitHub release created as Latest
[ ] only manifest.json and TN.db.gz uploaded
[ ] latest manifest URL returns the new pack
[ ] published TN.db.gz re-downloaded
[ ] published compressed SHA-256 matches
[ ] published asset decompresses to validated raw SHA-256
[ ] Android installation succeeds
[ ] installed pack remains visible offline
[ ] Android GNSS → offline locality lookup succeeds
```

---

## 44. OpenStreetMap attribution

The geographic pack is derived from OpenStreetMap data.

Release notes/documentation should include appropriate attribution, for example:

```text
© OpenStreetMap contributors
```

Current licensing/attribution information:

```text
https://www.openstreetmap.org/copyright
```

The large `.osm.pbf` is a build input and should not be committed to Git history.

Runtime packs should continue to be distributed through GitHub Releases.

---

## 45. Final operational rule

Preserve this chain for every release:

```text
source PBF
    ↓ MD5 verified
validated TN.db
    ↓ raw SHA-256 saved
TN.db.gz
    ↓ compressed SHA-256 saved
manifest.json
    ↓
GitHub Release
    ↓ re-download
published TN.db.gz
    ↓ compressed hash matches
decompressed TN.db
    ↓ raw hash matches
Android offline test
```

If any step fails, stop the release and investigate before distributing the pack.
