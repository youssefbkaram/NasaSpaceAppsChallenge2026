# Scientific methodology and limitations

## Raw preservation and quality control

Original FIRMS files are read-only inputs. Every standardized observation
retains its source path, row number, product, country folder, processing class,
original source attributes, and an observation identifier. Coordinate, date,
time, FRP, satellite, instrument, confidence-format, and optional country
boundary checks flag records; they do not delete them. Exact duplicate source
rows are flagged within country/product/quality, but remain in the output.
Repeated detections over time and cross-sensor spatial proximity are not
deduplicated.

The grid uses WGS84 coordinates transformed to EPSG:6933, a global
equal-area projected CRS. Sensor-specific daily and weekly metrics are
calculated at 1 km, 5 km, and 10 km. MODIS Terra/Aqua and the three VIIRS
platforms are kept separate. FRP and confidence summaries retain the
sensor-specific scale. Spatial-temporal matching uses configurable distance
and acquisition-time thresholds; the reported match score is a heuristic
proximity score, not a probability.

## First harmonization baseline

The initial model compares a Poisson baseline with a Negative Binomial GLM for
monthly country/sensor counts. Predictors include sensor family (MODIS or
VIIRS), country, seasonal sine/cosine terms, and year. Processing quality and
individual spacecraft are retained as source metadata, but are not model
predictors: future holdouts may contain a new quality class or spacecraft with
no training support. The Negative Binomial dispersion parameter is initialized
by a documented method-of-moments estimate from the Poisson residuals. The
target output is a **shared relative activity index**, not a reference-sensor
count. The index is produced only for
country-months with positive detections from both MODIS and VIIRS families;
family predictions are combined geometrically and scaled to a global
geometric mean of 100. Separate raw sensor counts remain in the same output.

Temporal holdout evaluation uses later months. A country-level spatial holdout
is also reported as a coarse geographic generalization check. The model
diagnostics include Poisson and Negative Binomial AIC, holdout MAE/RMSE,
calibration ratio, fitted dispersion, and recorded warnings. Grid-size and
matching-threshold sensitivity outputs are retained separately.

## Mandatory interpretation limits

- FIRMS detections alone do not provide overpass opportunity, usable-observation
  coverage, cloud/scan exposure, or valid-observation area. The optional
  `firms-coverage` path adds daily FireMask classified pixel-days from NASA
  MODIS/VIIRS products as a coverage proxy; it does not count overpasses.
- A FireMask class-5 or class-7/8/9 pixel is counted as a valid land pixel-day.
  Fire classes 7-9 are the numerator and classes 5 and 7-9 are the denominator
  for a sensor-specific classified-fire pixel-day fraction. Cloud, water,
  unknown, missing, and not-processed classes are retained separately rather
  than treated as valid non-fire observations. Encoded fill value 255 is
  counted separately and excluded from both numerator and denominator.
- These are daily product composites. They do not expose the number of
  independent observations within the day, and a pixel classified as fire is
  not a unique fire. The fraction is not a detection probability or corrected
  FIRMS hotspot count.
- Daily products from multiple spacecraft are not interchangeable replicates:
  spacecraft/platform and product provenance must remain separate. A
  cross-sensor calibration still needs a defined overlapping reference period,
  spatial/temporal holdouts, uncertainty estimates, and independent validation.
- The FireMask reader has unit tests for class accounting, grid assignment,
  date parsing, and AOI checks, but has not yet been validated against an
  authenticated real HDF4/HDF5 granule. Its output must not yet be presented as
  a scientifically validated harmonized dataset.
- No non-detection records are available. Missing sensor/months are not
  converted to zero, and no detection count is interpreted as fire absence.
- The model is fitted to positive records in months with detections from both
  sensor families. Selection on detected activity and unknown exposure can
  bias its estimates.
- The index is exploratory and is not a corrected absolute count, a detection
  probability, or a validated cross-sensor harmonization product. Its
  confidence intervals do not account for unknown exposure or selection bias.
- MODIS numeric confidence and VIIRS categorical confidence are not
  interchangeable and are not used as equivalent weights.
- A FIRMS hotspot is an active-fire/thermal-anomaly detection, not necessarily
  a unique fire. Spatial-temporal candidate matches do not establish common
  event identity.
- FIRMS NRT is provisional. Archive and NRT provenance remains explicit.
- There are no independent burned-area observations or environmental
  covariates in the supplied folders. Burned area, if later added, must be
  treated as a different measurement rather than ground truth for detection
  counts.
- The web map's "All detections (raw)" option overlays original FIRMS records;
  it is not the coverage-aware product. The UI does not yet consume
  `firms-coverage` output or display a calibrated harmonized layer.

## Further validation required before scientific claims

Authenticate and process representative real granules first; verify their
metadata, date indexing, geotransforms, pixel classes, and alignment with an
authoritative AOI. Then evaluate sensor-by-country and sensor-by-land-cover
effects; test confidence filtering without equating confidence scales; run
spatial and temporal validation at the grid-cell level; compare 1/5/10 km
outcomes; investigate observation-time differences; and, where appropriate,
compare against independent burned-area products as a distinct outcome. No
claim of successful harmonization should be made until these tests are
completed.
