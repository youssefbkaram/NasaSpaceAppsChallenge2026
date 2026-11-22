from __future__ import annotations

from pathlib import Path

import duckdb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from .config import PipelineConfig
from .duckdb_io import read_parquet_sql, sql_string


def build_sensor_reports(config: PipelineConfig, standardized_path: Path) -> list[Path]:
    report_dir = config.output_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    annual_csv = report_dir / "annual_sensor_counts.csv"
    frp_csv = report_dir / "frp_distribution.csv"
    annual_plot = report_dir / "annual_sensor_counts.png"
    frp_plot = report_dir / "frp_interquartile_ranges.png"

    relation = read_parquet_sql(standardized_path, hive_partitioning=True)
    connection = duckdb.connect()
    try:
        annual = connection.execute(
            f"""
            SELECT
                country,
                year(try_cast(acquisition_date AS DATE)) AS year,
                sensor,
                quality,
                count(*) AS detection_count
            FROM {relation}
            WHERE
                sensor IS NOT NULL
                AND validation_status != 'invalid'
                AND acquisition_date IS NOT NULL
            GROUP BY country, year, sensor, quality
            ORDER BY country, year, sensor, quality
            """
        ).fetchdf()
        frp = connection.execute(
            f"""
            SELECT
                country,
                sensor,
                quality,
                count(frp) AS frp_observation_count,
                quantile_cont(frp, 0.25) AS frp_q25_mw,
                quantile_cont(frp, 0.50) AS frp_median_mw,
                quantile_cont(frp, 0.75) AS frp_q75_mw
            FROM {relation}
            WHERE
                sensor IS NOT NULL
                AND validation_status != 'invalid'
                AND frp IS NOT NULL
            GROUP BY country, sensor, quality
            ORDER BY country, sensor, quality
            """
        ).fetchdf()
    finally:
        connection.close()

    annual.to_csv(annual_csv, index=False)
    frp.to_csv(frp_csv, index=False)
    if not annual.empty:
        totals = annual.groupby(["year", "sensor"], as_index=False)["detection_count"].sum()
        pivot = totals.pivot(index="year", columns="sensor", values="detection_count")
        axis = pivot.plot(figsize=(12, 6), marker=".", linewidth=1)
        axis.set_title("Raw FIRMS detections by sensor (not harmonized)")
        axis.set_xlabel("Year")
        axis.set_ylabel("Detection records")
        axis.grid(True, alpha=0.25)
        axis.legend(title="Sensor", fontsize=8)
        axis.figure.tight_layout()
        axis.figure.savefig(annual_plot, dpi=160)
        plt.close(axis.figure)
    if not frp.empty:
        summary = (
            frp.groupby("sensor", as_index=False)
            .agg(
                q25=("frp_q25_mw", "median"),
                median=("frp_median_mw", "median"),
                q75=("frp_q75_mw", "median"),
            )
            .sort_values("sensor")
        )
        positions = range(len(summary))
        axis = plt.subplots(figsize=(10, 5))[1]
        lower = summary["median"] - summary["q25"]
        upper = summary["q75"] - summary["median"]
        axis.errorbar(
            list(positions),
            summary["median"],
            yerr=[lower, upper],
            fmt="o",
            capsize=4,
        )
        axis.set_xticks(list(positions), summary["sensor"], rotation=30, ha="right")
        axis.set_title("FRP distribution by sensor (median country-level IQRs)")
        axis.set_ylabel("FRP (MW)")
        axis.grid(True, axis="y", alpha=0.25)
        axis.figure.tight_layout()
        axis.figure.savefig(frp_plot, dpi=160)
        plt.close(axis.figure)
    return [annual_csv, frp_csv, annual_plot, frp_plot]


def write_run_manifest(
    config: PipelineConfig,
    output_paths: list[Path],
    input_count: int,
    observation_count: int,
) -> Path:
    manifest_path = config.output_dir / "reports" / "run_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        pd.Series(
            {
                "model_reference": config.model_reference,
                "input_directory": str(config.input_dir),
                "output_directory": str(config.output_dir),
                "countries_requested": list(config.countries) if config.countries else "all",
                "grid_resolutions_m": list(config.grid_resolutions_m),
                "primary_grid_resolution_m": config.primary_grid_resolution_m,
                "matching_distance_thresholds_m": list(config.match_distance_thresholds_m),
                "matching_time_thresholds_minutes": list(config.match_time_thresholds_minutes),
                "nrt_included": config.include_nrt,
                "observation_exposure_available": False,
                "input_file_count": input_count,
                "standardized_record_count": observation_count,
                "outputs": [str(path) for path in output_paths],
                "warnings": [
                    "MODIS and VIIRS detections are kept as sensor-specific counts.",
                    "No observation-opportunity/exposure files were supplied.",
                    "Monthly relative index is exploratory and not a corrected fire count.",
                    "Missing sensor observations are not converted to zero.",
                ],
            }
        ).to_json(force_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest_path
