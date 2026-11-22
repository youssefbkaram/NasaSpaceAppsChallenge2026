from __future__ import annotations

from pathlib import Path

import duckdb

from .config import PipelineConfig
from .duckdb_io import read_parquet_sql, sql_string

_PLATFORMS = (
    "MODIS_TERRA",
    "MODIS_AQUA",
    "VIIRS_SNPP",
    "VIIRS_NOAA20",
    "VIIRS_NOAA21",
)


def build_monthly_calendar(
    config: PipelineConfig,
    monthly_aggregate_path: Path,
    relative_index_path: Path | None = None,
) -> Path:
    output = config.output_dir / "aggregated" / "monthly_fire_calendar.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    relation = read_parquet_sql(monthly_aggregate_path)
    connection = duckdb.connect()
    try:
        counts = ",\n".join(
            (
                f"sum(detection_count) FILTER (WHERE sensor = '{platform}') "
                f"AS {platform.casefold()}_count,\n"
                f"count(*) FILTER (WHERE sensor = '{platform}') > 0 "
                f"AS {platform.casefold()}_has_detections"
            )
            for platform in _PLATFORMS
        )
        index_join = ""
        index_fields = """
            NULL::DOUBLE AS relative_activity_index,
            NULL::VARCHAR AS harmonized_quality_status,
            NULL::VARCHAR AS harmonized_exposure_status
        """
        if relative_index_path and relative_index_path.is_file():
            index_sql = sql_string(relative_index_path)
            index_join = f"""
                LEFT JOIN read_csv_auto({index_sql}, header = true) idx
                    ON idx.country = calendar.country
                    AND idx.year = year(calendar.month_start)
                    AND idx.month = month(calendar.month_start)
            """
            index_fields = """
                idx.relative_activity_index,
                idx.quality_status AS harmonized_quality_status,
                idx.exposure_status AS harmonized_exposure_status
            """

        query = f"""
            WITH monthly_platform AS (
                SELECT
                    country,
                    year,
                    month,
                    sensor,
                    sum(detection_count)::BIGINT AS detection_count
                FROM {relation}
                GROUP BY country, year, month, sensor
            ),
            bounds AS (
                SELECT
                    country,
                    min(make_date(year, month, 1)) AS first_month,
                    max(make_date(year, month, 1)) AS last_month
                FROM monthly_platform
                GROUP BY country
            ),
            calendar AS (
                SELECT
                    bounds.country,
                    unnest(generate_series(
                        bounds.first_month,
                        bounds.last_month,
                        INTERVAL '1 month'
                    ))::DATE AS month_start
                FROM bounds
            ),
            pivoted AS (
                SELECT
                    country,
                    year,
                    month,
                    {counts},
                    count(DISTINCT sensor) AS platforms_with_detections,
                    count(*) FILTER (
                        WHERE sensor LIKE 'MODIS_%'
                    ) > 0 AS modis_detections_present,
                    count(*) FILTER (
                        WHERE sensor LIKE 'VIIRS_%'
                    ) > 0 AS viirs_detections_present
                FROM monthly_platform
                GROUP BY country, year, month
            )
            SELECT
                calendar.country,
                year(calendar.month_start) AS year,
                month(calendar.month_start) AS month,
                {", ".join(f"pivoted.{platform.casefold()}_count" for platform in _PLATFORMS)},
                {", ".join(f"pivoted.{platform.casefold()}_has_detections" for platform in _PLATFORMS)},
                coalesce(pivoted.platforms_with_detections, 0) AS platforms_with_detections,
                coalesce(pivoted.modis_detections_present, false) AS modis_detections_present,
                coalesce(pivoted.viirs_detections_present, false) AS viirs_detections_present,
                CASE
                    WHEN pivoted.country IS NULL THEN 'no_observation_records_coverage_unknown'
                    ELSE 'detections_present_observation_coverage_unknown'
                END AS availability_status,
                {index_fields}
            FROM calendar
            LEFT JOIN pivoted
                ON pivoted.country = calendar.country
                AND pivoted.year = year(calendar.month_start)
                AND pivoted.month = month(calendar.month_start)
            {index_join}
            ORDER BY calendar.country, year, month
        """
        output_sql = sql_string(output)
        connection.execute(
            f"COPY ({query}) TO {output_sql} (HEADER, DELIMITER ',')"
        )
    finally:
        connection.close()
    return output
