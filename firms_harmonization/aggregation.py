from __future__ import annotations

import logging
from pathlib import Path

import duckdb

from .config import PipelineConfig
from .duckdb_io import read_parquet_sql, sql_string

LOGGER = logging.getLogger(__name__)


_METRICS = """
    count(*) AS detection_count,
    count(frp) AS frp_observation_count,
    avg(frp) AS frp_mean_mw,
    quantile_cont(frp, 0.5) AS frp_median_mw,
    max(frp) AS frp_max_mw,
    sum(frp) AS frp_total_mw,
    stddev_samp(frp) AS frp_stddev_mw,
    count(DISTINCT acquisition_time) AS distinct_acquisition_times,
    avg(confidence_numeric) AS numeric_confidence_mean,
    min(confidence_numeric) AS numeric_confidence_min,
    max(confidence_numeric) AS numeric_confidence_max,
    sum(CASE WHEN coalesce(confidence_category, '') = 'low' OR upper(confidence) = 'L' THEN 1 ELSE 0 END) AS confidence_low_count,
    sum(CASE WHEN coalesce(confidence_category, '') = 'nominal' OR upper(confidence) = 'N' THEN 1 ELSE 0 END) AS confidence_nominal_count,
    sum(CASE WHEN coalesce(confidence_category, '') = 'high' OR upper(confidence) = 'H' THEN 1 ELSE 0 END) AS confidence_high_count,
    sum(CASE WHEN daynight = 'D' THEN 1 ELSE 0 END) AS day_count,
    sum(CASE WHEN daynight = 'N' THEN 1 ELSE 0 END) AS night_count,
    sum(CASE WHEN quality = 'SP' THEN 1 ELSE 0 END) AS standard_processing_count,
    sum(CASE WHEN quality = 'NRT' THEN 1 ELSE 0 END) AS nrt_count,
    'detections_present_observation_coverage_unknown' AS availability_status
"""


def _copy_query(connection: duckdb.DuckDBPyConnection, query: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    output_sql = sql_string(output)
    connection.execute(
        f"COPY ({query}) TO {output_sql} (FORMAT PARQUET, COMPRESSION ZSTD)"
    )


def build_aggregates(config: PipelineConfig, standardized_path: Path) -> list[Path]:
    parquet_sql = read_parquet_sql(standardized_path, hive_partitioning=True)
    connection = duckdb.connect()
    outputs: list[Path] = []
    resolution_eval_rows = []
    try:
        for resolution in config.grid_resolutions_m:
            grid_cte = f"""
                WITH observations AS (
                    SELECT
                        country,
                        coalesce(sensor, 'UNKNOWN') AS sensor,
                        coalesce(satellite, 'UNKNOWN') AS satellite,
                        quality,
                        acquisition_date,
                        acquisition_time,
                        acquisition_datetime_utc,
                        confidence,
                        confidence_category,
                        confidence_numeric,
                        frp,
                        daynight,
                        floor(equal_area_x_m / {resolution})::BIGINT AS grid_x,
                        floor(equal_area_y_m / {resolution})::BIGINT AS grid_y,
                        concat(
                            'EPSG6933_{resolution}m_',
                            floor(equal_area_x_m / {resolution})::BIGINT,
                            '_',
                            floor(equal_area_y_m / {resolution})::BIGINT
                        ) AS grid_id
                    FROM {parquet_sql}
                    WHERE
                        validation_status != 'invalid'
                        AND acquisition_date IS NOT NULL
                        AND equal_area_x_m IS NOT NULL
                        AND equal_area_y_m IS NOT NULL
                )
            """
            for interval in ("daily", "weekly", "monthly"):
                period = (
                    "CAST(acquisition_date AS DATE)"
                    if interval == "daily"
                    else "date_trunc('week', CAST(acquisition_date AS DATE))::DATE"
                    if interval == "weekly"
                    else "date_trunc('month', CAST(acquisition_date AS DATE))::DATE"
                )
                query = f"""
                    {grid_cte}
                    SELECT
                        country,
                        grid_id,
                        {resolution}::INTEGER AS grid_resolution_m,
                        '{interval}' AS time_interval,
                        {period} AS period_start,
                        sensor,
                        satellite,
                        quality,
                        { _METRICS }
                    FROM observations
                    GROUP BY
                        country, grid_id, sensor, satellite, quality, period_start
                """
                output = (
                    config.output_dir
                    / "aggregated"
                    / f"{interval}_{resolution}m.parquet"
                )
                _copy_query(connection, query, output)
                outputs.append(output)

            # Multi-sensor grid matrix (sensor counts side-by-side in distinct columns)
            multi_sensor_grid_query = f"""
                {grid_cte}
                SELECT
                    country,
                    grid_id,
                    {resolution}::INTEGER AS grid_resolution_m,
                    'daily' AS time_interval,
                    CAST(acquisition_date AS DATE) AS period_start,
                    sum(CASE WHEN sensor = 'MODIS_TERRA' THEN 1 ELSE 0 END) AS modis_terra_count,
                    sum(CASE WHEN sensor = 'MODIS_AQUA' THEN 1 ELSE 0 END) AS modis_aqua_count,
                    sum(CASE WHEN sensor = 'VIIRS_SNPP' THEN 1 ELSE 0 END) AS viirs_snpp_count,
                    sum(CASE WHEN sensor = 'VIIRS_NOAA20' THEN 1 ELSE 0 END) AS viirs_noaa20_count,
                    sum(CASE WHEN sensor = 'VIIRS_NOAA21' THEN 1 ELSE 0 END) AS viirs_noaa21_count,
                    count(*) AS total_detections,
                    sum(frp) AS frp_total_mw,
                    avg(frp) AS frp_mean_mw,
                    max(frp) AS frp_max_mw,
                    sum(CASE WHEN daynight = 'D' THEN 1 ELSE 0 END) AS day_count,
                    sum(CASE WHEN daynight = 'N' THEN 1 ELSE 0 END) AS night_count,
                    sum(CASE WHEN coalesce(confidence_category, '') = 'low' OR upper(confidence) = 'L' THEN 1 ELSE 0 END) AS confidence_low_count,
                    sum(CASE WHEN coalesce(confidence_category, '') = 'nominal' OR upper(confidence) = 'N' THEN 1 ELSE 0 END) AS confidence_nominal_count,
                    sum(CASE WHEN coalesce(confidence_category, '') = 'high' OR upper(confidence) = 'H' THEN 1 ELSE 0 END) AS confidence_high_count,
                    count(DISTINCT acquisition_time) AS distinct_observation_times
                FROM observations
                GROUP BY country, grid_id, period_start
            """
            multi_sensor_output = (
                config.output_dir
                / "aggregated"
                / f"grid_multi_sensor_daily_{resolution}m.parquet"
            )
            _copy_query(connection, multi_sensor_grid_query, multi_sensor_output)
            outputs.append(multi_sensor_output)

            # Measure grid resolution evaluation metrics
            eval_query = f"""
                {grid_cte}
                SELECT
                    {resolution}::INTEGER AS resolution_m,
                    {resolution // 1000}::INTEGER AS resolution_km,
                    count(DISTINCT grid_id) AS active_grid_cells,
                    count(*) AS total_detections,
                    CASE WHEN count(DISTINCT grid_id) > 0 THEN round(count(*)::DOUBLE / count(DISTINCT grid_id), 3) ELSE 0.0 END AS mean_detections_per_active_cell,
                    CASE WHEN count(*) > 0 THEN round(sum(CASE WHEN sensor LIKE 'MODIS_%' THEN 1 ELSE 0 END)::DOUBLE / count(*), 3) ELSE 0.0 END AS modis_detection_share,
                    CASE WHEN count(*) > 0 THEN round(sum(CASE WHEN sensor LIKE 'VIIRS_%' THEN 1 ELSE 0 END)::DOUBLE / count(*), 3) ELSE 0.0 END AS viirs_detection_share
                FROM observations
            """
            eval_res = connection.execute(eval_query).fetchone()
            if eval_res:
                resolution_eval_rows.append(eval_res)

        monthly_query = f"""
            SELECT
                country,
                year(CAST(acquisition_date AS DATE)) AS year,
                month(CAST(acquisition_date AS DATE)) AS month,
                sensor,
                satellite,
                quality,
                { _METRICS }
            FROM {parquet_sql}
            WHERE
                validation_status != 'invalid'
                AND acquisition_date IS NOT NULL
                AND sensor IS NOT NULL
            GROUP BY country, year, month, sensor, satellite, quality
            ORDER BY country, year, month, sensor, quality
        """
        monthly_parquet = config.output_dir / "aggregated" / "monthly_country_sensor.parquet"
        _copy_query(connection, monthly_query, monthly_parquet)
        outputs.append(monthly_parquet)
        monthly_csv = config.output_dir / "aggregated" / "monthly_country_sensor.csv"
        monthly_csv.parent.mkdir(parents=True, exist_ok=True)
        if monthly_csv.exists():
            monthly_csv.unlink()
        monthly_csv_sql = "'" + monthly_csv.as_posix().replace("'", "''") + "'"
        connection.execute(
            f"COPY ({monthly_query}) TO {monthly_csv_sql} (HEADER, DELIMITER ',')"
        )
        outputs.append(monthly_csv)

        summary_query = f"""
            SELECT
                country,
                sensor,
                satellite,
                quality,
                count(*) AS detection_count,
                count(frp) AS frp_observation_count,
                avg(frp) AS frp_mean_mw,
                quantile_cont(frp, 0.5) AS frp_median_mw,
                max(frp) AS frp_max_mw,
                min(acquisition_date) AS first_detection_date,
                max(acquisition_date) AS last_detection_date,
                avg(confidence_numeric) AS numeric_confidence_mean,
                sum(CASE WHEN upper(confidence) = 'L' THEN 1 ELSE 0 END) AS confidence_low_count,
                sum(CASE WHEN upper(confidence) = 'N' THEN 1 ELSE 0 END) AS confidence_nominal_count,
                sum(CASE WHEN upper(confidence) = 'H' THEN 1 ELSE 0 END) AS confidence_high_count
            FROM {parquet_sql}
            WHERE sensor IS NOT NULL AND validation_status != 'invalid'
            GROUP BY country, sensor, satellite, quality
            ORDER BY country, sensor, quality
        """
        summary = config.output_dir / "reports" / "sensor_comparison.csv"
        summary.parent.mkdir(parents=True, exist_ok=True)
        if summary.exists():
            summary.unlink()
        summary_sql = "'" + summary.as_posix().replace("'", "''") + "'"
        connection.execute(
            f"COPY ({summary_query}) TO {summary_sql} (HEADER, DELIMITER ',')"
        )
        outputs.append(summary)

        if resolution_eval_rows:
            import pandas as pd
            eval_df = pd.DataFrame(
                resolution_eval_rows,
                columns=[
                    "resolution_m",
                    "resolution_km",
                    "active_grid_cells",
                    "total_detections",
                    "mean_detections_per_active_cell",
                    "modis_detection_share",
                    "viirs_detection_share",
                ],
            )
            eval_csv = config.output_dir / "reports" / "grid_resolution_evaluation.csv"
            eval_csv.parent.mkdir(parents=True, exist_ok=True)
            eval_df.to_csv(eval_csv, index=False)
            outputs.append(eval_csv)
    finally:
        connection.close()

    LOGGER.info("Wrote %d sensor aggregation products.", len(outputs))
    return outputs
