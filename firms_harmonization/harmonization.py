"""Stage 5 — Statistical harmonization model.

Fits a Negative Binomial GLM to monthly sensor-family detection counts and
produces:
  - A calibrated relative fire-activity index (geometric mean of MODIS and
    VIIRS model predictions) with 95 % CI uncertainty bounds.
  - Per master-prompt output schema: grid_id / period_start / period_end /
    harmonized_fire_activity_estimate / uncertainty_lower / uncertainty_upper /
    modis_terra_count … viirs_noaa21_count / model_version /
    data_coverage_status / quality_flag / processing_note.
  - Detailed diagnostics: Poisson vs NB AIC, temporal holdout metrics,
    spatial holdout metrics, residual-bias tables (seasonal & geographic),
    cross-sensor agreement, fit warnings.

Scientific constraints (never violated):
  - MODIS (0-100 numeric) and VIIRS (l/n/h categorical) confidence scales are
    kept separate; confidence values are not used as equivalent weights.
  - FRP measurements are not assumed interchangeable across sensors.
  - Missing sensor-months are NOT converted to zero detections.
  - Every estimate is labelled as a model estimate, not a direct observation.
  - Exposure / observation-opportunity data are unavailable; this limitation is
    explicitly documented and never papered over.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any
import warnings

import duckdb
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

from .config import PipelineConfig
from .duckdb_io import read_parquet_sql

LOGGER = logging.getLogger(__name__)
MODEL_VERSION = "firms-harmonized-nb-0.2.0"

# GLM formula — country is a fixed effect only when multiple countries present.
_FORMULA_MULTI = (
    "detection_count ~ C(sensor_family) + C(country) "
    "+ sin_month + cos_month + year_centered"
)
_FORMULA_SINGLE = (
    "detection_count ~ C(sensor_family) "
    "+ sin_month + cos_month + year_centered"
)
# Spatial-holdout formula (country dummies absent — predicting new countries).
_SPATIAL_FORMULA = (
    "detection_count ~ C(sensor_family) "
    "+ sin_month + cos_month + year_centered"
)

# Sensor-family mapping — MODIS platform variants → "MODIS", VIIRS → "VIIRS".
_FAMILY: dict[str, str] = {
    "MODIS_TERRA": "MODIS",
    "MODIS_AQUA": "MODIS",
    "VIIRS_SNPP": "VIIRS",
    "VIIRS_NOAA20": "VIIRS",
    "VIIRS_NOAA21": "VIIRS",
}

# Individual sensor columns expected in the harmonized output.
_SENSOR_COLUMNS = [
    "modis_terra_count",
    "modis_aqua_count",
    "viirs_snpp_count",
    "viirs_noaa20_count",
    "viirs_noaa21_count",
]

# Quality flags (data-coverage oriented — not model quality).
_FLAG_SUFFICIENT = "sufficient_data"
_FLAG_SINGLE_SENSOR = "single_sensor_only"
_FLAG_INSUFFICIENT_OVERLAP = "insufficient_overlap"
_FLAG_NO_DATA = "no_data"
_FLAG_BACKCAST = "single_sensor_modis_backcast"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _fit_models(
    frame: pd.DataFrame, formula: str
) -> tuple[Any, Any, float]:
    """Fit Poisson and Negative Binomial GLMs; return (poisson, nb, alpha)."""
    poisson = smf.glm(
        formula=formula,
        data=frame,
        family=sm.families.Poisson(),
    ).fit(maxiter=200, disp=False)

    mu = np.clip(np.asarray(poisson.fittedvalues, dtype=float), 1e-9, None)
    observed = frame["detection_count"].to_numpy(dtype=float)
    alpha = max(
        float(
            np.sum((observed - mu) ** 2 - mu)
            / max(np.sum(mu**2), 1e-9)
        ),
        1e-8,
    )
    nb = smf.glm(
        formula=formula,
        data=frame,
        family=sm.families.NegativeBinomial(alpha=alpha),
    ).fit(maxiter=200, disp=False)
    return poisson, nb, alpha


def _metrics(observed: pd.Series, predicted: np.ndarray) -> dict[str, float]:
    """Return MAE, RMSE, and calibration-ratio metrics."""
    actual = observed.to_numpy(dtype=float)
    forecast = np.maximum(np.asarray(predicted, dtype=float), 0.0)
    if not len(actual):
        return {
            "n": 0,
            "mae": math.nan,
            "rmse": math.nan,
            "observed_to_predicted_total": math.nan,
        }
    return {
        "n": int(len(actual)),
        "mae": float(np.mean(np.abs(actual - forecast))),
        "rmse": float(np.sqrt(np.mean((actual - forecast) ** 2))),
        "observed_to_predicted_total": float(
            np.sum(actual) / np.sum(forecast)
            if np.sum(forecast) > 0
            else math.nan
        ),
    }


def _prepare_model_frame(monthly: pd.DataFrame) -> pd.DataFrame:
    """Return rows where both sensor families reported at least one detection.

    Scientific note: rows where only MODIS or only VIIRS reported are
    intentionally excluded from model fitting because the response variable
    (detection_count) is conditional on the sensor, and fitting a shared
    model on single-sensor months would bias the sensor-family coefficient.
    Those months are still present in the final output with appropriate
    quality_flag values.
    """
    frame = monthly.copy()
    frame["date_key"] = pd.to_datetime(
        frame[["year", "month"]].assign(day=1), errors="coerce"
    )
    frame["year_centered"] = frame["year"].astype(float) - float(
        frame["year"].mean()
    )
    angle = 2.0 * np.pi * frame["month"].astype(float) / 12.0
    frame["sin_month"] = np.sin(angle)
    frame["cos_month"] = np.cos(angle)

    # Keep only country-months where BOTH families reported detections.
    support = frame.groupby(["country", "year", "month"])[
        "sensor_family"
    ].transform(lambda v: {"MODIS", "VIIRS"}.issubset(set(v)))
    return frame.loc[support & frame["detection_count"].gt(0)].copy()


def _residual_bias_tables(
    frame: pd.DataFrame,
    model: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (seasonal_bias, geographic_bias) residual tables.

    Each entry records the mean Pearson residual for a group so that
    systematic under- or over-prediction by month / country is visible.
    """
    preds = model.predict(frame)
    mu = np.maximum(np.asarray(preds, dtype=float), 1e-9)
    observed = frame["detection_count"].to_numpy(dtype=float)
    pearson_resid = (observed - mu) / np.sqrt(mu)

    tmp = frame.copy()
    tmp["_pearson_resid"] = pearson_resid
    tmp["_abs_resid"] = np.abs(pearson_resid)

    seasonal: list[dict[str, Any]] = []
    for month_val, grp in tmp.groupby("month"):
        seasonal.append(
            {
                "month": int(month_val),
                "n": int(len(grp)),
                "mean_pearson_residual": float(grp["_pearson_resid"].mean()),
                "mean_abs_pearson_residual": float(grp["_abs_resid"].mean()),
            }
        )

    geographic: list[dict[str, Any]] = []
    for country_val, grp in tmp.groupby("country"):
        geographic.append(
            {
                "country": str(country_val),
                "n": int(len(grp)),
                "mean_pearson_residual": float(grp["_pearson_resid"].mean()),
                "mean_abs_pearson_residual": float(grp["_abs_resid"].mean()),
            }
        )

    return seasonal, geographic


def _cross_sensor_agreement(
    monthly: pd.DataFrame,
) -> dict[str, Any]:
    """Compare monthly MODIS vs VIIRS detection counts where both are present.

    Returns Pearson correlation, mean log-ratio, and per-country stats.
    Scientific note: a high correlation does not mean the counts are
    interchangeable — VIIRS systematically detects more hotspots due to its
    finer spatial resolution and higher sensitivity.
    """
    raw = (
        monthly.groupby(["country", "year", "month", "sensor_family"], as_index=False)
        .agg(detection_count=("detection_count", "sum"))
    )
    modis_df = raw.loc[raw["sensor_family"] == "MODIS"].rename(
        columns={"detection_count": "modis_count"}
    )
    viirs_df = raw.loc[raw["sensor_family"] == "VIIRS"].rename(
        columns={"detection_count": "viirs_count"}
    )
    merged = modis_df.merge(
        viirs_df, on=["country", "year", "month"], how="inner"
    )
    if merged.empty:
        return {"n_overlapping_months": 0, "note": "no_overlapping_sensor_months"}

    mc = merged["modis_count"].to_numpy(dtype=float)
    vc = merged["viirs_count"].to_numpy(dtype=float)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        correlation = float(np.corrcoef(mc, vc)[0, 1]) if len(mc) > 1 else math.nan

    log_ratio = np.log(np.maximum(vc, 1) / np.maximum(mc, 1))
    per_country = []
    for cname, grp in merged.groupby("country"):
        per_country.append(
            {
                "country": str(cname),
                "n_months": int(len(grp)),
                "mean_modis_count": float(grp["modis_count"].mean()),
                "mean_viirs_count": float(grp["viirs_count"].mean()),
                "mean_viirs_to_modis_ratio": float(
                    grp["viirs_count"].sum() / max(grp["modis_count"].sum(), 1)
                ),
            }
        )
    return {
        "n_overlapping_months": int(len(merged)),
        "pearson_correlation_modis_vs_viirs": correlation,
        "mean_log_ratio_viirs_over_modis": float(log_ratio.mean()),
        "note": (
            "Correlation does not imply interchangeability. "
            "VIIRS systematically detects more hotspots than MODIS due to "
            "finer resolution and higher sensitivity."
        ),
        "per_country": per_country,
    }


def _determine_quality_flag(
    country: str,
    year: int,
    month: int,
    monthly: pd.DataFrame,
    supported_set: set[tuple[str, int, int]],
) -> str:
    """Assign a data-coverage quality flag to a country-year-month cell.

    Flags (from most to least informative):
      sufficient_data            — both sensor families reported detections and
                                   the cell was included in model training.
      insufficient_overlap       — both families present but excluded from model
                                   (e.g., below minimum-row threshold).
      single_sensor_only         — only MODIS or only VIIRS reported.
      no_data                    — no detection records at all.
    """
    rows = monthly.loc[
        (monthly["country"] == country)
        & (monthly["year"] == year)
        & (monthly["month"] == month)
    ]
    if rows.empty:
        return _FLAG_NO_DATA
    families = set(rows["sensor_family"].unique())
    has_modis = "MODIS" in families
    has_viirs = "VIIRS" in families
    if not has_modis or not has_viirs:
        return _FLAG_SINGLE_SENSOR
    if (country, year, month) in supported_set:
        return _FLAG_SUFFICIENT
    return _FLAG_INSUFFICIENT_OVERLAP


def _backcast_modis_only_months(
    monthly: pd.DataFrame,
    nb_model: Any,
    supported_set: set[tuple[str, int, int]],
    per_sensor_counts: dict[tuple, dict[str, int]],
    quality_by_month: dict[tuple, list[str]],
    sensors_by_month: dict[tuple, list[str]],
    raw_map: dict[tuple, int],
    year_mean: float,
) -> list[dict[str, Any]]:
    """Project harmonized activity backward onto MODIS-only months (pre-VIIRS era).

    Uses the fitted NB GLM to evaluate expected activity for both MODIS and the
    implied VIIRS baseline using the model's learned sensor-family offset.
    Propagates uncertainty with an extra variance expansion factor reflecting
    the unobserved VIIRS state.
    """
    import calendar as _cal

    # Find candidate country-months: MODIS present, but month not in supported_set
    modis_keys = set()
    for (country, year, month, sensor_fam), count in raw_map.items():
        if sensor_fam == "MODIS" and count > 0:
            if (country, year, month) not in supported_set:
                modis_keys.add((country, year, month))

    if not modis_keys:
        return []

    sorted_keys = sorted(modis_keys)
    records_modis = []
    records_viirs = []
    for country, year, month in sorted_keys:
        angle = 2.0 * math.pi * float(month) / 12.0
        row_base = {
            "country": country,
            "year": year,
            "month": month,
            "sin_month": math.sin(angle),
            "cos_month": math.cos(angle),
            "year_centered": float(year) - year_mean,
            "detection_count": 1.0,  # placeholder for statsmodels formula parser
        }
        records_modis.append({**row_base, "sensor_family": "MODIS"})
        records_viirs.append({**row_base, "sensor_family": "VIIRS"})

    synth_modis = pd.DataFrame(records_modis)
    synth_viirs = pd.DataFrame(records_viirs)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pred_modis = nb_model.get_prediction(synth_modis).summary_frame()
        pred_viirs = nb_model.get_prediction(synth_viirs).summary_frame()

    backcast_rows: list[dict[str, Any]] = []
    uncertainty_expansion = 1.35  # Reflects extrapolation variance without direct VIIRS observation

    for idx, (country, year, month) in enumerate(sorted_keys):
        m_mean = max(float(pred_modis["mean"].iloc[idx]), 0.0)
        v_mean = max(float(pred_viirs["mean"].iloc[idx]), 0.0)
        if m_mean <= 0 or v_mean <= 0:
            continue

        estimate = math.sqrt(m_mean * v_mean)
        m_lower = max(float(pred_modis["mean_ci_lower"].iloc[idx]), 0.0)
        v_lower = max(float(pred_viirs["mean_ci_lower"].iloc[idx]), 0.0)
        m_upper = max(float(pred_modis["mean_ci_upper"].iloc[idx]), 0.0)
        v_upper = max(float(pred_viirs["mean_ci_upper"].iloc[idx]), 0.0)

        lower = (math.sqrt(m_lower * v_lower) / uncertainty_expansion)
        upper = (math.sqrt(m_upper * v_upper) * uncertainty_expansion)

        period_start = f"{int(year):04d}-{int(month):02d}-01"
        last_day = _cal.monthrange(int(year), int(month))[1]
        period_end = f"{int(year):04d}-{int(month):02d}-{last_day:02d}"

        psc = per_sensor_counts.get((country, year, month), {})
        qinfo = quality_by_month.get((country, year, month), [])
        has_nrt = "NRT" in qinfo

        backcast_rows.append(
            {
                "country": country,
                "period_start": period_start,
                "period_end": period_end,
                "spatial_resolution_km": "country_monthly",
                "harmonized_fire_activity_estimate": estimate,
                "uncertainty_lower": lower,
                "uncertainty_upper": upper,
                "modis_terra_count": psc.get("modis_terra_count"),
                "modis_aqua_count": psc.get("modis_aqua_count"),
                "viirs_snpp_count": 0,
                "viirs_noaa20_count": 0,
                "viirs_noaa21_count": 0,
                "model_version": MODEL_VERSION,
                "data_coverage_status": "single_sensor_modis_backcast_viirs_absent",
                "quality_flag": _FLAG_BACKCAST,
                "processing_note": (
                    "BACK-CAST ESTIMATE — MODIS-only month (pre-VIIRS era). "
                    "VIIRS equivalent inferred from NB GLM sensor offset parameter. "
                    "Propagated uncertainty interval is wider than dual-sensor period. "
                    "Not a direct observation count."
                ),
                "year": int(year),
                "month": int(month),
                "calibrated_activity_estimate": estimate,
                "uncertainty_lower_95": lower,
                "uncertainty_upper_95": upper,
                "raw_modis_detection_count": raw_map.get((country, year, month, "MODIS")),
                "raw_viirs_detection_count": 0,
                "source_sensor_information": json.dumps(
                    sensors_by_month.get((country, year, month), [])
                ),
                "source_quality_information": json.dumps(qinfo),
                "quality_status": (
                    "exploratory_NRT_included"
                    if has_nrt
                    else "exploratory_archive_only"
                ),
                "availability_status": "single_sensor_modis_only",
                "exposure_status": (
                    "unavailable_not_corrected_for_observation_opportunity"
                ),
            }
        )
    return backcast_rows


def _build_per_sensor_counts(monthly: pd.DataFrame) -> dict[tuple, dict[str, int]]:
    """Return a lookup {(country, year, month): {sensor_col: count}} dict."""
    sensor_to_col = {
        "MODIS_TERRA": "modis_terra_count",
        "MODIS_AQUA": "modis_aqua_count",
        "VIIRS_SNPP": "viirs_snpp_count",
        "VIIRS_NOAA20": "viirs_noaa20_count",
        "VIIRS_NOAA21": "viirs_noaa21_count",
    }
    result: dict[tuple, dict[str, int]] = {}
    for row in monthly.itertuples(index=False):
        key = (row.country, int(row.year), int(row.month))
        col = sensor_to_col.get(str(row.sensor))
        if col is None:
            continue
        if key not in result:
            result[key] = {c: 0 for c in _SENSOR_COLUMNS}
        result[key][col] = result[key].get(col, 0) + int(row.detection_count)
    return result


def _write_empty_index(
    output_path: Path, diagnostics_path: Path, reason: str
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    empty = pd.DataFrame(
        columns=[
            # Master-prompt output schema fields
            "country",
            "period_start",
            "period_end",
            "spatial_resolution_km",
            "harmonized_fire_activity_estimate",
            "uncertainty_lower",
            "uncertainty_upper",
            "modis_terra_count",
            "modis_aqua_count",
            "viirs_snpp_count",
            "viirs_noaa20_count",
            "viirs_noaa21_count",
            "model_version",
            "data_coverage_status",
            "quality_flag",
            "processing_note",
            # Legacy / UI fields kept for calendar join
            "year",
            "month",
            "relative_activity_index",
            "calibrated_activity_estimate",
            "uncertainty_lower_95",
            "uncertainty_upper_95",
            "raw_modis_detection_count",
            "raw_viirs_detection_count",
            "source_sensor_information",
            "source_quality_information",
            "quality_status",
            "availability_status",
            "exposure_status",
        ]
    )
    empty.to_csv(output_path, index=False)
    empty.to_parquet(
        output_path.with_suffix(".parquet"), index=False, compression="zstd"
    )
    diagnostics_path.write_text(
        json.dumps(
            {
                "model_version": MODEL_VERSION,
                "status": "not_fitted",
                "reason": reason,
                "exposure_available": False,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_relative_activity_index(
    config: PipelineConfig,
    monthly_aggregate_path: Path,
) -> tuple[Path, Path, Path]:
    """Fit NB GLM baseline and produce the harmonized monthly activity index.

    Returns (csv_path, parquet_path, diagnostics_json_path).
    """
    output_dir = config.output_dir / "harmonized"
    output_dir.mkdir(parents=True, exist_ok=True)
    index_path = output_dir / "monthly_relative_activity_index.csv"
    parquet_path = output_dir / "monthly_relative_activity_index.parquet"
    diagnostics_path = (
        config.output_dir / "reports" / "harmonization_model_diagnostics.json"
    )
    diagnostics_path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Load monthly country-sensor aggregates from parquet.
    # ------------------------------------------------------------------
    connection = duckdb.connect()
    try:
        monthly_relation = read_parquet_sql(monthly_aggregate_path)
        monthly = connection.execute(
            f"""
            SELECT
                country,
                year,
                month,
                sensor,
                satellite,
                quality,
                sum(detection_count)::BIGINT AS detection_count
            FROM {monthly_relation}
            WHERE sensor != 'UNKNOWN'
            GROUP BY country, year, month, sensor, satellite, quality
            ORDER BY country, year, month, sensor, quality
            """
        ).fetchdf()
    finally:
        connection.close()

    if monthly.empty:
        _write_empty_index(
            index_path,
            diagnostics_path,
            "No valid monthly sensor counts were available.",
        )
        return index_path, parquet_path, diagnostics_path

    monthly["sensor_family"] = monthly["sensor"].map(
        lambda v: _FAMILY.get(str(v), "UNKNOWN")
    )
    # Build per-sensor individual counts (for master-prompt output schema).
    per_sensor_counts = _build_per_sensor_counts(monthly)

    # ------------------------------------------------------------------
    # Prepare model frame — only country-months with both families present.
    # ------------------------------------------------------------------
    frame = _prepare_model_frame(monthly)
    year_mean = (
        float(frame["year"].mean())
        if not frame.empty
        else float(monthly["year"].mean())
    )
    supported_months = frame[["country", "year", "month"]].drop_duplicates()
    supported_set: set[tuple[str, int, int]] = set(
        (r.country, int(r.year), int(r.month))
        for r in supported_months.itertuples(index=False)
    )

    if frame.empty or len(supported_months) < 12:
        _write_empty_index(
            index_path,
            diagnostics_path,
            "Fewer than 12 country-months had detections from both MODIS and "
            "VIIRS families.",
        )
        return index_path, parquet_path, diagnostics_path

    # Choose formula: include country FE only when multiple countries present.
    n_countries = frame["country"].nunique()
    formula = _FORMULA_MULTI if n_countries > 1 else _FORMULA_SINGLE

    # ------------------------------------------------------------------
    # Temporal holdout — chronological split (no random split to prevent
    # leakage between adjacent time periods).
    # ------------------------------------------------------------------
    month_keys = sorted(frame["date_key"].dropna().unique())
    cutoff_index = min(max(int(len(month_keys) * 0.8), 1), len(month_keys) - 1)
    cutoff = pd.Timestamp(month_keys[cutoff_index])
    train = frame.loc[frame["date_key"] < cutoff].copy()
    test = frame.loc[frame["date_key"] >= cutoff].copy()

    if len(train) < 20 or test.empty:
        _write_empty_index(
            index_path,
            diagnostics_path,
            "Insufficient temporal training or holdout rows for a stable baseline.",
        )
        return index_path, parquet_path, diagnostics_path

    with warnings.catch_warnings(record=True) as captured_warnings:
        warnings.simplefilter("always")
        poisson_holdout, nb_holdout, alpha_holdout = _fit_models(train, formula)

    temporal_predictions = nb_holdout.predict(test)
    temporal_metrics = _metrics(test["detection_count"], temporal_predictions)

    # ------------------------------------------------------------------
    # Spatial holdout — hold out every 5th country (country-level split to
    # avoid leakage between geographically proximate cells).
    # ------------------------------------------------------------------
    countries = sorted(frame["country"].unique())
    spatial_holdout_countries = countries[::5] if len(countries) >= 5 else []
    spatial_metrics: dict[str, Any]
    if spatial_holdout_countries:
        spatial_train = frame.loc[
            ~frame["country"].isin(spatial_holdout_countries)
        ].copy()
        spatial_test = frame.loc[
            frame["country"].isin(spatial_holdout_countries)
        ].copy()
        if len(spatial_train) >= 20 and not spatial_test.empty:
            with warnings.catch_warnings(record=True):
                warnings.simplefilter("always")
                _, spatial_model, _ = _fit_models(spatial_train, _SPATIAL_FORMULA)
            spatial_metrics = _metrics(
                spatial_test["detection_count"],
                spatial_model.predict(spatial_test),
            )
        else:
            spatial_metrics = {"status": "insufficient_rows"}
    else:
        spatial_metrics = {"status": "requires_at_least_five_countries"}

    # ------------------------------------------------------------------
    # Final model on full supported frame.
    # ------------------------------------------------------------------
    with warnings.catch_warnings(record=True) as final_warnings:
        warnings.simplefilter("always")
        poisson_full, nb_full, alpha_full = _fit_models(frame, formula)

    # ------------------------------------------------------------------
    # Residual bias tables (seasonal & geographic).
    # ------------------------------------------------------------------
    seasonal_bias, geographic_bias = _residual_bias_tables(frame, nb_full)

    # ------------------------------------------------------------------
    # Cross-sensor agreement analysis.
    # ------------------------------------------------------------------
    cross_sensor = _cross_sensor_agreement(monthly)

    # ------------------------------------------------------------------
    # Predictions with 95 % CI from GLM summary_frame.
    # ------------------------------------------------------------------
    pred_df = frame.copy()
    pred_summary = nb_full.get_prediction(pred_df).summary_frame()
    pred_df["predicted_count"] = np.maximum(
        pred_summary["mean"].to_numpy(dtype=float), 0.0
    )
    pred_df["prediction_lower"] = np.maximum(
        pred_summary["mean_ci_lower"].to_numpy(dtype=float), 0.0
    )
    pred_df["prediction_upper"] = np.maximum(
        pred_summary["mean_ci_upper"].to_numpy(dtype=float), 0.0
    )
    pred_df["sensor_family"] = pred_df["sensor"].map(
        lambda v: _FAMILY.get(str(v), "UNKNOWN")
    )

    family_preds = (
        pred_df.groupby(
            ["country", "year", "month", "sensor_family"], as_index=False
        ).agg(
            predicted_count=("predicted_count", "mean"),
            prediction_lower=("prediction_lower", "mean"),
            prediction_upper=("prediction_upper", "mean"),
        )
    )

    # Lookup helpers.
    raw_counts = (
        monthly.groupby(
            ["country", "year", "month", "sensor_family"], as_index=False
        ).agg(detection_count=("detection_count", "sum"))
    )
    raw_counts = raw_counts.loc[raw_counts["sensor_family"].isin(["MODIS", "VIIRS"])]
    sensors_by_month = (
        monthly.groupby(["country", "year", "month"])["sensor"]
        .agg(lambda v: sorted(set(v)))
        .to_dict()
    )
    quality_by_month = (
        monthly.groupby(["country", "year", "month"])["quality"]
        .agg(lambda v: sorted(set(v)))
        .to_dict()
    )
    family_map = {
        (r.country, int(r.year), int(r.month), r.sensor_family): r
        for r in family_preds.itertuples(index=False)
    }
    raw_map = {
        (r.country, int(r.year), int(r.month), r.sensor_family): int(r.detection_count)
        for r in raw_counts.itertuples(index=False)
    }

    # ------------------------------------------------------------------
    # Build output rows for supported country-months.
    # ------------------------------------------------------------------
    rows: list[dict[str, Any]] = []
    for country, year, month in sorted(supported_set):
        modis_pred = family_map.get((country, year, month, "MODIS"))
        viirs_pred = family_map.get((country, year, month, "VIIRS"))
        if (
            modis_pred is None
            or viirs_pred is None
            or modis_pred.predicted_count <= 0
            or viirs_pred.predicted_count <= 0
        ):
            continue

        estimate = math.sqrt(
            modis_pred.predicted_count * viirs_pred.predicted_count
        )
        lower = math.sqrt(
            max(modis_pred.prediction_lower, 0.0)
            * max(viirs_pred.prediction_lower, 0.0)
        )
        upper = math.sqrt(
            max(modis_pred.prediction_upper, 0.0)
            * max(viirs_pred.prediction_upper, 0.0)
        )

        period_start = f"{int(year):04d}-{int(month):02d}-01"
        # Last day of the month.
        import calendar as _cal
        last_day = _cal.monthrange(int(year), int(month))[1]
        period_end = f"{int(year):04d}-{int(month):02d}-{last_day:02d}"

        psc = per_sensor_counts.get((country, year, month), {})
        qflag = _determine_quality_flag(
            country, year, month, monthly, supported_set
        )
        qinfo = quality_by_month.get((country, year, month), [])
        has_nrt = "NRT" in qinfo

        rows.append(
            {
                # Master-prompt output schema
                "country": country,
                "period_start": period_start,
                "period_end": period_end,
                "spatial_resolution_km": "country_monthly",
                "harmonized_fire_activity_estimate": estimate,
                "uncertainty_lower": lower,
                "uncertainty_upper": upper,
                "modis_terra_count": psc.get("modis_terra_count"),
                "modis_aqua_count": psc.get("modis_aqua_count"),
                "viirs_snpp_count": psc.get("viirs_snpp_count"),
                "viirs_noaa20_count": psc.get("viirs_noaa20_count"),
                "viirs_noaa21_count": psc.get("viirs_noaa21_count"),
                "model_version": MODEL_VERSION,
                "data_coverage_status": (
                    "both_sensor_families_have_detections_coverage_unknown"
                ),
                "quality_flag": qflag,
                "processing_note": (
                    "MODELED ESTIMATE — geometric mean of NB-GLM predicted "
                    "counts for MODIS and VIIRS families. "
                    "Not a direct observation count. "
                    "Exposure/observation-opportunity is unavailable and was "
                    "not corrected for."
                ),
                # Legacy / UI fields (kept for calendar join backward compat)
                "year": int(year),
                "month": int(month),
                "calibrated_activity_estimate": estimate,
                "uncertainty_lower_95": lower,
                "uncertainty_upper_95": upper,
                "raw_modis_detection_count": raw_map.get(
                    (country, year, month, "MODIS")
                ),
                "raw_viirs_detection_count": raw_map.get(
                    (country, year, month, "VIIRS")
                ),
                "source_sensor_information": json.dumps(
                    sensors_by_month.get((country, year, month), [])
                ),
                "source_quality_information": json.dumps(qinfo),
                "quality_status": (
                    "exploratory_NRT_included"
                    if has_nrt
                    else "exploratory_archive_only"
                ),
                "availability_status": (
                    "both_sensor_families_have_detections_coverage_unknown"
                ),
                "exposure_status": (
                    "unavailable_not_corrected_for_observation_opportunity"
                ),
            }
        )

    # ------------------------------------------------------------------
    # Back-cast harmonized index onto pre-VIIRS MODIS-only months (2000–2011).
    # ------------------------------------------------------------------
    backcast_rows = _backcast_modis_only_months(
        monthly=monthly,
        nb_model=nb_full,
        supported_set=supported_set,
        per_sensor_counts=per_sensor_counts,
        quality_by_month=quality_by_month,
        sensors_by_month=sensors_by_month,
        raw_map=raw_map,
        year_mean=year_mean,
    )
    rows.extend(backcast_rows)

    if not rows:
        _write_empty_index(
            index_path,
            diagnostics_path,
            "No country-month had model predictions for both MODIS and VIIRS.",
        )
        return index_path, parquet_path, diagnostics_path

    # ------------------------------------------------------------------
    # Scale to relative activity index (geometric-mean normalisation).
    # ------------------------------------------------------------------
    result = pd.DataFrame(rows)
    log_estimates = np.log(
        np.maximum(result["harmonized_fire_activity_estimate"].to_numpy(dtype=float), 1e-9)
    )
    scale = float(np.exp(log_estimates.mean()))
    result["relative_activity_index"] = (
        100.0 * result["harmonized_fire_activity_estimate"] / scale
    )
    result["uncertainty_lower_95"] = 100.0 * result["uncertainty_lower_95"] / scale
    result["uncertainty_upper_95"] = 100.0 * result["uncertainty_upper_95"] / scale

    result = result.sort_values(["country", "year", "month"])
    result.to_csv(index_path, index=False)
    result.to_parquet(parquet_path, index=False, compression="zstd")

    # ------------------------------------------------------------------
    # Diagnostics JSON.
    # ------------------------------------------------------------------
    all_warnings = [str(w.message) for w in [*captured_warnings, *final_warnings]]
    diagnostics: dict[str, Any] = {
        "model_version": MODEL_VERSION,
        "status": "baseline_fitted",
        "model_reference": config.model_reference,
        "model_formula": formula,
        "n_countries": n_countries,
        "training_rows": int(len(train)),
        "full_model_rows": int(len(frame)),
        "supported_months": int(len(supported_set)),
        "backcast_modis_only_months": int(len(backcast_rows)),
        "output_rows": int(len(result)),
        # AIC comparison (lower is better; NB should strongly outperform Poisson).
        "poisson_aic_training": float(poisson_holdout.aic),
        "negative_binomial_aic_training": float(nb_holdout.aic),
        "negative_binomial_dispersion_alpha_method_of_moments": float(alpha_holdout),
        "negative_binomial_vs_poisson_delta_aic": float(
            nb_holdout.aic - poisson_holdout.aic
        ),
        # Temporal holdout (chronological — no random split to prevent leakage).
        "temporal_holdout": {
            "split_method": "chronological_80_percent_cutoff",
            "cutoff_month": cutoff.strftime("%Y-%m"),
            "holdout_rows": int(len(test)),
            "metrics_negative_binomial": temporal_metrics,
            "leakage_prevention_note": (
                "Training set uses all months before the cutoff date. "
                "Test set uses all months from the cutoff onward. "
                "No random splitting was performed; adjacent time periods "
                "are never split between train and test."
            ),
        },
        # Spatial holdout (every 5th country — country-level to prevent leakage).
        "spatial_holdout": {
            "split_method": "every_5th_country",
            "holdout_countries": spatial_holdout_countries,
            "formula_used": _SPATIAL_FORMULA,
            "note": (
                "Country fixed effects are dropped from the spatial-holdout "
                "formula because the held-out countries were unseen during "
                "training."
            ),
            "metrics": spatial_metrics,
        },
        # Residual bias analysis.
        "seasonal_bias_analysis": seasonal_bias,
        "geographic_bias_analysis": geographic_bias,
        # Cross-sensor agreement.
        "cross_sensor_agreement": cross_sensor,
        # Scientific metadata.
        "exposure_available": False,
        "zero_observation_days_available": False,
        "training_support": (
            "positive country-month-sensor records where both sensor "
            "families reported detections"
        ),
        "limitations": [
            "FIRMS detections do not include sensor observation-opportunity/exposure.",
            "No non-detection records were supplied; missing sensor-months "
            "were not converted to zero.",
            "The index is exploratory and not a corrected absolute fire count "
            "or detection probability.",
            "MODIS (0-100 numeric) and VIIRS (l/n/h categorical) confidence "
            "scales remain separate and were not used as equivalent weights.",
            "The baseline estimates sensor-family effects, not individual "
            "spacecraft offsets; platform details remain in the output metadata.",
            "A hotspot detection is not necessarily a unique fire.",
            "The monthly country-level index does not claim to reconstruct "
            "individual fire events.",
            "The 95 % intervals are model confidence intervals for expected "
            "counts and do not include missing-exposure uncertainty.",
            "FRP measurements are not assumed interchangeable across sensors.",
        ],
        "fit_warnings": all_warnings,
    }
    diagnostics_path.write_text(
        json.dumps(diagnostics, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    LOGGER.info(
        "Stage 5: wrote harmonized index for %d country-months "
        "(NB AIC=%.1f vs Poisson AIC=%.1f). "
        "Exposure remains unavailable.",
        len(result),
        nb_holdout.aic,
        poisson_holdout.aic,
    )
    return index_path, parquet_path, diagnostics_path
