# LocalTell — South India Geographic Pack Testing Guide

This document defines the repeatable test procedure for LocalTell's South India offline geographic packs.

It covers:

- Tamil Nadu (`TN`)
- Kerala (`KL`)
- Karnataka (`KA`)
- Andhra Pradesh (`AP`)
- Telangana (`TS`)
- Puducherry (`PY`)

The goal is to verify the complete flow from generated SQLite database to published GitHub Release asset and Android offline locality resolution.

---

## 1. Current South India Pack Set

| Pack | State / UT | Pack Version | Schema |
|---|---|---:|---:|
| `TN` | Tamil Nadu | 3 | 3 |
| `KL` | Kerala | 3 | 3 |
| `KA` | Karnataka | 3 | 3 |
| `AP` | Andhra Pradesh | 3 | 3 |
| `TS` | Telangana | 3 | 3 |
| `PY` | Puducherry | 3 | 3 |

Current release bucket:

```text
cell-data-v3
```

Current manifest schema:

```text
2
```

---

# 2. Test Stages

Every state/UT should pass these stages:

```text
Build
  ↓
Validate
  ↓
Package
  ↓
Locality tests
  ↓
Border / outside_pack tests
  ↓
Manifest generation
  ↓
GitHub publish
  ↓
Published hash verification
  ↓
Android end-to-end test
```

Do not skip validation.

---

# 3. Standard Build / Validate / Package Commands

For any state:

```bash
npm run data:build -- <PACK_ID>
npm run data:validate -- <PACK_ID>
npm run data:package -- <PACK_ID>
```

Example:

```bash
npm run data:build -- KA
npm run data:validate -- KA
npm run data:package -- KA
```

Expected validation pattern:

```text
VALID: schema-v3, <N> geometry rows, <N> places
VALID <PACK_ID>: places=<N>, geometries=<N>, pack_version=3
```

---

# 4. What `data:validate` Must Verify

The normal validator is expected to check:

- SQLite database structure
- required schema-v3 tables
- pack metadata
- expected pack ID
- expected pack version
- supported `place_type` values
- target level-4 state / UT boundary
- target state geometry
- foreign level-4 state boundaries
- place counts
- geometry counts
- RTree consistency
- coordinate validity

Manual SQLite queries are troubleshooting tools only.

Routine release validation should use:

```bash
npm run data:validate -- <PACK_ID>
```

---

# 5. Supported LocalTell Place Types

The schema-v3 geographic pack currently supports:

```text
administrative_boundary
neighbourhood
suburb
locality
hamlet
village
town
city
```

Unsupported OSM values such as:

```text
state
```

must not remain in the final runtime DB as a place type.

Administrative objects are normalized to:

```text
administrative_boundary
```

when appropriate.

---

# 6. Tamil Nadu Test

Set DB:

```bash
DB=~/localtell-osm-work/output/TN.db
```

Recommended representative tests:

```bash
echo "===== CHENNAI ====="
python scripts/test_locality_lookup.py "$DB" --lat 13.0827 --lon 80.2707

echo
echo "===== COIMBATORE ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.0168 --lon 76.9558

echo
echo "===== MADURAI ====="
python scripts/test_locality_lookup.py "$DB" --lat 9.9252 --lon 78.1198

echo
echo "===== TIRUCHIRAPPALLI ====="
python scripts/test_locality_lookup.py "$DB" --lat 10.7905 --lon 78.7047

echo
echo "===== NAGERCOIL ====="
python scripts/test_locality_lookup.py "$DB" --lat 8.1833 --lon 77.4119
```

Expected:

- locality should resolve inside Tamil Nadu;
- `state` should be Tamil Nadu;
- `state_code` should be `IN-TN`.

Example expected state fields:

```text
state: Tamil Nadu
state_code: IN-TN
```

---

# 7. Tamil Nadu Border / Outside Tests

Use known coordinates outside Tamil Nadu.

Example Kerala-side test:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 8.34290 --lon 77.15478
```

Expected:

```text
resolution_method: outside_pack
```

Also test a Karnataka coordinate:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 12.9716 --lon 77.5946
```

Expected:

```text
resolution_method: outside_pack
```

---

# 8. Kerala Test

Set DB:

```bash
DB=~/localtell-osm-work/output/KL.db
```

Run:

```bash
echo "===== THIRUVANANTHAPURAM ====="
python scripts/test_locality_lookup.py "$DB" --lat 8.5241 --lon 76.9366

echo
echo "===== KOCHI ====="
python scripts/test_locality_lookup.py "$DB" --lat 9.9312 --lon 76.2673

echo
echo "===== THRISSUR ====="
python scripts/test_locality_lookup.py "$DB" --lat 10.5276 --lon 76.2144

echo
echo "===== PALAKKAD ====="
python scripts/test_locality_lookup.py "$DB" --lat 10.7867 --lon 76.6548

echo
echo "===== KOZHIKODE ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.2588 --lon 75.7804

echo
echo "===== KANNUR ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.8745 --lon 75.3704

echo
echo "===== KASARAGOD ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.4996 --lon 74.9869
```

Expected:

```text
state: Kerala
state_code: IN-KL
```

---

# 9. Kerala Border Tests

Kerala-side near Tamil Nadu:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 8.34290 --lon 77.15478
```

Expected:

```text
state: Kerala
state_code: IN-KL
```

Tamil Nadu-side:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 8.32278 --lon 77.15389
```

Expected:

```text
resolution_method: outside_pack
```

Nagercoil:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 8.1833 --lon 77.4119
```

Expected:

```text
resolution_method: outside_pack
```

Mangaluru / Karnataka:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 12.9141 --lon 74.8560
```

Expected:

```text
resolution_method: outside_pack
```

Coimbatore / Tamil Nadu:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 11.0168 --lon 76.9558
```

Expected:

```text
resolution_method: outside_pack
```

---

# 10. Karnataka Test

Set DB:

```bash
DB=~/localtell-osm-work/output/KA.db
```

Run:

```bash
echo "===== BENGALURU ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.9716 --lon 77.5946

echo
echo "===== MYSURU ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.2958 --lon 76.6394

echo
echo "===== MANGALURU ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.9141 --lon 74.8560

echo
echo "===== HUBBALLI ====="
python scripts/test_locality_lookup.py "$DB" --lat 15.3647 --lon 75.1240

echo
echo "===== BELAGAVI ====="
python scripts/test_locality_lookup.py "$DB" --lat 15.8497 --lon 74.4977

echo
echo "===== BALLARI ====="
python scripts/test_locality_lookup.py "$DB" --lat 15.1394 --lon 76.9214
```

Validated examples from the current pack include:

```text
Bengaluru → D'Souza Layout
Mysuru → Krishnamurtipuram
Mangaluru → Bolpugudde
Hubballi → Sirur Park
Belagavi → Camp
Ballari → Ballari
```

All should show:

```text
state: Karnataka
state_code: IN-KA
```

---

# 11. Karnataka Border Tests

```bash
echo "===== HOSUR / TAMIL NADU ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.7409 --lon 77.8253

echo
echo "===== SULTAN BATHERY / KERALA ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.6653 --lon 76.2570

echo
echo "===== CHITTOOR / ANDHRA PRADESH ====="
python scripts/test_locality_lookup.py "$DB" --lat 13.2172 --lon 79.1003

echo
echo "===== KOLHAPUR / MAHARASHTRA ====="
python scripts/test_locality_lookup.py "$DB" --lat 16.7050 --lon 74.2433
```

All expected:

```text
resolution_method: outside_pack
```

Karnataka-side border test:

```bash
echo "===== ATTIBELE / KARNATAKA ====="
python scripts/test_locality_lookup.py "$DB" --lat 12.7787 --lon 77.7703
```

Validated result:

```text
name: Attibele
place_type: town
state: Karnataka
state_code: IN-KA
```

---

# 12. Andhra Pradesh Test

Set DB:

```bash
DB=~/localtell-osm-work/output/AP.db
```

Run:

```bash
echo "===== VISAKHAPATNAM ====="
python scripts/test_locality_lookup.py "$DB" --lat 17.6868 --lon 83.2185

echo
echo "===== VIJAYAWADA ====="
python scripts/test_locality_lookup.py "$DB" --lat 16.5062 --lon 80.6480

echo
echo "===== TIRUPATI ====="
python scripts/test_locality_lookup.py "$DB" --lat 13.6288 --lon 79.4192

echo
echo "===== KURNOOL ====="
python scripts/test_locality_lookup.py "$DB" --lat 15.8281 --lon 78.0373
```

Validated current results include:

```text
Visakhapatnam → Ex Service Men Colony
Vijayawada → Moghalraja Puram
Tirupati → Tirupati
Kurnool → Rajvihar
```

Expected state:

```text
state: Andhra Pradesh
state_code: IN-AP
```

---

# 13. Andhra Pradesh Outside Test

Hyderabad / Telangana:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 17.3850 --lon 78.4867
```

Expected:

```text
resolution_method: outside_pack
```

---

# 14. Telangana Test

Set DB:

```bash
DB=~/localtell-osm-work/output/TS.db
```

Run:

```bash
echo "===== HYDERABAD ====="
python scripts/test_locality_lookup.py "$DB" --lat 17.3850 --lon 78.4867

echo
echo "===== WARANGAL ====="
python scripts/test_locality_lookup.py "$DB" --lat 17.9689 --lon 79.5941

echo
echo "===== KARIMNAGAR ====="
python scripts/test_locality_lookup.py "$DB" --lat 18.4386 --lon 79.1288

echo
echo "===== NIZAMABAD ====="
python scripts/test_locality_lookup.py "$DB" --lat 18.6725 --lon 78.0941
```

Validated current results include:

```text
Hyderabad → Sultan Bazar
Warangal → Warangal
Karimnagar → Karimnagar
Nizamabad → kumargally
```

Expected state:

```text
state: Telangana
state_code: IN-TS
```

---

# 15. Telangana Outside Test

Vijayawada / Andhra Pradesh:

```bash
python scripts/test_locality_lookup.py "$DB" --lat 16.5062 --lon 80.6480
```

Expected:

```text
resolution_method: outside_pack
```

---

# 16. Puducherry Test

Puducherry is the most important multi-region test because the Union Territory contains geographically disconnected territories.

Set DB:

```bash
DB=~/localtell-osm-work/output/PY.db
```

Test all four major components.

```bash
echo "===== PUDUCHERRY ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.9416 --lon 79.8083

echo
echo "===== KARAIKAL ====="
python scripts/test_locality_lookup.py "$DB" --lat 10.9254 --lon 79.8380

echo
echo "===== MAHE ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.7011 --lon 75.5367

echo
echo "===== YANAM ====="
python scripts/test_locality_lookup.py "$DB" --lat 16.7333 --lon 82.2167
```

Validated results:

```text
Puducherry → Ozhukarai
Karaikal → Karaikal
Mahé → Mahé
Yanam → Yanam
```

All must show:

```text
state: Puducherry
state_code: IN-PY
```

This confirms that one `PY.db` supports disconnected geographic areas.

---

# 17. Puducherry Outside Tests

```bash
echo "===== CUDDALORE / TAMIL NADU ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.7480 --lon 79.7714

echo
echo "===== KOZHIKODE / KERALA ====="
python scripts/test_locality_lookup.py "$DB" --lat 11.2588 --lon 75.7804

echo
echo "===== KAKINADA / ANDHRA PRADESH ====="
python scripts/test_locality_lookup.py "$DB" --lat 16.9891 --lon 82.2475
```

All expected:

```text
resolution_method: outside_pack
```

---

# 18. Current Validated Pack Statistics

## Tamil Nadu

```text
Places: 22,692
Geometries: 990
Pack version: 3
```

Gzip SHA-256:

```text
cd4829bec836159899c06428462b7683fda55a10b2003a20800bc8c8788df588
```

---

## Kerala

```text
Places: 9,503
Geometries: 387
Pack version: 3
```

Gzip SHA-256:

```text
0955754d085b1660f552c5eed3d673f36f4da5c18eeeceb0e63ea4a5f2bfa20e
```

---

## Karnataka

```text
Places: 25,632
Geometries: 602
Pack version: 3
```

Gzip SHA-256:

```text
2361a02efb852c4988bf7faa010d7e3b3d2b56ba1c7c8290cb72e6b9f4020888
```

---

## Andhra Pradesh

```text
Places: 37,314
Geometries: 817
Pack version: 3
```

Gzip SHA-256:

```text
3fcf336ebbabab6eda3fea642c190b7624e2282066940616994d623edcb04d64
```

---

## Telangana

```text
Places: 15,902
Geometries: 866
Pack version: 3
```

Gzip SHA-256:

```text
bd027097d9fee8f07646992f06a5f721ecec683c73c7d87acfdfdf13be8d551a
```

---

## Puducherry

```text
Places: 112
Geometries: 59
Pack version: 3
```

Gzip SHA-256:

```text
38f0f00a2eefbb26560f18ba48dba53c041863236e9d46b10e57ce2480ce7bd3
```

---

# 19. Manifest Test

Generate:

```bash
npm run data:manifest
```

Inspect:

```bash
cat ~/localtell-osm-work/release-test/manifest.json | python -m json.tool
```

Expected:

```text
schemaVersion: 2
pack count: 6
```

Expected IDs:

```text
AP
KA
KL
PY
TN
TS
```

All pack versions should be:

```text
3
```

Quick check:

```bash
python - <<'PY'
import json
from pathlib import Path

p = Path.home() / "localtell-osm-work/release-test/manifest.json"
data = json.loads(p.read_text())

print("Manifest schema:", data["schemaVersion"])
print("Generated:", data["generatedAt"])
print("Pack count:", len(data["packs"]))
print()

for pack in data["packs"]:
    print(
        pack["id"],
        "|",
        pack["name"],
        "| version =", pack["version"],
        "| compressed =", pack["compressedBytes"],
        "| sha256 =", pack["sha256"],
    )
PY
```

---

# 20. Publish Test

Publish:

```bash
npm run data:publish
```

The script should update the existing release:

```text
cell-data-v3
```

Expected assets:

```text
AP.db.gz
KA.db.gz
KL.db.gz
PY.db.gz
TN.db.gz
TS.db.gz
manifest.json
```

Do not create a new release tag only because new states are added.

---

# 21. Check GitHub Release

```bash
gh release view cell-data-v3 \
  --repo actionanand/localtell-data
```

Expected:

```text
6 geographic packs
7 assets total
```

---

# 22. Published Manifest Verification

Download:

```bash
rm -rf ~/localtell-osm-work/release-test/published
mkdir -p ~/localtell-osm-work/release-test/published

gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "manifest.json" \
  --dir ~/localtell-osm-work/release-test/published
```

Compare:

```bash
sha256sum \
  ~/localtell-osm-work/release-test/manifest.json \
  ~/localtell-osm-work/release-test/published/manifest.json
```

Both hashes must be identical.

---

# 23. Published Pack Verification

Download all DB assets:

```bash
gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "*.db.gz" \
  --dir ~/localtell-osm-work/release-test/published \
  --skip-existing
```

Compare all packs:

```bash
for id in AP KA KL PY TN TS; do
  echo "===== $id ====="
  sha256sum \
    ~/localtell-osm-work/output/$id.db.gz \
    ~/localtell-osm-work/release-test/published/$id.db.gz
done
```

For every pack:

```text
local hash == published hash
```

---


# 24. Testing Published Data on Another Machine (No Source PBF Required)

You can test an already-published LocalTell state pack on a completely different machine **without** downloading the original Geofabrik `.osm.pbf` source file.

For published-pack testing, you only need:

```text
localtell-data repository
+
published manifest.json
+
published <STATE>.db.gz
```

The large source file such as:

```text
southern-zone-latest.osm.pbf
```

is required only when **building or rebuilding** a state pack.

It is **not required** for:

```text
downloading a published pack
verifying its SHA-256
decompressing it
running locality lookup tests
testing outside_pack behavior
```

This makes it easy to verify a GitHub Release from another computer.

---

## 24.1 Example: Test Karnataka on a Fresh Machine

The following example uses Karnataka (`KA`).

### Step 1 — Clone the data repository

```bash
git clone https://github.com/actionanand/localtell-data.git
cd localtell-data
```

The repository provides the test script:

```text
scripts/test_locality_lookup.py
```

No Geofabrik source PBF is needed for this test.

---

### Step 2 — Create a temporary test directory

```bash
mkdir -p ~/localtell-published-test
cd ~/localtell-published-test
```

---

### Step 3 — Download the published manifest

```bash
curl -L \
  -o manifest.json \
  https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/manifest.json
```

Inspect it:

```bash
python -m json.tool manifest.json
```

Confirm that it contains:

```text
KA — Karnataka
version = 3
```

---

### Step 4 — Download Karnataka

```bash
curl -L \
  -o KA.db.gz \
  https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/KA.db.gz
```

---

### Step 5 — Verify the downloaded SHA-256 against the manifest

Run:

```bash
python - <<'PY'
import hashlib
import json
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
pack = next(p for p in manifest["packs"] if p["id"] == "KA")

path = Path("KA.db.gz")
actual = hashlib.sha256(path.read_bytes()).hexdigest()
expected = pack["sha256"]

print("Pack:", pack["id"], "-", pack["name"])
print("Expected:", expected)
print("Actual:  ", actual)
print("MATCH:", actual == expected)

if actual != expected:
    raise SystemExit("SHA-256 mismatch")
PY
```

Expected:

```text
MATCH: True
```

For the currently published Karnataka pack, the expected SHA-256 is:

```text
2361a02efb852c4988bf7faa010d7e3b3d2b56ba1c7c8290cb72e6b9f4020888
```

The manifest should be treated as the normal source of the expected hash, so future pack revisions do not require changing the test command.

---

### Step 6 — Decompress the database

Keep the downloaded `.gz` file and create a separate SQLite DB:

```bash
gzip -dc KA.db.gz > KA.db
```

Check that both files exist:

```bash
ls -lh KA.db.gz KA.db
```

---

### Step 7 — Validate the downloaded DB with LocalTell tooling

Return to the cloned repository and run the geographic validator directly against the downloaded DB.

For example, if the repository was cloned to:

```text
~/localtell-data
```

run:

```bash
cd ~/localtell-data

python scripts/validate_geographic_pack.py \
  ~/localtell-published-test/KA.db \
  --expected-state-code IN-KA \
  --expected-pack-id KA
```

Expected:

```text
VALID: schema-v3, ...
```

This validates the actual database downloaded from GitHub rather than a locally built copy.

---

### Step 8 — Test a Karnataka coordinate

From the cloned repository:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-published-test/KA.db \
  --lat 12.9716 \
  --lon 77.5946
```

This is a Bengaluru test.

Expected:

```text
state: Karnataka
state_code: IN-KA
```

The exact neighbourhood/locality can change when OSM data is rebuilt in the future, so the important checks are:

```text
a locality resolves
state = Karnataka
state_code = IN-KA
resolution_method is not outside_pack
```

---

### Step 9 — Test a coordinate outside Karnataka

Test Hosur in Tamil Nadu:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-published-test/KA.db \
  --lat 12.7409 \
  --lon 77.8253
```

Expected:

```text
resolution_method: outside_pack
```

This proves that the published Karnataka DB does not incorrectly resolve a nearby Tamil Nadu coordinate.

---

## 24.2 One-Block Karnataka Published-Pack Test

After cloning the repository, the essential verification can be run as:

```bash
mkdir -p ~/localtell-published-test
cd ~/localtell-published-test

curl -L \
  -o manifest.json \
  https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/manifest.json

curl -L \
  -o KA.db.gz \
  https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/KA.db.gz

python - <<'PY'
import hashlib
import json
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
pack = next(p for p in manifest["packs"] if p["id"] == "KA")
actual = hashlib.sha256(Path("KA.db.gz").read_bytes()).hexdigest()

print("Expected:", pack["sha256"])
print("Actual:  ", actual)

if actual != pack["sha256"]:
    raise SystemExit("SHA-256 mismatch")

print("SHA-256 OK")
PY

gzip -dc KA.db.gz > KA.db

cd ~/localtell-data

python scripts/validate_geographic_pack.py \
  ~/localtell-published-test/KA.db \
  --expected-state-code IN-KA \
  --expected-pack-id KA

python scripts/test_locality_lookup.py \
  ~/localtell-published-test/KA.db \
  --lat 12.9716 \
  --lon 77.5946

python scripts/test_locality_lookup.py \
  ~/localtell-published-test/KA.db \
  --lat 12.7409 \
  --lon 77.8253
```

Expected overall result:

```text
SHA-256 OK

Karnataka coordinate
→ resolves inside Karnataka

Hosur / Tamil Nadu coordinate
→ outside_pack
```

---

## 24.3 Replicate the Same Test for Another State

Only four values need to change:

```text
PACK_ID
STATE_CODE
inside-state coordinate
outside-state coordinate
```

Example mapping:

| Pack | State / UT | State code |
|---|---|---|
| `TN` | Tamil Nadu | `IN-TN` |
| `KL` | Kerala | `IN-KL` |
| `KA` | Karnataka | `IN-KA` |
| `AP` | Andhra Pradesh | `IN-AP` |
| `TS` | Telangana | `IN-TS` |
| `PY` | Puducherry | `IN-PY` |

For example, to test Andhra Pradesh:

```text
KA.db.gz
→ AP.db.gz

KA.db
→ AP.db

IN-KA
→ IN-AP
```

Then use one Andhra Pradesh coordinate and one coordinate known to be outside Andhra Pradesh.

---

## 24.4 Optional: Download with GitHub CLI

If GitHub CLI is already installed, the same release asset can be downloaded with:

```bash
gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "KA.db.gz" \
  --dir ~/localtell-published-test
```

The manifest can be downloaded with:

```bash
gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "manifest.json" \
  --dir ~/localtell-published-test
```

Because `localtell-data` is public, authentication is not required when using the direct `curl` release URLs.

---

## 24.5 What This Fresh-Machine Test Proves

This test verifies a different part of the pipeline from the build-machine test.

Build machine:

```text
Geofabrik PBF
    ↓
builder
    ↓
local DB
    ↓
package
    ↓
publish
```

Fresh test machine:

```text
GitHub Release
    ↓
manifest
    ↓
download .db.gz
    ↓
SHA-256 verification
    ↓
decompress
    ↓
validate DB
    ↓
locality lookup
```

If the fresh-machine test passes, it proves that the published artifact is independently usable and does not depend on the original build workspace or Geofabrik PBF.

---

# 25. Android End-to-End Test

After GitHub publishing is verified, test the actual Android app.

## Step 1 — Refresh Offline Data

Open:

```text
LocalTell
→ Offline Data
```

Refresh the manifest.

Expected available packs:

```text
Andhra Pradesh
Karnataka
Kerala
Puducherry
Tamil Nadu
Telangana
```

---

## Step 2 — Install New Packs

Install at least:

```text
KA
AP
TS
PY
```

Verify:

- download completes;
- SHA-256 validation succeeds;
- gzip decompression succeeds;
- pack is stored locally;
- pack appears as installed.

---

## Step 3 — Multiple Packs

Keep multiple packs installed together.

Recommended:

```text
TN
KL
KA
AP
TS
PY
```

Verify that installing one pack does not remove another.

---

## Step 4 — Current-location Resolution

While physically inside an installed pack:

```text
Home
→ Locality
```

Expected:

- locality name appears;
- district / subdistrict appears when available;
- correct state appears;
- app remains fully offline after data pack installation.

---

## Step 5 — Manual Coordinate Tests

If LocalTell exposes manual coordinate lookup, repeat representative coordinates from this document.

This is especially useful for:

```text
KA ↔ TN border
KA ↔ KL border
AP ↔ TS border
PY disconnected territories
```

---

# 26. Android Multi-Pack Resolver Test

The resolver should:

```text
coordinate
    ↓
iterate installed schema-v3 packs
    ↓
check state extent
    ↓
select matching pack
    ↓
resolve locality
```

Example:

```text
Installed:
TN + KL + KA

Coordinate:
12.9716, 77.5946

Expected:
Karnataka pack selected
```

It must not return:

```text
Tamil Nadu
Kerala
```

---

# 27. Offline Test

After packs are installed:

1. Disable Wi-Fi.
2. Disable mobile data.
3. Keep device location enabled.
4. Open LocalTell.
5. Request locality.

Expected:

```text
Locality resolution still works.
```

Internet should be required only for downloading/updating pack data, not for normal offline locality lookup.

---

# 28. Regression Checklist

Before considering a release complete:

```text
[ ] TN build passes
[ ] TN validation passes
[ ] TN locality tests pass
[ ] TN outside_pack tests pass

[ ] KL build passes
[ ] KL validation passes
[ ] KL locality tests pass
[ ] KL outside_pack tests pass

[ ] KA build passes
[ ] KA validation passes
[ ] KA locality tests pass
[ ] KA outside_pack tests pass

[ ] AP build passes
[ ] AP validation passes
[ ] AP locality tests pass
[ ] AP outside_pack tests pass

[ ] TS build passes
[ ] TS validation passes
[ ] TS locality tests pass
[ ] TS outside_pack tests pass

[ ] PY build passes
[ ] PY validation passes
[ ] Puducherry test passes
[ ] Karaikal test passes
[ ] Mahé test passes
[ ] Yanam test passes
[ ] PY outside_pack tests pass

[ ] manifest contains 6 packs
[ ] all pack versions are correct
[ ] GitHub release contains 7 assets
[ ] published manifest hash matches local
[ ] every published DB hash matches local
[ ] Android sees all 6 packs
[ ] Android can install multiple packs
[ ] Android offline resolution works
```

---

# 29. Current South India Release Status

The current validated South India rollout is:

```text
TN ✅
KL ✅
KA ✅
AP ✅
TS ✅
PY ✅
```

Published release:

```text
cell-data-v3
```

Release assets have been compared against local packaged files using SHA-256 and matched successfully.

---

# 30. Final Test Rule

A LocalTell state pack is considered fully tested only when all of the following are true:

```text
Builder succeeds
+
Validator succeeds
+
Package succeeds
+
Representative locality tests succeed
+
Border / outside_pack tests succeed
+
Published asset hash matches local artifact
+
Android downloads and installs the pack
+
Offline Android locality resolution works
```

Passing only the build command is not sufficient.
