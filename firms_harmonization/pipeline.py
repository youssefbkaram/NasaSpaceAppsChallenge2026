from __future__ import annotations

import logging
from pathlib import Path

import duckdb
import pandas as pd

from .aggregation import build_aggregates
from .calendar import build_monthly_calendar
from .config import PipelineConfig
from .duckdb_io import read_parquet_sql
from .harmonization import build_relative_activity_index
from .ingest import ingest_inputs
from .matching import build_spatiotemporal_matches
from .reporting import build_sensor_reports, write_run_manifest
from .sources import discover_sources
from .standardize import build_standardized_dataset

LOGGER = logging.getLogger(__name__)


def run_pipeline(config: PipelineConfig) -> list[Path]:
    if config.output_dir == config.input_dir or config.output_dir in config.input_dir.parents:
        raise ValueError("The output directory must not replace or contain the raw input directory.")
    if config.output_dir.exists() and any(config.output_dir.iterdir()):
        raise FileExistsError(
            f"Output directory is not empty: {config.output_dir}. Choose a new run directory; "
            "raw inputs and prior outputs are never overwritten."
        )
    config.output_dir.mkdir(parents=True, exist_ok=True)

    sources = discover_sources(
        config.input_dir,
        include_nrt=config.include_nrt,
        countries=config.countries,
    )
    if not sources:
        raise FileNotFoundError(f"No FIRMS input files found under {config.input_dir}.")

    LOGGER.info("Stage 1/7: validating and ingesting %d input files.", len(sources))
    validation_report = ingest_inputs(config)
    if config.strict:
        report = pd.read_csv(validation_report)
        invalid_count = int(report["invalid_rows"].sum())
        if invalid_count:
            raise RuntimeError(
                f"Strict mode stopped after validation found {invalid_count} invalid rows. "
                f"Records remain preserved; see {validation_report}."
            )

    LOGGER.info("Stage 2/7: standardizing observations and flagging exact duplicates.")
    standardized_path = build_standardized_dataset(config)

    LOGGER.info("Stage 3/7: creating sensor-specific daily, weekly, and monthly aggregates.")
    aggregate_paths = build_aggregates(config, standardized_path)
    monthly_aggregate_path = (
        config.output_dir / "aggregated" / "monthly_country_sensor.parquet"
    )

    output_paths: list[Path] = [
        validation_report,
        config.output_dir / "validated" / "input_schema_report.csv",
        standardized_path,
        *aggregate_paths,
    ]

    if config.matching_enabled:
        LOGGER.info("Stage 4/7: generating cross-sensor spatial-temporal candidates.")
        output_paths.extend(
            build_spatiotemporal_matches(config, standardized_path)
        )

    relative_index_path: Path | None = None
    if config.model_enabled:
        LOGGER.info("Stage 5/7: fitting and evaluating the exploratory NB baseline.")
        index_csv, index_parquet, diagnostics = build_relative_activity_index(
            config,
            monthly_aggregate_path,
        )
        relative_index_path = index_csv
        output_paths.extend([index_csv, index_parquet, diagnostics])
    else:
        LOGGER.info("Stage 5/7: model fitting disabled by configuration.")

    LOGGER.info("Stage 6/7: producing the monthly calendar with explicit missingness.")
    output_paths.append(
        build_monthly_calendar(
            config,
            monthly_aggregate_path,
            relative_index_path=relative_index_path,
        )
    )

    LOGGER.info("Stage 7/7: writing sensor diagnostics and run manifest.")
    output_paths.extend(build_sensor_reports(config, standardized_path))
    relation = read_parquet_sql(standardized_path, hive_partitioning=True)
    connection = duckdb.connect()
    try:
        observation_count = int(
            connection.execute(f"SELECT count(*) FROM {relation}").fetchone()[0]
        )
    finally:
        connection.close()
    manifest = write_run_manifest(
        config,
        output_paths,
        input_count=len(sources),
        observation_count=observation_count,
    )
    output_paths.append(manifest)
    LOGGER.info(
        "Pipeline completed: %d observations from %d source files. Outputs: %s",
        observation_count,
        len(sources),
        config.output_dir,
    )
    return output_paths
