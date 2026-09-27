# LocalTell — Geographic Data Workspace Cleanup Guide

This guide explains how to safely clean LocalTell geographic build artifacts **after the corresponding packs have been validated, published to GitHub Releases, and verified by downloading the published assets and comparing SHA-256 hashes**.

The cleanup targets only generated/downloaded workspace data under:

```text
~/localtell-osm-work
```

It does **not** delete source code, configuration, documentation, tests, or published GitHub Release assets.

---

## 1. When cleanup is safe

Cleanup is appropriate only after all of the following are true:

```text
[ ] State/UT packs built successfully
[ ] npm run data:validate passed
[ ] npm run data:package passed
[ ] Locality and outside_pack tests passed
[ ] manifest.json was generated
[ ] GitHub Release publish succeeded
[ ] Published manifest hash matched the local manifest
[ ] Published .db.gz hashes matched the locally packaged files
```

For the current South India rollout, these checks were completed for:

```text
TN — Tamil Nadu
KL — Kerala
KA — Karnataka
AP — Andhra Pradesh
TS — Telangana
PY — Puducherry
```

Release:

```text
cell-data-v3
```

---

## 2. What can be deleted

After successful publication and verification, the following local files are reproducible and can be removed.

### Geofabrik source PBF

```text
~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

This is the large downloaded build source.

Delete it only when no further South India pack rebuild is planned immediately.

It can be downloaded again later when another rebuild or refresh is required.

---

### Generated SQLite databases

```text
~/localtell-osm-work/output/TN.db
~/localtell-osm-work/output/KL.db
~/localtell-osm-work/output/KA.db
~/localtell-osm-work/output/AP.db
~/localtell-osm-work/output/TS.db
~/localtell-osm-work/output/PY.db
```

These are generated runtime databases.

---

### Generated compressed packages

```text
~/localtell-osm-work/output/TN.db.gz
~/localtell-osm-work/output/KL.db.gz
~/localtell-osm-work/output/KA.db.gz
~/localtell-osm-work/output/AP.db.gz
~/localtell-osm-work/output/TS.db.gz
~/localtell-osm-work/output/PY.db.gz
```

These are already published to GitHub Releases and can be regenerated from the `.db` files during a future build.

---

### Published-verification downloads

If the release was downloaded locally for hash comparison, these copies can also be removed:

```text
~/localtell-osm-work/release-test/published/
```

---

### Generated release-test manifest

After publication and verification, the generated local manifest can also be removed:

```text
~/localtell-osm-work/release-test/manifest.json
```

The published copy remains available from GitHub Releases.

---

## 3. What must NOT be deleted

Do not delete the repository or its reusable tooling.

Keep:

```text
localtell-data/
├── config/
├── documentation/
├── scripts/
├── tests/
├── README.md
└── package.json
```

In particular, keep:

```text
config/india-packs.json
scripts/build_geographic_pack.py
scripts/build_state.py
scripts/validate_state.py
scripts/package_state.py
scripts/generate_manifest.py
scripts/publish_release.py
scripts/test_locality_lookup.py
```

These files are needed to recreate the data later.

---

## 4. Inspect before deleting

First inspect the workspace:

```bash
du -sh ~/localtell-osm-work/*
```

Inspect the South source:

```bash
ls -lh ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

Inspect generated packs:

```bash
ls -lh ~/localtell-osm-work/output/{TN,KL,KA,AP,TS,PY}.db*
```

Inspect release-test files:

```bash
find ~/localtell-osm-work/release-test -maxdepth 2 -type f -print
```

---

## 5. Safe explicit cleanup for the current South India rollout

The following commands remove only the current South India source and generated South India artifacts.

### Delete the Geofabrik Southern Zone source

```bash
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

### Delete generated South India databases and gzip packages

```bash
rm -f \
  ~/localtell-osm-work/output/TN.db \
  ~/localtell-osm-work/output/TN.db.gz \
  ~/localtell-osm-work/output/KL.db \
  ~/localtell-osm-work/output/KL.db.gz \
  ~/localtell-osm-work/output/KA.db \
  ~/localtell-osm-work/output/KA.db.gz \
  ~/localtell-osm-work/output/AP.db \
  ~/localtell-osm-work/output/AP.db.gz \
  ~/localtell-osm-work/output/TS.db \
  ~/localtell-osm-work/output/TS.db.gz \
  ~/localtell-osm-work/output/PY.db \
  ~/localtell-osm-work/output/PY.db.gz
```

### Delete published verification downloads

```bash
rm -rf ~/localtell-osm-work/release-test/published
```

### Delete the generated local manifest

```bash
rm -f ~/localtell-osm-work/release-test/manifest.json
```

---

## 6. One command block

After reviewing the paths carefully, the current South India workspace can be cleaned with:

```bash
rm -f ~/localtell-osm-work/source/southern-zone-latest.osm.pbf

rm -f \
  ~/localtell-osm-work/output/TN.db \
  ~/localtell-osm-work/output/TN.db.gz \
  ~/localtell-osm-work/output/KL.db \
  ~/localtell-osm-work/output/KL.db.gz \
  ~/localtell-osm-work/output/KA.db \
  ~/localtell-osm-work/output/KA.db.gz \
  ~/localtell-osm-work/output/AP.db \
  ~/localtell-osm-work/output/AP.db.gz \
  ~/localtell-osm-work/output/TS.db \
  ~/localtell-osm-work/output/TS.db.gz \
  ~/localtell-osm-work/output/PY.db \
  ~/localtell-osm-work/output/PY.db.gz

rm -rf ~/localtell-osm-work/release-test/published
rm -f ~/localtell-osm-work/release-test/manifest.json
```

This intentionally leaves the workspace directories themselves in place.

---

## 7. Verify cleanup

Run:

```bash
find ~/localtell-osm-work -maxdepth 2 -type f -print
```

For the cleaned South India rollout, you should no longer see:

```text
southern-zone-latest.osm.pbf

TN.db
TN.db.gz

KL.db
KL.db.gz

KA.db
KA.db.gz

AP.db
AP.db.gz

TS.db
TS.db.gz

PY.db
PY.db.gz
```

Check remaining disk usage:

```bash
du -sh ~/localtell-osm-work
```

---

## 8. Keep the directory structure

It is useful to keep the empty workspace layout:

```text
~/localtell-osm-work/
├── source/
├── output/
└── release-test/
```

If necessary:

```bash
mkdir -p \
  ~/localtell-osm-work/source \
  ~/localtell-osm-work/output \
  ~/localtell-osm-work/release-test
```

---

## 9. Rebuilding South India later

When a future OSM refresh is required:

```text
Download fresh Southern Zone PBF
        ↓
place it under source/
        ↓
build required state
        ↓
validate
        ↓
package
        ↓
test
        ↓
publish changed packs
```

The expected source location remains:

```text
~/localtell-osm-work/source/southern-zone-latest.osm.pbf
```

Example state build:

```bash
npm run data:build -- KA
npm run data:validate -- KA
npm run data:package -- KA
```

---

## 10. Existing cleanup automation

The repository also provides:

```bash
npm run data:cleanup
```

The cleanup command is designed to preview cleanup work first.

When using the automation, review the preview carefully before executing the confirmed cleanup mode.

For release-specific cleanup, explicit commands such as those in this document are useful when only one completed region should be removed while other regional work remains in the workspace.

---

## 11. Recommended rule

Treat the workspace as disposable build data:

```text
Repository
    = permanent source code and configuration

GitHub Release
    = permanent published pack distribution

~/localtell-osm-work
    = temporary/reproducible build workspace
```

Once a release is published and independently verified, old PBF files and generated DB artifacts do not need to be retained locally unless an immediate rebuild is planned.
