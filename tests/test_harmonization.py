import json
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from firms_harmonization.config import PipelineConfig
from firms_harmonization.harmonization import (
    MODEL_VERSION,
    build_relative_activity_index,
)


def _generate_synthetic_monthly_parquet(
    parquet_path: Path,
    n_years: int = 6,
    include_both: bool = True,
) -> None:
    records = []
    countries = ["Suriname", "Guyana"]
    for country in countries:
        for year in range(2018, 2018 + n_years):
            for month in range(1, 13):
                # Strong seasonal signal (peaks around Sep/Oct)
                seasonal = 50.0 + 40.0 * np.sin(2 * np.pi * (month - 6) / 12)
                
                # MODIS detections
                modis_count = int(max(seasonal * 1.5 + np.random.randint(5, 20), 5))
                records.append(
                    {
                        "country": country,
                        "year": year,
                        "month": month,
                        "sensor": "MODIS_AQUA",
                        "satellite": "Aqua",
                        "quality": "SP",
                        "detection_count": modis_count,
                    }
                )
                records.append(
                    {
                        "country": country,
                        "year": year,
                        "month": month,
                        "sensor": "MODIS_TERRA",
                        "satellite": "Terra",
                        "quality": "SP",
                        "detection_count": int(modis_count * 0.8),
                    }
                )

                if include_both:
                    # VIIRS detects ~3-4x more due to higher resolution
                    viirs_count = int(max(seasonal * 5.0 + np.random.randint(20, 80), 15))
                    records.append(
                        {
                            "country": country,
                            "year": year,
                            "month": month,
                            "sensor": "VIIRS_SNPP",
                            "satellite": "SNPP",
                            "quality": "SP",
                            "detection_count": viirs_count,
                        }
                    )
                    records.append(
                        {
                            "country": country,
                            "year": year,
                            "month": month,
                            "sensor": "VIIRS_NOAA20",
                            "satellite": "NOAA-20",
                            "quality": "SP",
                            "detection_count": int(viirs_count * 0.9),
                        }
                    )

    df = pd.DataFrame(records)
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), parquet_path)


def test_harmonization_output_schema_and_quality_flags(tmp_path: Path) -> None:
    monthly_path = tmp_path / "monthly_country_sensor.parquet"
    _generate_synthetic_monthly_parquet(monthly_path, n_years=6, include_both=True)

    config = PipelineConfig(
        input_dir=tmp_path,
        output_dir=tmp_path / "processed",
        grid_resolutions_m=(5_000,),
        primary_grid_resolution_m=5_000,
    )

    index_csv, index_parquet, diagnostics_path = build_relative_activity_index(
        config, monthly_path
    )

    assert index_csv.is_file()
    assert index_parquet.is_file()
    assert diagnostics_path.is_file()

    df = pd.read_csv(index_csv)
    assert not df.empty

    # Verify master prompt schema columns
    expected_cols = [
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
    ]
    for col in expected_cols:
        assert col in df.columns, f"Missing required master prompt column: {col}"

    # Verify quality flags are never null and properly populated
    assert not df["quality_flag"].isna().any()
    assert set(df["quality_flag"].unique()).issubset(
        {
            "sufficient_data",
            "insufficient_overlap",
            "single_sensor_only",
            "no_data",
            "single_sensor_modis_backcast",
        }
    )
    assert (df["quality_flag"] == "sufficient_data").all()

    # Verify uncertainty bounds: upper >= lower >= 0
    assert (df["uncertainty_lower"] >= 0).all()
    assert (df["uncertainty_upper"] >= df["uncertainty_lower"]).all()
    assert (df["harmonized_fire_activity_estimate"] > 0).all()

    # Verify model version and provenance
    assert (df["model_version"] == MODEL_VERSION).all()
    assert df["processing_note"].str.contains("MODELED ESTIMATE").all()
    assert df["processing_note"].str.contains("unavailable").all()

    # Individual sensor counts should be populated
    assert (df["modis_aqua_count"] > 0).all()
    assert (df["viirs_snpp_count"] > 0).all()


def test_harmonization_diagnostics_content(tmp_path: Path) -> None:
    monthly_path = tmp_path / "monthly_country_sensor.parquet"
    _generate_synthetic_monthly_parquet(monthly_path, n_years=6, include_both=True)

    config = PipelineConfig(
        input_dir=tmp_path,
        output_dir=tmp_path / "processed",
        grid_resolutions_m=(5_000,),
        primary_grid_resolution_m=5_000,
    )

    _, _, diagnostics_path = build_relative_activity_index(config, monthly_path)
    diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))

    # Status and model version
    assert diagnostics["status"] == "baseline_fitted"
    assert diagnostics["model_version"] == MODEL_VERSION

    # AIC comparison: Negative Binomial should beat Poisson on overdispersed counts
    assert "poisson_aic_training" in diagnostics
    assert "negative_binomial_aic_training" in diagnostics
    assert diagnostics["negative_binomial_aic_training"] < diagnostics["poisson_aic_training"]
    assert diagnostics["negative_binomial_vs_poisson_delta_aic"] < 0

    # Temporal holdout validation (no random split)
    assert "temporal_holdout" in diagnostics
    th = diagnostics["temporal_holdout"]
    assert th["split_method"] == "chronological_80_percent_cutoff"
    assert "cutoff_month" in th
    assert "leakage_prevention_note" in th
    assert th["metrics_negative_binomial"]["n"] > 0
    assert th["metrics_negative_binomial"]["mae"] > 0
    assert th["metrics_negative_binomial"]["rmse"] > 0

    # Spatial holdout validation
    assert "spatial_holdout" in diagnostics

    # Residual bias analysis
    assert "seasonal_bias_analysis" in diagnostics
    assert len(diagnostics["seasonal_bias_analysis"]) == 12  # All 12 months represented
    assert "geographic_bias_analysis" in diagnostics
    assert len(diagnostics["geographic_bias_analysis"]) == 2  # Suriname and Guyana

    # Cross sensor agreement
    assert "cross_sensor_agreement" in diagnostics
    csa = diagnostics["cross_sensor_agreement"]
    assert csa["n_overlapping_months"] > 0
    assert not np.isnan(csa["pearson_correlation_modis_vs_viirs"])
    assert "note" in csa

    # Limitations explicitly documented
    assert diagnostics["exposure_available"] is False
    assert diagnostics["zero_observation_days_available"] is False
    assert len(diagnostics["limitations"]) >= 8


def test_harmonization_handles_insufficient_data_gracefully(tmp_path: Path) -> None:
    monthly_path = tmp_path / "monthly_country_sensor.parquet"
    # Only 3 months of data (fewer than 12 country-months required)
    records = [
        {
            "country": "Testland",
            "year": 2020,
            "month": 1,
            "sensor": "MODIS_TERRA",
            "satellite": "Terra",
            "quality": "SP",
            "detection_count": 5,
        },
        {
            "country": "Testland",
            "year": 2020,
            "month": 1,
            "sensor": "VIIRS_SNPP",
            "satellite": "SNPP",
            "quality": "SP",
            "detection_count": 15,
        },
    ]
    pq.write_table(
        pa.Table.from_pandas(pd.DataFrame(records), preserve_index=False),
        monthly_path,
    )

    config = PipelineConfig(
        input_dir=tmp_path,
        output_dir=tmp_path / "processed",
        grid_resolutions_m=(5_000,),
        primary_grid_resolution_m=5_000,
    )

    index_csv, index_parquet, diagnostics_path = build_relative_activity_index(
        config, monthly_path
    )

    assert index_csv.is_file()
    df = pd.read_csv(index_csv)
    assert df.empty  # Handled gracefully, no crash

    diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    assert diagnostics["status"] == "not_fitted"
    assert "Fewer than 12" in diagnostics["reason"]


def test_harmonization_backcasts_modis_only_era(tmp_path: Path) -> None:
    monthly_path = tmp_path / "monthly_country_sensor.parquet"

    records = []
    # 2005–2011: MODIS only (12 months per year)
    for year in range(2005, 2012):
        for month in range(1, 13):
            seasonal = 40.0 + 30.0 * np.sin(2 * np.pi * (month - 6) / 12)
            records.append(
                {
                    "country": "Suriname",
                    "year": year,
                    "month": month,
                    "sensor": "MODIS_TERRA",
                    "satellite": "Terra",
                    "quality": "SP",
                    "detection_count": int(max(seasonal + 10, 5)),
                }
            )
            records.append(
                {
                    "country": "Suriname",
                    "year": year,
                    "month": month,
                    "sensor": "MODIS_AQUA",
                    "satellite": "Aqua",
                    "quality": "SP",
                    "detection_count": int(max(seasonal * 1.2 + 8, 5)),
                }
            )

    # 2012–2020: Dual sensor overlap (MODIS + VIIRS)
    for year in range(2012, 2021):
        for month in range(1, 13):
            seasonal = 40.0 + 30.0 * np.sin(2 * np.pi * (month - 6) / 12)
            records.append(
                {
                    "country": "Suriname",
                    "year": year,
                    "month": month,
                    "sensor": "MODIS_TERRA",
                    "satellite": "Terra",
                    "quality": "SP",
                    "detection_count": int(max(seasonal + 10, 5)),
                }
            )
            records.append(
                {
                    "country": "Suriname",
                    "year": year,
                    "month": month,
                    "sensor": "VIIRS_SNPP",
                    "satellite": "SNPP",
                    "quality": "SP",
                    "detection_count": int(max(seasonal * 4.0 + 30, 15)),
                }
            )

    df_synth = pd.DataFrame(records)
    pq.write_table(pa.Table.from_pandas(df_synth, preserve_index=False), monthly_path)

    config = PipelineConfig(
        input_dir=tmp_path,
        output_dir=tmp_path / "processed",
        grid_resolutions_m=(5_000,),
        primary_grid_resolution_m=5_000,
    )

    index_csv, _, diagnostics_path = build_relative_activity_index(config, monthly_path)
    df = pd.read_csv(index_csv)

    # Output should span both eras: 2005 to 2020
    assert df["year"].min() == 2005
    assert df["year"].max() == 2020

    # Pre-2012 rows should be flagged as single_sensor_modis_backcast
    backcast_rows = df[df["year"] < 2012]
    dual_sensor_rows = df[df["year"] >= 2012]

    assert len(backcast_rows) == 7 * 12  # 7 years * 12 months
    assert len(dual_sensor_rows) == 9 * 12  # 9 years * 12 months

    assert (backcast_rows["quality_flag"] == "single_sensor_modis_backcast").all()
    assert (dual_sensor_rows["quality_flag"] == "sufficient_data").all()

    # Both eras should have non-null relative activity index > 0
    assert (backcast_rows["relative_activity_index"] > 0).all()
    assert (dual_sensor_rows["relative_activity_index"] > 0).all()

    # Pre-2012 raw VIIRS count should be 0 or null, MODIS count positive
    assert (backcast_rows["raw_viirs_detection_count"] == 0).all()
    assert (backcast_rows["raw_modis_detection_count"] > 0).all()

    # Diagnostics should explicitly record back-cast count
    diag = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    assert diag["backcast_modis_only_months"] == len(backcast_rows)
    assert diag["output_rows"] == len(df)

