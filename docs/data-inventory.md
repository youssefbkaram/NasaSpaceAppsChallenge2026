# FIRMS input data inventory

Inventory performed on 2026-11-15 against the local `data/` directory. The
original downloads were not modified. Counts below describe the supplied files,
not independent fires or complete daily observation coverage.

## Input footprint

The repository has 16 country folders. The input discovery code finds 126
processable files: 118 FIRMS CSVs for 15 countries and eight Egypt point
shapefiles. The folders also contain 63 downloaded ZIP archives; those archives
are not read directly by the pipeline. The selected CSVs total 67,459,686
records (5,462,118,017 bytes). The Egypt point shapefiles contain another
890,963 records. Together these inputs hold 68,350,649 detection records.

The supplied countries are not a global sample. They comprise countries in
South America and North Africa. FIRMS country archives are clipped to their
country areas, so offshore detections may be omitted. No country-boundary
polygon is included; the Egypt shapefiles are point observations, not a country
boundary. The valid point coordinates span approximately 91.66°W to 38.45°E
and 33.74°S to 37.34°N, a bounding rectangle across these separated country
groups rather than continuous geographic coverage.

## Records by country

CSV counts were scanned from every row. Egypt counts are from shapefile feature
metadata. Date values are the minimum and maximum observation dates found, not
proof that every day in between has data.

| Country | Records | Formats | First date | Last date |
|---|---:|---|---|---|
| Algeria | 2,794,282 | CSV | 2000-11-01 | 2026-11-14 |
| Bolivia | 10,321,122 | CSV | 2000-11-01 | 2026-11-14 |
| Brazil | 26,526,206 | CSV | 2000-11-01 | 2026-11-14 |
| Colombia | 3,499,890 | CSV | 2000-11-01 | 2026-11-14 |
| Ecuador | 597,944 | CSV | 2000-11-01 | 2026-11-14 |
| Egypt | 890,963 | point SHP | 2000-11-02 | 2026-11-13 |
| Guyana | 395,580 | CSV | 2000-11-01 | 2026-11-14 |
| Libya | 1,343,760 | CSV | 2000-11-02 | 2026-11-14 |
| Mauritania | 90,426 | CSV | 2000-11-01 | 2026-11-14 |
| Morocco | 78,464 | CSV | 2000-12-10 | 2026-11-14 |
| Paraguay | 4,465,882 | CSV | 2000-11-01 | 2026-11-14 |
| Peru | 2,439,271 | CSV | 2000-11-01 | 2026-11-14 |
| Sudan | 6,118,232 | CSV | 2000-11-01 | 2026-11-14 |
| Suriname | 120,954 | CSV | 2000-11-01 | 2026-11-14 |
| Tunisia | 108,312 | CSV | 2001-02-01 | 2026-11-14 |
| Venezuela | 8,559,361 | CSV | 2000-11-01 | 2026-11-14 |

## Sensor and platform coverage

CSV platform totals below include the 15 CSV-based countries. Egypt counts are
shown separately because its data are shapefiles.

| Platform/product family | CSV records | Egypt records | Earliest date | Latest date |
|---|---:|---:|---|---|
| MODIS Terra + Aqua (`M-C61`) | 16,990,555 | 35,371 | 2000-11-01 | 2026-11-14 |
| VIIRS Suomi-NPP (`SV-C2`) | 17,844,991 | 490,425 | 2012-01-20 | 2026-11-02 |
| VIIRS NOAA-20 (`J1V-C2`) | 22,893,454 | 262,563 | 2018-04-01 | 2026-11-14 |
| VIIRS NOAA-21 (`J2V-C2`) | 9,730,686 | 102,604 | 2023-03-01 | 2026-11-14 |

Brazil has no Suomi-NPP VIIRS input. Terra and Aqua are both represented in
the MODIS product files and remain separate in the source satellite field.
Suomi-NPP records stop on 2026-11-02 in these downloads; this inventory does
not infer observations beyond the last supplied record.

The CSV inputs contain 65,200,992 archive (`SP`) and 2,258,694 near-real-time
(`NRT`) records. Egypt contains 865,509 archive and 25,454 NRT records. The
product/source fields and quality labels must remain separate; NRT is
provisional. Archive and NRT date ranges do not overlap within the same
country/product in the supplied CSVs, based on their per-file date ranges.

## Schema and value checks

CSV archive files have the fields `latitude`, `longitude`, `brightness`,
`scan`, `track`, `acq_date`, `acq_time`, `satellite`, `instrument`,
`confidence`, `version`, `bright_t31`, `frp`, `daynight`, and `type`.
Near-real-time CSV headers omit `type` (59 files contain it; 59 do not).
Egypt shapefiles have equivalent uppercase DBF fields; `TYPE` is absent from
the NRT shapefiles. Their declared CRS is WGS 84 / EPSG:4326.

The full CSV scan found:

- No missing or out-of-range latitude/longitude values.
- No invalid or missing acquisition dates or times.
- No missing or non-numeric FRP values.
- Two negative FRP values, both in Brazil's MODIS archive; retain and flag
  these for source-level review rather than silently deleting them.
- 11,433 zero-FRP values. Zero values are retained and should be inspected
  against the source product semantics.
- MODIS confidence values are numeric; VIIRS confidence is categorical
  (`l`, `n`, `h`). No confidence values outside those sensor-specific formats
  were found in the CSV scan. The scales are not interchangeable.
- `daynight` values are `D` and `N` in the scanned CSV rows.

The CSV scan checked coordinate/date/time/FRP syntax and confidence categories.
It did not perform a full exact-duplicate pass or range diagnostics for
brightness, scan, and track. The existing standardization stage can flag exact
source-row duplicates while retaining them; that stage has not been run on all
68 million supplied records. A separate exact-attribute check found no
duplicate rows within any of the eight Egypt shapefiles. The Egypt shapefile
counts and date/platform metadata were inspected, but the same full
value-quality scan was not run on their attributes.

## Interpretation and readiness

- The date spans are historical records from 2000 through November 2026 for
  MODIS, with later start dates for each VIIRS platform. They do **not** prove
  complete, gap-free daily coverage.
- FIRMS hotspots are active-fire detections, not unique fires. The files do
  not contain non-detection records, overpass opportunity, cloud exposure, or
  valid observation area. An absent row/day cannot be interpreted as zero fire.
- The project has existing validation, standardization, sensor-specific
  aggregation, matching, calendar, and exploratory-model modules. Existing
  processed all-country outputs were not found; the checked-in local processed
  run is for Suriname only.
- An exploratory relative activity index is not a validated harmonized count.
  The map's combined sensor option is a raw-detection overlay.
- The experimental FireMask path has unit tests, but no authenticated real
  MODIS/VIIRS HDF granule has been processed. No Earthdata token or Egypt
  boundary AOI is configured locally, so FireMask-based calibration and an
  Egypt-specific coverage grid remain unverified.

The next required validation step is a full duplicate and field-range audit
followed by chunked standardization of all sources. Coverage-aware modeling
should wait until representative real FireMask granules and an authoritative
AOI have been validated.
