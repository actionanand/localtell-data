# LocalTell OSM Map Data Download & Geographic Pack Build Guide

This document explains how LocalTell obtains OpenStreetMap (OSM) source data, where the large map files should be stored, how to verify them, how to build a Tamil Nadu schema-v3 geographic pack, and how to test the generated offline locality database.

It complements:

```text
documentation/localtell-osm-python-environment-setup.md
```

That document covers Python/Conda setup. This document starts from the point where Python and `pyosmium` are already working.

---

# 1. What LocalTell needs from a "map"

LocalTell does **not** currently need a rendered map image, map tiles, or an interactive map UI.

The runtime requirement is:

```text
GNSS latitude/longitude
        ↓
offline geographic data
        ↓
locality / village / town
        ↓
district / state
```

Therefore the build pipeline needs **raw geographic data**, not screenshots or visual map tiles.

For the current implementation, the preferred input is:

```text
.osm.pbf
```

An `.osm.pbf` file is a compact binary representation of OpenStreetMap data containing objects such as:

- nodes,
- ways,
- relations,
- named places,
- administrative boundaries,
- roads,
- other OSM tags and geometry.

The LocalTell builder extracts only the information it needs and creates a much smaller SQLite geographic pack such as:

```text
TN.db
```

---

# 2. Where to obtain OpenStreetMap data

## Recommended source: Geofabrik

Geofabrik publishes regularly updated regional extracts of OpenStreetMap data.

Main download site:

```text
https://download.geofabrik.de/
```

India page:

```text
https://download.geofabrik.de/asia/india.html
```

Southern Zone page:

```text
https://download.geofabrik.de/asia/india/southern-zone.html
```

For the current Tamil Nadu build, use:

```text
https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
```

At the time this workflow was tested, the Southern Zone `.osm.pbf` was about 531–532 MB.

The exact size changes over time because OpenStreetMap is continuously updated.

---

# 3. Why use Southern Zone instead of the full India file?

Geofabrik also publishes a full India PBF:

```text
https://download.geofabrik.de/asia/india-latest.osm.pbf
```

The full India extract is much larger than the Southern Zone extract.

LocalTell currently needs Tamil Nadu only, so processing a smaller regional source is more efficient:

```text
Full India
   ↓
large input

Southern Zone
   ↓
smaller input
   ↓
LocalTell builder filters Tamil Nadu using IN-TN
```

The Southern Zone still contains more than Tamil Nadu, so the builder must explicitly restrict the output to the Tamil Nadu administrative boundary:

```text
ISO3166-2 = IN-TN
admin_level = 4
```

This filtering is performed by:

```text
scripts/build_geographic_pack.py
```

The input file therefore does **not** need to be Tamil-Nadu-only.

---

# 4. Other map/data formats available

Geofabrik may expose several formats for a region.

## `.osm.pbf`

Recommended for LocalTell.

Typical uses:

- pyosmium / Osmium processing,
- extracting OSM tags and relations,
- custom offline databases,
- routing/import pipelines.

Current LocalTell builder:

```text
YES
```

---

## `.gpkg.zip`

GeoPackage.

Useful for:

- QGIS,
- GIS inspection,
- SQL-based spatial analysis,
- manual verification of geometry.

Current LocalTell builder:

```text
NO — not required
```

---

## `.shp.zip`

ESRI Shapefile export.

Useful for older GIS workflows.

Current LocalTell builder:

```text
NO — not required
```

---

## `.poly`

A polygon file describing the geographic extent of the Geofabrik extract.

Potentially useful for:

- clipping,
- understanding region extent,
- external preprocessing tools.

Current LocalTell builder:

```text
NO — the builder identifies Tamil Nadu using OSM administrative data
```

---

## `.osc.gz` updates

OpenStreetMap change files.

These can be used to incrementally update an existing OSM dataset instead of downloading the whole PBF again.

This may become useful later if LocalTell automates frequent map-pack rebuilds.

Current LocalTell pipeline:

```text
Not used yet
```

---

## Vector tiles

Some providers publish vector-tile packages that can be rendered by tools such as MapLibre.

These are useful for an interactive visual map.

LocalTell's current locality resolver does not need rendered map tiles, so they are unnecessary for the schema-v3 geographic pack.

---

# 5. Raw OSM data vs a rendered map

This distinction is important.

## Raw OSM data

Example:

```text
southern-zone-latest.osm.pbf
```

Contains geographic objects and metadata.

LocalTell uses this.

## Rendered map

Examples:

- OpenStreetMap website,
- raster tiles,
- MapLibre vector map,
- screenshots,
- visual road maps.

These are designed for humans to view.

LocalTell's current data pipeline does **not** reverse-engineer rendered maps.

Conceptually:

```text
OSM raw data
    ↓
LocalTell builder
    ↓
TN.db
    ↓
Android offline resolver
```

not:

```text
map screenshot
    ↓
LocalTell
```

---

# 6. Licensing and attribution

OpenStreetMap data is published under the Open Data Commons Open Database License (ODbL).

OpenStreetMap requires attribution to OpenStreetMap and its contributors. Distribution of databases derived from OSM can also carry ODbL obligations.

Before releasing LocalTell geographic packs publicly, review:

```text
https://www.openstreetmap.org/copyright
```

A typical attribution is based on:

```text
© OpenStreetMap contributors
```

and should make the ODbL status clear as required by the applicable attribution guidance.

This document is technical guidance, not legal advice. Review the current OpenStreetMap licensing and attribution requirements before publishing derived databases.

---

# 7. Recommended working directory layout

The Git repository currently lives on the Windows-mounted filesystem:

```text
/mnt/c/AR_Files/code/localtell-data
```

Keep source code there.

For large OSM files and generated databases, use the WSL2 Linux filesystem:

```text
~/localtell-osm-work
```

Recommended structure:

```text
~/localtell-osm-work/
├── source/
│   ├── southern-zone-latest.osm.pbf
│   └── southern-zone-latest.osm.pbf.md5
│
└── output/
    └── TN.db
```

Create it with:

```bash
mkdir -p ~/localtell-osm-work/source
mkdir -p ~/localtell-osm-work/output
```

Why use the Linux filesystem for heavy data processing?

```text
Git/source code
    → /mnt/c is fine

large PBF + repeated parsing + DB generation
    → native WSL filesystem is preferred
```

This avoids unnecessary Windows/Linux filesystem crossing during large sequential reads and writes.

---

# 8. WSL2 disk-space note

WSL2 can show a large **logical virtual disk size** that is not the same as Windows physical free space.

For example:

```bash
df -h ~
```

may show:

```text
/dev/sdd
Size: ~1007G
Available: ~946G
```

This is the logical capacity of the WSL2 virtual filesystem.

Check the Windows C: drive separately:

```bash
df -h /mnt/c
```

In the verified setup:

```text
C:
476G total
173G used
303G available
```

The WSL2 virtual disk is backed by storage on Windows, so **Windows physical free space is the practical limit**.

Before a large download/build, check both:

```bash
df -h ~
df -h /mnt/c
free -h
```

---

# 9. Verified LocalTell environment before download

The tested environment was:

```text
Python:
3.11.16

pyosmium:
working

RAM:
7.6 GiB total
~6.5 GiB available at the time of test

Swap:
2 GiB

Windows free space:
~303 GB
```

Verify:

```bash
python --version
python -c "import osmium; print('pyosmium OK')"
df -h ~
df -h /mnt/c
free -h
```

---

# 10. Download the Southern Zone PBF

Use `curl` with resume and retry support:

```bash
curl -L --fail --retry 3 -C - \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
```

Options:

```text
-L
follow redirects

--fail
return failure on HTTP errors

--retry 3
retry transient failures up to three times

-C -
resume a partial download if possible

-o
choose the output filename
```

The verified download produced approximately:

```text
532M
```

Check:

```bash
ls -lh ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

Example verified result:

```text
-rw-r--r-- 1 actionanand actionanand 532M ... southern-zone-latest.osm.pbf
```

---

# 11. Download the MD5 checksum

Download the matching checksum file:

```bash
curl -L --fail \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5
```

---

# 12. Verify the downloaded PBF

Run:

```bash
cd ~/localtell-osm-work/source

md5sum -c southern-zone-latest.osm.pbf.md5
```

Expected:

```text
southern-zone-latest.osm.pbf: OK
```

The verified LocalTell download passed this check.

Return to the repo:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

Do not build from a file whose checksum fails.

If validation fails:

1. remove the corrupt PBF,
2. download it again,
3. download a fresh checksum file,
4. verify again.

Because the filename contains `latest`, the upstream file may change over time. If a partial download is resumed much later and the checksum fails, restart the download from scratch.

---

# 13. Current verified source-data status

During the first real setup, the following completed successfully:

```text
Downloaded:
southern-zone-latest.osm.pbf

Size:
~532 MB

Checksum:
OK
```

Location:

```text
/home/actionanand/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

This source file is now ready for the first real Tamil Nadu geographic-pack build.

---

# 14. Run repository tests before a real build

From:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

run:

```bash
python -m unittest discover -s tests -v
python -m py_compile scripts/*.py
```

Proceed only when tests and syntax checks pass.

---

# 15. Build the real Tamil Nadu schema-v3 database

Remove any previous experimental output:

```bash
rm -f ~/localtell-osm-work/output/TN.db
```

Run:

```bash
time python scripts/build_geographic_pack.py \
  --pbf ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  --output ~/localtell-osm-work/output/TN.db \
  --pack-id TN \
  --pack-name "Tamil Nadu" \
  --version 3 \
  --state-code IN-TN
```

Meaning:

```text
--pbf
input Southern Zone OSM data

--output
generated SQLite geographic pack

--pack-id TN
LocalTell pack identifier

--pack-name "Tamil Nadu"
display name

--version 3
schema-v3 geographic pack version

--state-code IN-TN
restrict output to Tamil Nadu
```

The builder identifies the Tamil Nadu level-4 administrative boundary and uses it as the pack extent.

---

# 16. Expected build concept

```text
Southern Zone .osm.pbf
        ↓
find administrative boundary
admin_level = 4
ISO3166-2 = IN-TN
        ↓
filter to Tamil Nadu
        ↓
extract named settlements
        ↓
extract admin hierarchy
        ↓
simplify usable geometry
        ↓
build RTree index
        ↓
TN.db
```

The schema-v3 pack contains geographic data, **not a nationwide Cell-ID table**.

---

# 17. What the builder extracts

The current architecture is interested in user-facing place types such as:

```text
neighbourhood
suburb
locality
hamlet
village
town
city
```

Administrative boundaries are retained to provide:

```text
state
district
sub-district / taluk
pack extent
```

India hierarchy currently follows:

```text
admin_level 4 → State / Union Territory
admin_level 5 → District
admin_level 6 → Subdistrict / Taluk / Tehsil
```

Administrative boundaries are not intended to become the displayed `Current locality`.

---

# 18. Inspect the generated DB

After the build:

```bash
ls -lh ~/localtell-osm-work/output/TN.db
```

Also:

```bash
du -h ~/localtell-osm-work/output/TN.db
```

Do not publish simply because the file was generated successfully.

It must pass validation and real coordinate tests first.

---

# 19. Validate TN.db

Run:

```bash
python scripts/validate_geographic_pack.py \
  ~/localtell-osm-work/output/TN.db \
  --expected-state-code IN-TN \
  --expected-pack-id TN
```

The validator checks schema-v3 requirements including:

- database integrity,
- required tables,
- pack metadata,
- `admin_level`,
- Tamil Nadu state code,
- level-4 pack boundary,
- geometry references,
- RTree consistency,
- supported geographic data.

Do not release a database that fails validation.

---

# 20. Test real locality resolution

Use:

```text
scripts/test_locality_lookup.py
```

General form:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat LATITUDE \
  --lon LONGITUDE
```

The lookup should mimic the Android schema-v3 resolver.

---

# 21. Suggested Tamil Nadu tests

## Known LocalTell/Kanyakumari test area

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.181910 \
  --lon 77.352330
```

This area is especially useful because LocalTell has already been tested there.

---

## Nagercoil area

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.1833 \
  --lon 77.4119
```

---

## Madurai

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 9.9252 \
  --lon 78.1198
```

---

## Coimbatore

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 11.0168 \
  --lon 76.9558
```

---

## Chennai

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 13.0827 \
  --lon 80.2707
```

---

# 22. Test an outside-pack coordinate

This is essential.

For example, test a coordinate in Kerala:

```bash
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.5241 \
  --lon 76.9366
```

Expected behavior:

```text
resolution_method: outside_pack
```

It must **not** return the nearest Tamil Nadu settlement.

This verifies that:

```text
TN.db
```

cannot incorrectly resolve coordinates belonging to another state.

---

# 23. How runtime state-pack selection works

Eventually a user may install:

```text
TN.db
KL.db
KA.db
...
```

The Android resolver can conceptually perform:

```text
GNSS coordinate
       ↓
TN level-4 boundary?
   no
       ↓
KL level-4 boundary?
   yes
       ↓
resolve locality from KL.db
```

Therefore every state pack needs a correct level-4 administrative boundary.

---

# 24. When to publish a geographic pack

Do not publish immediately after a successful build.

Use this gate:

```text
PBF checksum OK
        ↓
builder completed
        ↓
validator passed
        ↓
known local coordinates look correct
        ↓
large-city tests look correct
        ↓
rural tests look reasonable
        ↓
outside-state test returns outside_pack
        ↓
only then compress and release
```

---

# 25. Compress TN.db later

Only after validation:

```bash
gzip -c \
  ~/localtell-osm-work/output/TN.db \
  > ~/localtell-osm-work/output/TN.db.gz
```

Check:

```bash
ls -lh \
  ~/localtell-osm-work/output/TN.db \
  ~/localtell-osm-work/output/TN.db.gz
```

Do not perform this release step until the pack has been approved.

---

# 26. Why large source files are not committed to Git

Do not commit:

```text
*.osm.pbf
TN.db
large generated intermediates
work output
```

The source PBF is reproducible from the provider, and generated release assets should be distributed separately.

The repository should primarily contain:

```text
scripts/
tests/
documentation/
small verified metadata/source files where appropriate
```

Large runtime packs can be published as GitHub Release assets after validation.

---

# 27. Refreshing the OSM source in the future

OpenStreetMap changes continuously, so periodically refresh the source.

A simple refresh workflow is:

```bash
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5
```

Then download again:

```bash
curl -L --fail --retry 3 \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf

curl -L --fail \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5
```

Verify again:

```bash
cd ~/localtell-osm-work/source
md5sum -c southern-zone-latest.osm.pbf.md5
```

Then rebuild state packs.

A future pipeline may use Geofabrik `.osc.gz` change files for incremental updates, but the current process intentionally starts with full regional extracts because it is simpler and easier to validate.

---

# 28. Getting data for other areas

Start from the Geofabrik India page:

```text
https://download.geofabrik.de/asia/india.html
```

Choose the smallest available region that fully contains the target state.

The LocalTell builder can then filter the input using the corresponding state boundary/state code.

General strategy:

```text
provider regional extract
        ↓
state ISO3166-2 code
        ↓
LocalTell state pack
```

For Tamil Nadu:

```text
IN-TN
```

Do not assume every Indian state has a dedicated standalone PBF. A larger regional or India-wide extract can be used and filtered during the build.

---

# 29. When would the full India PBF be useful?

The India-wide extract may become useful when:

- building many/all state packs in one pipeline,
- running nationwide validation,
- avoiding overlap or missing coverage between regional source files,
- operating a centralized automated pack-generation service.

Current URL:

```text
https://download.geofabrik.de/asia/india-latest.osm.pbf
```

The India file is substantially larger than the Southern Zone PBF, so for early development and Tamil Nadu testing it is unnecessary overhead.

---

# 30. If a visual map is needed later

LocalTell currently needs geographic lookup rather than map rendering.

If a future version adds an offline visual map, possible technologies include:

```text
OSM data
  ↓
vector tile generation / provider
  ↓
MapLibre
  ↓
interactive map UI
```

That would be a separate feature from schema-v3 locality resolution.

Do not bundle a full map-rendering stack into the locality resolver merely to convert coordinates into place names.

---

# 31. Current LocalTell geographic architecture

The current design is:

```text
Cellular environment
        ↓
helps determine whether locality cache may be stale
        ↓
one-shot GNSS fix when needed
        ↓
phone latitude / longitude
        ↓
installed schema-v3 state pack
        ↓
state boundary check
        ↓
settlement polygon lookup
        ↓
nearest named settlement fallback
        ↓
Current locality
```

Cell IDs are **not** used as the primary geographic database key anymore.

---

# 32. Role of Cell ID after schema-v3

Cellular identity remains useful for:

- detecting a changed radio environment,
- helping invalidate a recent locality cache,
- reducing unnecessary GNSS fixes,
- cellular diagnostics,
- Journey-mode optimization.

It does not need to encode or map directly to geography.

This avoids maintaining an ever-growing nationwide Cell-ID database.

---

# 33. Cleanup

To inspect work directory size:

```bash
du -sh ~/localtell-osm-work
du -sh ~/localtell-osm-work/source
du -sh ~/localtell-osm-work/output
```

To remove only generated DB output:

```bash
rm -f ~/localtell-osm-work/output/TN.db
rm -f ~/localtell-osm-work/output/TN.db.gz
```

To remove downloaded OSM source later:

```bash
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5
```

Be careful before deleting the source because downloading it again can take several minutes and hundreds of megabytes of network transfer.

---

# 34. Quick reference — first real Tamil Nadu build

```bash
# Environment
cd /mnt/c/AR_Files/code/localtell-data
conda activate wsl2

# Verify Python
python --version
python -c "import osmium; print('pyosmium OK')"

# Tests
python -m unittest discover -s tests -v
python -m py_compile scripts/*.py

# WSL work folders
mkdir -p ~/localtell-osm-work/source
mkdir -p ~/localtell-osm-work/output

# Download
curl -L --fail --retry 3 -C - \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf

# Checksum
curl -L --fail \
  -o ~/localtell-osm-work/source/southern-zone-latest.osm.pbf.md5 \
  https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5

cd ~/localtell-osm-work/source
md5sum -c southern-zone-latest.osm.pbf.md5

# Return to repo
cd /mnt/c/AR_Files/code/localtell-data

# Build
rm -f ~/localtell-osm-work/output/TN.db

time python scripts/build_geographic_pack.py \
  --pbf ~/localtell-osm-work/source/southern-zone-latest.osm.pbf \
  --output ~/localtell-osm-work/output/TN.db \
  --pack-id TN \
  --pack-name "Tamil Nadu" \
  --version 3 \
  --state-code IN-TN

# Validate
python scripts/validate_geographic_pack.py \
  ~/localtell-osm-work/output/TN.db \
  --expected-state-code IN-TN \
  --expected-pack-id TN

# Known-area test
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.181910 \
  --lon 77.352330

# Outside-state test
python scripts/test_locality_lookup.py \
  ~/localtell-osm-work/output/TN.db \
  --lat 8.5241 \
  --lon 76.9366
```

---

# 35. Reference links

OpenStreetMap:

```text
https://www.openstreetmap.org/
```

OSM copyright/licensing:

```text
https://www.openstreetmap.org/copyright
```

Geofabrik download server:

```text
https://download.geofabrik.de/
```

Geofabrik India:

```text
https://download.geofabrik.de/asia/india.html
```

Geofabrik Southern Zone:

```text
https://download.geofabrik.de/asia/india/southern-zone.html
```

Southern Zone PBF:

```text
https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
```

Southern Zone checksum:

```text
https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf.md5
```

Full India PBF:

```text
https://download.geofabrik.de/asia/india-latest.osm.pbf
```

---

# 36. Current milestone

At the time this document was created:

```text
Conda/Python environment   ✅ ready
pyosmium                    ✅ ready
LocalTell geographic tests  ✅ passing
Southern Zone PBF           ✅ downloaded
PBF size                    ~532 MB
MD5 checksum                ✅ OK
Real TN.db build            ⏳ next step
```

The next action is therefore:

```text
Build real TN.db
→ validate
→ evaluate real OSM locality quality
→ only then prepare schema-v3 release assets
```
