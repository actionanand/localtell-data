# LocalTell CLI Map Building Guide

This document describes the repeatable CLI workflow for building LocalTell offline geographic packs from Geofabrik/OpenStreetMap data.

> Updated for efficient one-parse-per-source regional builds and optional terminal progress/heartbeat logging.

The goal is to support both:

- **individual pack builds**, such as `MH`, `TN`, or `GA`;
- **regional builds**, such as `south` or `west`;
- eventually **all India builds**, while still keeping every State/UT as an independent downloadable LocalTell pack.

The Android app consumes the final `.db.gz` pack files and `manifest.json`; the large `.osm.pbf` files are build-time inputs only.

---

## 1. Repository and workspace

Repository:

```text
/mnt/c/AR_Files/code/localtell-data
```

Default build workspace:

```text
~/localtell-osm-work/
├── source/        # downloaded Geofabrik .osm.pbf files + checksum files
├── output/        # generated .db and .db.gz files
└── release-test/  # generated manifest/release notes and downloaded verification assets
```

Create the workspace when needed:

```bash
mkdir -p \
  ~/localtell-osm-work/source \
  ~/localtell-osm-work/output \
  ~/localtell-osm-work/release-test
```

Run LocalTell npm/Python commands from:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

---

## 2. Main CLI commands

### Build one State/UT pack

```bash
npm run data:build -- MH
```

Examples:

```bash
npm run data:build -- TN
npm run data:build -- KA
npm run data:build -- GJ
npm run data:build -- GA
```

### Build a whole region

```bash
npm run data:build:region -- west
```

Examples:

```bash
npm run data:build:region -- south
npm run data:build:region -- west
npm run data:build:region -- central
npm run data:build:region -- north
npm run data:build:region -- east
npm run data:build:region -- northeast
```

Region membership must come from `config/india-packs.json`. Do **not** hard-code State/UT lists in the Python scripts.

For efficient regional builds, packs sharing the same source PBF should reuse a **single OSM parse**. For example, a West India build should parse `western-zone-latest.osm.pbf` once and then create `MH.db`, `GJ.db`, `GA.db`, and `DH.db` from the collected features.

### Build all enabled India packs

```bash
npm run data:build:all
```

The efficient implementation should parse each unique configured Geofabrik source once.

For long-running builds, `--progress` should report the current source, parse
phase, elapsed time, and per-pack progress. The progress reporter must not cause
a second PBF parse.

### Force rebuild

For an individual pack:

```bash
npm run data:build -- MH --force
```

For a region:

```bash
npm run data:build:region -- west --force
```

Without `--force`, existing target `.db` files should be treated as an error so they are not overwritten accidentally.

### Show build progress for long-running PBF operations

For long regional builds, use `--progress` so the terminal shows phase changes,
elapsed time, and a periodic heartbeat instead of appearing idle:

```bash
npm run data:build:region -- west --progress
```

South India:

```bash
npm run data:build:region -- south --progress
```

Individual builds can use the same option when supported by the current build scripts:

```bash
npm run data:build -- MH --progress
```

Progress mode should report truthful build phases rather than a guessed percentage.
A typical regional build should show:

```text
[00:00:00] Regional build: west
[00:00:00] Packs: MH, GJ, GA, DH
[00:00:00] Source: western-zone-latest.osm.pbf

[00:00:00] [western-zone] Pass 1/2: indexing relation members...
[00:00:15] [western-zone] Still working... elapsed 15s
[00:00:30] [western-zone] Still working... elapsed 30s
[00:01:02] [western-zone] Pass 1/2 complete

[00:01:02] [western-zone] Pass 2/2: collecting places and geometry...
[00:01:17] [western-zone] Still working... elapsed 15s
[00:02:31] [western-zone] Collection complete

[00:02:31] [1/4] Building MH — Maharashtra
[00:02:44] [1/4] Completed MH

[00:02:44] [2/4] Building GJ — Gujarat
...

[00:03:21] Regional build completed
            packs: 4
            unique source PBFs parsed: 1
            total elapsed: 3m 21s
```

The heartbeat is only an activity indicator. It should not print one line per OSM
feature and should not materially slow down parsing.

Without `--progress`, the normal concise build output remains appropriate.

---

## 3. India region plan

LocalTell uses the six India zone groupings used by the India/OpenStreetMap region classification and corresponding Geofabrik extracts.

| LocalTell region | Geofabrik source | Planned State/UT packs |
|---|---|---|
| `south` | `southern-zone-latest.osm.pbf` | Tamil Nadu, Kerala, Karnataka, Andhra Pradesh, Telangana, Puducherry, Andaman and Nicobar Islands, Lakshadweep |
| `west` | `western-zone-latest.osm.pbf` | Maharashtra, Gujarat, Goa, Dadra and Nagar Haveli and Daman and Diu |
| `central` | `central-zone-latest.osm.pbf` | Madhya Pradesh, Chhattisgarh, Uttar Pradesh, Uttarakhand |
| `north` | `northern-zone-latest.osm.pbf` | Rajasthan, Punjab, Haryana, Himachal Pradesh, Chandigarh, Delhi, Jammu and Kashmir, Ladakh |
| `east` | `eastern-zone-latest.osm.pbf` | Bihar, Jharkhand, Odisha, West Bengal |
| `northeast` | `north-eastern-zone-latest.osm.pbf` | Assam, Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura |

### Important: verify State/UT codes from the current PBF

Do not blindly copy older OSM wiki abbreviations into LocalTell configuration. Before adding a new region, inspect the current Geofabrik PBF and read its actual `ISO3166-2` values.

For example, the current Western Zone source showed:

```text
Maharashtra                              IN-MH
Gujarat                                  IN-GJ
Goa                                      IN-GA
Dadra and Nagar Haveli and Daman and Diu IN-DH
```

Use the actual PBF value in `stateCode`.

---

## 4. Download a Geofabrik region

The pattern is:

```text
https://download.geofabrik.de/asia/india/<region>-latest.osm.pbf
```

Always download both the PBF and its `.md5` checksum.

### South India

```bash
mkdir -p ~/localtell-osm-work/source

curl -L \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf

curl -L \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5

cd ~/localtell-osm-work/source
md5sum -c southern-zone-latest.osm.pbf.md5
```

Expected:

```text
southern-zone-latest.osm.pbf: OK
```

### West India

```bash
mkdir -p ~/localtell-osm-work/source

curl -L \
  -o ~/localtell-osm-work/source/western-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf

curl -L \
  -o ~/localtell-osm-work/source/western-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf.md5

cd ~/localtell-osm-work/source
md5sum -c western-zone-latest.osm.pbf.md5
```

### Future regions

Use the same pattern:

```bash
# Central
central-zone-latest.osm.pbf

# North
northern-zone-latest.osm.pbf

# East
eastern-zone-latest.osm.pbf

# North-East
north-eastern-zone-latest.osm.pbf
```

Example for Central India:

```bash
curl -L \
  -o ~/localtell-osm-work/source/central-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/central-zone-latest.osm.pbf

curl -L \
  -o ~/localtell-osm-work/source/central-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/central-zone-latest.osm.pbf.md5

cd ~/localtell-osm-work/source
md5sum -c central-zone-latest.osm.pbf.md5
```

Do not start building if checksum verification fails.

---

## 5. Inspect the source before configuring a new region

A Geofabrik regional PBF can include neighboring administrative boundaries because extraction polygons overlap surrounding areas.

Therefore, seeing Karnataka or Telangana in the Western Zone source does **not** mean those states belong to the West India LocalTell group.

Inspect level-4 administrative boundaries with:

```bash
cd /mnt/c/AR_Files/code/localtell-data

python - <<'PY'
import osmium
from pathlib import Path

pbf = Path.home() / "localtell-osm-work/source/western-zone-latest.osm.pbf"

class Handler(osmium.SimpleHandler):
    def relation(self, r):
        t = r.tags
        if t.get("boundary") == "administrative" and t.get("admin_level") == "4":
            print(
                f"id={r.id}",
                f"name={t.get('name')}",
                f"ISO3166-2={t.get('ISO3166-2')}",
                f"ref:IN={t.get('ref:IN')}",
                f"state_code={t.get('state_code')}"
            )

Handler().apply_file(str(pbf))
PY
```

Change the source filename for other regions.

Use this output to confirm:

- exact State/UT names;
- exact `ISO3166-2` codes;
- which neighboring boundaries are merely present in the source extract.

---

## 6. Configure packs

Configuration file:

```text
config/india-packs.json
```

A pack entry should look like:

```json
{
  "id": "MH",
  "name": "Maharashtra",
  "stateCode": "IN-MH",
  "region": "west",
  "displayOrder": 1,
  "source": "western-zone",
  "packVersion": 3,
  "enabled": true
}
```

The corresponding source mapping should exist under `sources`:

```json
{
  "sources": {
    "southern-zone": "source/southern-zone-latest.osm.pbf",
    "western-zone": "source/western-zone-latest.osm.pbf"
  }
}
```

Future source entries can follow the same convention:

```json
{
  "central-zone": "source/central-zone-latest.osm.pbf",
  "northern-zone": "source/northern-zone-latest.osm.pbf",
  "eastern-zone": "source/eastern-zone-latest.osm.pbf",
  "north-eastern-zone": "source/north-eastern-zone-latest.osm.pbf"
}
```

### Display ordering

`displayOrder` is unique **within a region**, not globally.

Example:

```text
south / displayOrder 1 = Tamil Nadu
west  / displayOrder 1 = Maharashtra
```

This is valid.

---

## 7. Run tests before expensive builds

From the repository:

```bash
cd /mnt/c/AR_Files/code/localtell-data

npm run data:test
git diff --check
python -m py_compile scripts/*.py
```

Do this after changing build automation or pack configuration.

---

## 8. Build packs

### Individual build

```bash
npm run data:build -- MH
```

Expected output file:

```text
~/localtell-osm-work/output/MH.db
```

### Regional build

Recommended for interactive terminal use:

```bash
npm run data:build:region -- west --progress
```

The concise form remains valid:

```bash
npm run data:build:region -- west
```

Expected output files:

```text
MH.db
GJ.db
GA.db
DH.db
```

The efficient regional builder should parse the Western Zone PBF once and reuse the collected OSM features for all four packs.

### South India example

```bash
npm run data:build:region -- south --progress
```

Expected packs:

```text
TN KL KA AP TS PY AN LD
```

---

## 9. Validate every pack

Validation is always per pack:

```bash
npm run data:validate -- MH
npm run data:validate -- GJ
npm run data:validate -- GA
npm run data:validate -- DH
```

Validation checks include the schema-v3 database structure and geographic/state safeguards.

A successful result looks similar to:

```text
VALID: schema-v3, ... geometry rows, ... places
VALID MH: places=..., geometries=..., pack_version=3
```

Do not package or publish a pack that fails validation.

---

## 10. Package every pack

```bash
npm run data:package -- MH
npm run data:package -- GJ
npm run data:package -- GA
npm run data:package -- DH
```

Packaging validates again and creates:

```text
MH.db.gz
GJ.db.gz
GA.db.gz
DH.db.gz
```

It also prints:

- raw SHA-256;
- gzip SHA-256;
- compressed bytes;
- uncompressed bytes.

---

## 11. Geographic lookup testing

Do not rely only on schema validation. Test representative locations inside the pack and locations outside it.

Example:

```bash
DB=~/localtell-osm-work/output/MH.db

python scripts/test_locality_lookup.py "$DB" \
  --lat <latitude> \
  --lon <longitude>
```

Inside locations should resolve to:

```text
state: Maharashtra
state_code: IN-MH
```

Outside locations should return:

```text
resolution_method: outside_pack
```

### Special geography needs extra tests

Test every disconnected component of a State/UT where possible.

Examples already important to LocalTell:

- Puducherry: Puducherry, Karaikal, Mahé, Yanam;
- Andaman and Nicobar Islands: Port Blair, Car Nicobar, Great Nicobar/Campbell Bay;
- Lakshadweep: Kavaratti, Agatti, Minicoy;
- Dadra and Nagar Haveli and Daman and Diu: Dadra & Nagar Haveli, Daman, Diu.

Use actual populated/OSM points rather than approximate coastal coordinates; an offshore coordinate can correctly return `outside_pack`.

---

## 12. Generate the manifest

The manifest generator expects local `.db` and `.db.gz` files for **all enabled packs**.

```bash
npm run data:manifest
```

Generated file:

```text
~/localtell-osm-work/release-test/manifest.json
```

Inspect it:

```bash
cat ~/localtell-osm-work/release-test/manifest.json | python -m json.tool
```

Current manifest fields include:

```text
id
name
version
region
displayOrder
downloadUrl
sha256
compressedBytes
uncompressedBytes
```

Regional totals are not stored in the manifest. The Android app should calculate them by summing each pack's byte fields.

---

## 13. Reuse already-published packs instead of rebuilding them

If unchanged packs were cleaned locally but are still needed for manifest generation, download their published `.db.gz` assets and recreate the raw DB files.

Example:

```bash
gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "*.db.gz" \
  --dir ~/localtell-osm-work/output \
  --skip-existing
```

Then decompress only the unchanged packs that are missing locally:

```bash
for id in TN KL KA AP TS PY AN LD; do
  if [ -f ~/localtell-osm-work/output/$id.db.gz ] && \
     [ ! -f ~/localtell-osm-work/output/$id.db ]; then
    gzip -dc ~/localtell-osm-work/output/$id.db.gz \
      > ~/localtell-osm-work/output/$id.db
  fi
done
```

This avoids rebuilding an unchanged region from the large PBF just to regenerate the cumulative manifest.

---

## 14. Publish

After all new packs are validated, packaged, locality-tested, and the manifest is inspected:

```bash
npm run data:publish
```

Current release bucket:

```text
cell-data-v3
```

View the result:

```bash
gh release view cell-data-v3 \
  --repo actionanand/localtell-data
```

Publishing a new pack does not by itself require a new DB schema version or release tag. `cell-data-v3` is the current schema-v3 release bucket.

---

## 15. Verify published artifacts

Always download important new assets back from GitHub and compare SHA-256 hashes.

Example:

```bash
rm -rf ~/localtell-osm-work/release-test/published
mkdir -p ~/localtell-osm-work/release-test/published

gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "manifest.json" \
  --dir ~/localtell-osm-work/release-test/published

gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --pattern "MH.db.gz" \
  --dir ~/localtell-osm-work/release-test/published
```

Compare:

```bash
sha256sum \
  ~/localtell-osm-work/release-test/manifest.json \
  ~/localtell-osm-work/release-test/published/manifest.json

sha256sum \
  ~/localtell-osm-work/output/MH.db.gz \
  ~/localtell-osm-work/release-test/published/MH.db.gz
```

Both hashes in each pair must match exactly.

---

## 16. Clean a completed region

Only clean after the release has been published and independently hash-verified.

Delete the source PBF and checksum:

```bash
rm -f \
  ~/localtell-osm-work/source/<zone>-latest.osm.pbf \
  ~/localtell-osm-work/source/<zone>-latest.osm.pbf.md5
```

Delete generated `.db` and `.db.gz` files for the completed region.

Delete release-test copies:

```bash
rm -rf ~/localtell-osm-work/release-test/published
rm -f \
  ~/localtell-osm-work/release-test/manifest.json \
  ~/localtell-osm-work/release-test/release-notes.md
```

Verify:

```bash
find ~/localtell-osm-work -maxdepth 2 -type f -print
du -sh ~/localtell-osm-work
```

Keep the empty workspace directories for the next region.

---

## 17. Recommended region rollout order

LocalTell currently follows this practical rollout order:

```text
1. South India      ✅ completed
2. West India       ← current
3. Central India
4. North India
5. East India
6. North-East India
```

The rollout order is an application/workflow choice; State/UT membership should continue to follow the configured regional classification.

---

## 18. Build safety rules

Keep these rules throughout the India rollout:

1. Verify the Geofabrik `.md5` before building.
2. Inspect current PBF `admin_level=4` relations before adding a new region.
3. Use the exact `ISO3166-2` value found in the current PBF.
4. Never treat every State/UT boundary present in a regional PBF as a member of that LocalTell region.
5. Derive regional membership from `config/india-packs.json`.
6. Keep individual State/UT databases independent even when using a regional build command.
7. Regional builds should parse each unique PBF once for efficiency.
8. Use `--progress` for long interactive builds when you want phase logs and a heartbeat; do not rely on fake percentage output.
9. Validate and geographically test every generated pack.
10. Test disconnected territories individually.
11. Never publish automatically as part of `data:build`.
12. Generate and inspect the cumulative manifest before publishing.
13. Hash-verify newly published files before deleting local build artifacts.
14. Do not change DB schema, manifest schema, release tag, or pack version merely because a new geographic pack is added.
15. Do not modify `android-version.json` as part of map-data automation.

---

## 19. Useful command summary

```bash
# Go to repository
cd /mnt/c/AR_Files/code/localtell-data

# Tests
npm run data:test

# Individual build
npm run data:build -- MH

# Regional build
npm run data:build:region -- west

# Regional build with terminal progress/heartbeat
npm run data:build:region -- west --progress

# South regional build with progress
npm run data:build:region -- south --progress

# All enabled packs
npm run data:build:all

# Force rebuild
npm run data:build:region -- west --force

# Force rebuild with progress
npm run data:build:region -- west --force --progress

# Validate
npm run data:validate -- MH

# Package
npm run data:package -- MH

# Generate cumulative manifest
npm run data:manifest

# Publish
npm run data:publish

# View release
gh release view cell-data-v3 --repo actionanand/localtell-data

# Check workspace
find ~/localtell-osm-work -maxdepth 2 -type f -print
du -sh ~/localtell-osm-work
```

---

## References

- Geofabrik India downloads: https://download.geofabrik.de/asia/india.html
- OpenStreetMap India States/UT boundaries and zone classification: https://wiki.openstreetmap.org/wiki/India/Boundaries/States_and_Union_territories
- OpenStreetMap India administrative levels: https://wiki.openstreetmap.org/wiki/India/Administrative_Boundaries

