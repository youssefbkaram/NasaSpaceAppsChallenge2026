# Input and standardized data schema

## Source discovery

The pipeline searches country folders for filenames of the form
`fire_archive_<product>.csv`, `fire_nrt_<product>.csv`, and the corresponding
point-shapefile names. Product identity is retained from the FIRMS product
directory and filename. When both CSV and shapefile extracts exist for the
same country/product/quality, the CSV is used to avoid processing the same
download twice.

Input CSV column matching is case-insensitive. Known FIRMS fields are mapped to
standard names, while the complete original row is retained in
`source_attributes_json`. Unknown fields are reported rather than silently
discarded. The `type` field is optional. Missing fields are nullable; no values
are synthesized.

## Standardized observation fields

| Field | Meaning |
|---|---|
| `observation_id` | Deterministic SHA-256 identifier from relative source path and source row number. |
| `source_file`, `source_row_number` | Exact source file and row provenance. |
| `source_product`, `country`, `quality` | Product directory, country folder, and `SP`/`NRT` processing class. |
| `latitude`, `longitude` | WGS84 source coordinates. |
| `equal_area_x_m`, `equal_area_y_m` | Coordinates in EPSG:6933 for grid and distance calculations. |
| `acquisition_date`, `acquisition_time`, `acquisition_datetime_utc` | Original date/time fields and parsed UTC timestamp when valid. |
| `satellite`, `satellite_original` | Canonical platform name and unmodified source platform value. |
| `sensor`, `instrument` | Platform-level sensor key (for example `MODIS_TERRA` or `VIIRS_NOAA20`) and source instrument. |
| `confidence`, `confidence_original`, `confidence_numeric` | Original confidence representation, retained verbatim; numeric parse only when possible. |
| `frp`, `brightness_temperature`, `bright_t31`, `scan`, `track` | FIRMS numeric measurements and footprint attributes, nullable when absent/invalid. |
| `daynight`, `version`, `fire_type` | Source day/night, product version, and optional FIRMS fire type. |
| `validation_status`, `validation_reasons` | `valid`, `review`, or `invalid`, with one or more reasons. All source rows are kept. |
| `boundary_check_status` | Boundary-validation result or explicit reason no boundary check could be done. |
| `duplicate_record` | Exact duplicate flag within country/product/quality; duplicates remain in output. |
| `source_attributes_json` | Original row values keyed by their original column names. |

`confidence_numeric` being null for VIIRS categorical values is intentional;
the original categorical label remains in `confidence_original`.

## Missing versus zero

The source files contain detections, not a sensor coverage calendar. A missing
country/sensor/month row cannot be interpreted as zero detections or as no
fire. Aggregation outputs therefore include only observed detection groups,
and calendar periods without records use `no_observation_records_coverage_unknown`.
Sensor-specific count columns remain null when the files contain no detections
for that sensor-period.
