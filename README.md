# LocalTell Data

Offline cellular locality data packs for LocalTell.

Runtime packs are distributed through GitHub Releases rather than committed to Git history.

## WSL2 state-pack automation

Schema version is fixed at SQLite schema-v3; each state has a separate pack
version. Adding a state remains part of the cell-data-v3 release and does not
create a new release generation. Configure states in config/india-packs.json;
large inputs and outputs live under ~/localtell-osm-work.

```sh
conda activate wsl2
npm run data:build -- KL
npm run data:validate -- KL
npm run data:package -- KL
npm run data:manifest
npm run data:publish
```

The npm commands are thin wrappers over Python scripts. Publishing is the only
command that contacts GitHub. Cleanup previews by default; pass --confirm only
after independently verifying published assets.

## Tamil Nadu schema-v3 geographic pack

The schema-v3 pack resolves a GNSS coordinate against offline OpenStreetMap
geometries, then falls back to the nearest named settlement.  The older cellular
research files remain in this repository for reference; they are not an input to
this pipeline.

Install the one non-standard Python dependency (the SQLite support is in Python):

```sh
python3 -m pip install osmium
```

LocalTell does not need a Tamil-Nadu-specific download. Acquire a larger Southern
India extract and keep it outside Git; the builder finds the OSM
`boundary=administrative`, `admin_level=4`, `ISO3166-2=IN-TN` boundary and filters
the pack to Tamil Nadu.

```sh
python3 scripts/build_geographic_pack.py \
  --pbf source/osm/southern-zone-latest.osm.pbf \
  --output output/TN.db \
  --pack-id TN \
  --pack-name "Tamil Nadu" \
  --version 3 \
  --state-code IN-TN
python3 scripts/validate_geographic_pack.py output/TN.db --expected-state-code IN-TN --expected-pack-id TN
python3 scripts/test_locality_lookup.py output/TN.db --lat 8.18300 --lon 77.34500
gzip -k output/TN.db
```

Use the resulting database (and, if the release process requires it, its gzip
asset) to build the repository's release manifest, review the assets, and publish
a GitHub Release manually.  The scripts never download data or publish releases.

The builder accepts OSM `place` nodes/ways/relations for `city`, `town`,
`village`, `hamlet`, `suburb`, `neighbourhood`, and `locality`; it also retains
named administrative boundaries for hierarchy context. The schema-v3 `place`
table persists OSM `admin_level`: level 4 state/UT boundaries define the pack
extent, level 5 is district, and level 6 is taluk/subdistrict. India mapping is level 4
state/UT, level 5 district, and level 6 taluk/subdistrict. Polygon geometry is
simplified at the documented default 0.00015 degrees and explicitly closed.
Multipolygon outer rings become separate rows. Inner holes are not encoded because
the current Android single-ring point-in-polygon contract cannot represent them.

Before lookup, the resolver confirms the coordinate is inside a level-4 state
boundary. Outside coordinates return no result from that pack. Polygon matches
are deterministic: neighbourhood, suburb, locality, hamlet, village, town, city.
Administrative boundaries are extent/hierarchy data only. Nearest fallback accepts
only those seven settlement types and uses Haversine distance.
