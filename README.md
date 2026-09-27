# LocalTell Data

Offline cellular locality data packs for LocalTell.

Runtime packs are distributed through GitHub Releases rather than committed to Git history.

## Tamil Nadu schema-v3 geographic pack

The schema-v3 pack resolves a GNSS coordinate against offline OpenStreetMap
geometries, then falls back to the nearest named settlement.  The older cellular
research files remain in this repository for reference; they are not an input to
this pipeline.

Install the one non-standard Python dependency (the SQLite support is in Python):

```sh
python3 -m pip install osmium
```

Acquire a Tamil Nadu extract (or an India extract) from an OSM extract provider
and keep it outside Git, for example at `source/osm/tamil-nadu.osm.pbf`.  Then:

```sh
python3 scripts/build_geographic_pack.py --pbf source/osm/tamil-nadu.osm.pbf --output output/TN.db --pack-id TN --pack-name "Tamil Nadu" --version 3
python3 scripts/validate_geographic_pack.py output/TN.db
python3 scripts/test_locality_lookup.py output/TN.db --lat 8.18300 --lon 77.34500
gzip -k output/TN.db
```

Use the resulting database (and, if the release process requires it, its gzip
asset) to build the repository's release manifest, review the assets, and publish
a GitHub Release manually.  The scripts never download data or publish releases.

The builder accepts OSM `place` nodes/ways/relations for `city`, `town`,
`village`, `hamlet`, `suburb`, `neighbourhood`, and `locality`; it also retains
named administrative boundaries for hierarchy context.  Administrative polygons
are used to populate state, district, and taluk/sub-district fields when a place
has a representative coordinate.  Polygon geometry is stored as simplified,
explicitly closed latitude/longitude rings, with one outer ring per geometry row.
