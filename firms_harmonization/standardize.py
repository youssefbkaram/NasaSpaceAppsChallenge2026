from __future__ import annotations

import logging
from pathlib import Path

import duckdb

from .config import PipelineConfig
from .duckdb_io import parquet_file_list, read_parquet_sql, sql_string

LOGGER = logging.getLogger(__name__)


def build_standardized_dataset(config: PipelineConfig) -> Path:
    parts = sorted((config.output_dir / "validated" / "parts").rglob("*.parquet"))
    if not parts:
        raise FileNotFoundError("No validated Parquet parts were produced during ingestion.")

    output_path = config.output_dir / "standardized" / "observations"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        raise FileExistsError(
            f"Standardized output already exists: {output_path}. Use a new run output directory."
        )

    paths_sql = "[" + ", ".join(
        "'" + path.as_posix().replace("'", "''") + "'" for path in parts
    ) + "]"
    output_sql = sql_string(output_path.as_posix())
    connection = duckdb.connect()
    try:
        connection.execute(
            f"""
            COPY (
                SELECT
                    * EXCLUDE (duplicate_record),
                    row_number() OVER (
                        PARTITION BY
                            country,
                            source_product,
                            quality,
                            source_attributes_json
                        ORDER BY source_file, source_row_number
                    ) > 1 AS duplicate_record,
                    year(try_cast(acquisition_date AS DATE))::INTEGER AS acquisition_year
                FROM read_parquet({paths_sql}, union_by_name = true)
            )
            TO {output_sql}
            (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (country, acquisition_year))
            """
        )
        output_files = parquet_file_list(output_path)
        output_relation = read_parquet_sql(output_path, hive_partitioning=True)
        row_count = connection.execute(
            f"SELECT count(*) FROM {output_relation}"
        ).fetchone()[0]
        duplicates = connection.execute(
            f"SELECT count(*) FROM {output_relation} WHERE duplicate_record"
        ).fetchone()[0]
    finally:
        connection.close()

    LOGGER.info(
        "Standardized %d observations across %d partition files; retained and flagged %d exact duplicates.",
        row_count,
        len(output_files),
        duplicates,
    )
    return output_path
