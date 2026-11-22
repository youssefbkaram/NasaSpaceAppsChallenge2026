# PSR B0531+21 FIRMS harmonization pipeline

This repository contains the React/Vite explorer and a local Python pipeline for
processing the supplied NASA FIRMS MODIS and VIIRS active-fire detections. The
Python pipeline preserves source files and produces sensor-specific aggregates,
candidate cross-sensor matches, diagnostics, and an explicitly exploratory
monthly relative activity index.

## Current input inventory

The supplied `data/` directory contains 16 country folders:

- Egypt: extracted MODIS and VIIRS point shapefiles.
- Algeria, Bolivia, Brazil, Colombia, Ecuador, Guyana, Libya, Mauritania,
  Morocco, Paraguay, Peru, Suriname, Sudan, Tunisia, and Venezuela: FIRMS CSV
  downloads.
- There are 118 CSV files across the 15 CSV-based country folders. Brazil has no
  Suomi-NPP VIIRS download.

The CSVs use the FIRMS fields `latitude`, `longitude`, `brightness`, `scan`,
`track`, `acq_date`, `acq_time`, `satellite`, `instrument`, `confidence`,
`version`, `bright_t31`, `frp`, and `daynight`; `type` is present in some files
and absent in others. MODIS confidence is numeric while VIIRS confidence uses
categories; these values are retained separately and are never treated as
equivalent scales. Archive (`SP`) and near-real-time (`NRT`) records remain
distinguishable. FIRMS record date ranges do not establish that observations
were available on every intervening date.

See the measured [input data inventory](./docs/data-inventory.md) for
per-country record counts, supplied date spans, sensor availability, schema
variants, and the scope of the initial quality scan.

## Fast read-only map data service

The map can use a compact Parquet dataset and a read-only DuckDB API instead of
scanning the source CSVs on every request. Build the dataset from the untouched
FIRMS downloads (the output is partitioned by country and year):

```powershell
python -m firms_harmonization.web_data `
  --input-dir data `
  --output-dir data\web-parquet
```

The full build reads all supplied FIRMS inputs and can take time. It does not
modify the source files; choose a new output directory for each build. Start the
API with:

```powershell
$env:FIRMS_WEB_DATA_DIR = "data\web-parquet"
python -m firms_harmonization.web_api
```

The API listens on port 8000 by default. It accepts the same
`/api/local-firms/data?region=...&date=YYYY-MM-DD&days=...` request as the Vite
development endpoint, streams gzip-compressed JSON, and allows at most two
concurrent DuckDB queries by default. Set `FIRMS_ALLOWED_ORIGINS` to a
comma-separated list of exact frontend origins when the frontend is hosted on a
different domain. Set `VITE_LOCAL_FIRMS_API_URL` to the API's public base URL
before building that frontend; leave it empty for a same-origin deployment.
This service only implements the FIRMS data API. The existing AI and monthly
analytics Vite proxies still need their own server-side equivalents for a
production deployment.

For a no-monthly-fee deployment, an OCI Always Free VM can run the API and keep
the Parquet files on its attached disk. The VM, operating system, TLS/reverse
proxy, updates, and backups are self-managed; free compute availability and
uptime are not guaranteed. Do not expose port 8000 directly to the internet:
put a TLS reverse proxy in front of it and allow only the frontend origin.

Deployment templates and the OCI service configuration are in
[deploy/README.md](./deploy/README.md).

### No-card static hosting option

The map's local FIRMS mode can also query the public Parquet files directly in
the browser using DuckDB-Wasm. This avoids a database, API server, and payment
verification. GitHub Pages can host the frontend; a public Hugging Face Dataset
repository can host the 1.228 GiB Parquet dataset. Hugging Face describes public
storage as best-effort, not a guaranteed free capacity or uptime commitment, so
this route is a practical experiment rather than a hosting guarantee. The data
repository must be public, and its files are downloaded by visitors as needed.
Do not upload credentials or private data.

The existing local dataset can be indexed without repeating the 68-million-row
conversion:

```powershell
python -m firms_harmonization.web_data `
  --output-dir data\web-parquet `
  --index-existing
```

The uploaded public dataset is
[`youssefbkaram/nasa-firms-parquet`](https://huggingface.co/datasets/youssefbkaram/nasa-firms-parquet).
Keep these large Parquet files out of Git. For a different dataset, create a
**public Dataset** on Hugging Face, authenticate locally with `hf auth login`,
then upload the dataset directory:

```powershell
hf upload YOUR_HF_USERNAME/firms-data data\web-parquet . --repo-type dataset
```

The Pages workflow is configured with the public dataset URL, so no Actions
secret or variable is needed. Enable GitHub Pages with **GitHub Actions** as its
source, then push to `main` or run the `Deploy static explorer` workflow
manually. The workflow builds the frontend only; the large Parquet files stay
in the Hugging Face repository. For local builds, set
`VITE_FIRMS_PARQUET_BASE_URL` to the same public URL in `frontend/.env.local`.
It is a public data URL, not a secret.

The browser downloads DuckDB-Wasm from jsDelivr and queries only date-overlapping
country/year Parquet partitions; Parquet range reads avoid downloading whole
partitions. The uploaded manifest and an actual Parquet file were verified;
Hugging Face returned HTTP 206 for a byte-range request with CORS enabled, and
a browser query against an uploaded Egypt partition returned observations.
GitHub Pages itself has not yet been deployed. Hugging Face public storage is
best-effort, not a guaranteed free capacity or uptime commitment. The existing
`/api/ai/analyze` and `/api/harmonized/monthly` Vite proxies are not available
on GitHub Pages; those AI and monthly analytics paths still require a backend
and are intentionally not exposed with browser-side secrets.

## Run the pipeline

Python 3.11 or newer is required. From the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
.\.venv\Scripts\python.exe -m firms_harmonization.cli
```

By default, the pipeline reads the supplied `data/` directory and creates a
timestamped, new output directory under `data/processed/`. It never moves or
modifies the original NASA downloads. Output run directories are intentionally
not overwritten; rerun with a new `--output-dir`.

To run a smaller country subset while testing:

```powershell
.\.venv\Scripts\python.exe -m firms_harmonization.cli `
  --countries Suriname `
  --output-dir data\processed\suriname-test
```

To use a JSON configuration, copy
[`configs/firms_pipeline.example.json`](./configs/firms_pipeline.example.json),
set a new output directory, and run:

```powershell
.\.venv\Scripts\python.exe -m firms_harmonization.cli `
  --config configs\firms_pipeline.example.json
```

Additional CLI options include `--exclude-nrt`, `--skip-matching`,
`--skip-model`, and `--log-level DEBUG`. A supplied country-boundary polygon
file can be configured with `country_boundaries`; observations outside their
country polygon are flagged, not removed.

## Output layers

Each run directory contains:

- `validated/`: per-source validation and schema reports plus chunked records
  retaining original source attributes and row provenance.
- `standardized/observations/`: the complete normalized Parquet dataset,
  partitioned by country and acquisition year. Invalid and duplicate rows are
  retained with flags.
- `aggregated/`: daily and weekly sensor-specific grids at 1, 5, and 10 km,
  monthly sensor counts, and a country-month calendar. No raw MODIS and VIIRS
  counts are added together. Months without records are marked as having
  unknown observation coverage; absent sensor counts stay null.
- `matched/`: spatial-temporal candidate pairs at configured distance/time
  thresholds, plus records with no candidate among temporally contemporaneous
  detections. A match is not proof of one fire event and never deletes either
  observation.
- `harmonized/`: country-month shared relative activity index, when the model
  has enough overlapping support, with raw sensor counts and model intervals.
- `reports/`: validation, sensor comparisons, matching sensitivity, temporal
  and country holdout metrics, model assumptions, plots, and a run manifest.

Detailed field definitions are in
[`docs/input-data-schema.md`](./docs/input-data-schema.md); methodological
assumptions and limitations are in
[`docs/scientific-methodology.md`](./docs/scientific-methodology.md).

## Experimental FireMask coverage inputs

The optional `firms-coverage` reader obtains daily MODIS/VIIRS FireMask
products and summarizes their documented pixel classes on a common EPSG:6933
grid. This is an input for future coverage-aware calibration, **not** a
validated harmonized layer or a corrected FIRMS detection count. It requires a
WGS84 country/AOI Polygon GeoJSON; the FIRMS point files are not country
boundaries.

Create the isolated GDAL environment from the project root:

```powershell
micromamba env create -f environment-coverage.yml
```

Obtain an Earthdata Login token from NASA and set it only in the current local
PowerShell session (never paste it into chat, a file, or source control):

```powershell
$env:EARTHDATA_TOKEN = "<your NASA Earthdata token>"
```

Then run a small test interval with the real AOI GeoJSON:

```powershell
micromamba run -n firms-harmonization-coverage python -m firms_harmonization.coverage_data `
  --aoi path\to\egypt-boundary.geojson `
  --data-dir data\firemask-cache `
  --output data\coverage\egypt-firemask-test.csv `
  --start 2024-01-01 --end 2024-01-07 `
  --country Egypt --products MOD14A1 MYD14A1 VNP14A1 VJ114A1 VJ214A1 `
  --download
```

The CSV is paired with a `.manifest.json` provenance file. Run a small
representative test and inspect both outputs before requesting a long time
series. The product records daily classified pixel-days, not overpass counts;
missing rows are unknown coverage, not zero fire activity. The web map does
not yet read this output.

## Important scientific limit

The supplied FIRMS detections do not include satellite observation opportunity,
valid-observation area, cloud/scan coverage, or another exposure denominator.
They also do not include country-boundary polygons (the Egypt shapefiles are
point detections, not boundaries). Therefore the negative-binomial output is
an exploratory **shared relative activity index** fit only on country-months
where both sensor families have detections. It is not a corrected absolute
fire count, a detection probability, a unique-fire estimate, or proof that
harmonization is successful. Its diagnostics and uncertainty do not account for
unknown sensor exposure.

The website does not yet read these Python pipeline outputs; it continues to
show the selected raw FIRMS observations. Do not interpret existing demo
calendar, analytics, anomaly, or forecasting panels as results from this
pipeline.
