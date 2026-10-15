# Sri Lanka geographic packs

India remains LocalTell's primary dataset. Sri Lanka uses a separate country
configuration, workspace, manifest (`manifest-LK.json`), and release tag
(`country-lk-v1`); it does not alter the India State/UT pipeline.

Source files are Geofabrik's current `sri-lanka-latest.osm.pbf` and matching
MD5 file, stored outside Git in `~/localtell-osm-work/countries/sri-lanka`.
Run `npm run data:lk:all` to download, inspect boundaries, build, validate,
package, and generate the country manifest. Publishing is deliberately absent.

## Safe workflow

The dedicated workspace is `~/localtell-osm-work/countries/sri-lanka`, never
the India workspace. `data:lk:download` streams Geofabrik's PBF and matching
MD5, verifies an existing source before it is reused, and atomically replaces
new downloads only after checksum verification. Run `data:lk:inspect` before
building: it reports usable province and district boundaries plus the configured
subdistrict policy.

`data:lk:build` parses the source once and creates all nine province DBs.
`data:lk:validate` checks metadata, schema, rings, coordinates, province
extent isolation, and hierarchy. `data:lk:package` revalidates each DB,
creates reproducible gzip assets, and reports the gzip SHA-256. Finally,
`data:lk:manifest` emits the deterministic country manifest. None of these
commands publish a release.

If Geofabrik publishes an update, rerun download (or `--force`) followed by
inspection and the normal workflow. Future countries can add an independent
configuration and workspace under `config/countries/` without changing India.

Troubleshoot failed inspection by checking `ISO3166-2`, named assembled level-4
relations, and the downloaded PBF checksum; never substitute names or `ref:IN`.

Packs are LK-1 through LK-9, one per province. Level 4 is the province pack
boundary and level 5 is an ISO-approved district. Subdistrict is intentionally
unavailable and is not populated: levels 6–8 were inspected but are incomplete
or inconsistent for Sri Lanka. Future countries add their own configuration
under `config/countries/`; do not assume this hierarchy.

Sri Lanka administrative boundaries prefer OSM `name:en`, falling back to
`name`; settlements and localities retain ordinary `name`. `ISO3166-2` remains
the authoritative Province/District identity rather than a display name.
