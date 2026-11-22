from __future__ import annotations

from collections import Counter
import json
import logging
from pathlib import Path
import re
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import PipelineConfig
from .geography import flag_outside_country_boundaries, load_country_boundaries
from .schema import STANDARD_COLUMNS
from .sources import SourceFile, discover_sources
from .validation import normalize_chunk

LOGGER = logging.getLogger(__name__)

_FLOAT_COLUMNS = {
    "latitude",
    "longitude",
    "equal_area_x_m",
    "equal_area_y_m",
    "confidence_numeric",
    "frp",
    "frp_mw",
    "brightness_temperature",
    "bright_t31",
    "scan",
    "track",
}
_INTEGER_COLUMNS = {"source_row_number"}
_BOOLEAN_COLUMNS = {"duplicate_record"}


def _arrow_schema() -> pa.Schema:
    fields = []
    for column in STANDARD_COLUMNS:
        if column in _FLOAT_COLUMNS:
            data_type = pa.float64()
        elif column in _INTEGER_COLUMNS:
            data_type = pa.int64()
        elif column in _BOOLEAN_COLUMNS:
            data_type = pa.bool_()
        else:
            data_type = pa.string()
        fields.append(pa.field(column, data_type, nullable=True))
    return pa.schema(fields)


def _to_arrow(frame: pd.DataFrame, schema: pa.Schema) -> pa.Table:
    arrays = [
        pa.array(frame[field.name], type=field.type, from_pandas=True)
        for field in schema
    ]
    return pa.Table.from_arrays(arrays, schema=schema)


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)


def _iter_source_chunks(
    source: SourceFile, chunk_size: int
) -> tuple[Any, int]:
    if source.file_format == "csv":
        reader = pd.read_csv(
            source.path,
            chunksize=chunk_size,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            encoding="utf-8-sig",
        )
        row_number = 2
        for chunk in reader:
            yield chunk, row_number
            row_number += len(chunk)
        return

    if source.file_format == "shp":
        import geopandas as gpd

        frame = gpd.read_file(source.path)
        yield frame, 1
        return

    raise ValueError(f"Unsupported source format: {source.file_format}")


def _process_source(
    source: SourceFile,
    config: PipelineConfig,
    schema: pa.Schema,
    boundaries: Any,
) -> dict[str, Any]:
    relative = source.path.resolve().relative_to(config.input_dir)
    output_dir = (
        config.output_dir
        / "validated"
        / "parts"
        / _safe_name(source.country)
        / _safe_name(source.source_product)
        / source.processing
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{_safe_name(source.path.stem)}.parquet"
    if output_path.exists():
        output_path.unlink()

    report: dict[str, Any] = {
        "country": source.country,
        "source_product": source.source_product,
        "processing": source.processing,
        "quality": source.quality,
        "source_file": relative.as_posix(),
        "format": source.file_format,
        "rows": 0,
        "invalid_rows": 0,
        "review_rows": 0,
        "missing_or_invalid_frp_rows": 0,
        "missing_fields": "[]",
        "unexpected_fields": "[]",
        "output_parquet": output_path.as_posix(),
        "error": "",
    }
    writer: pq.ParquetWriter | None = None
    row_counter: Counter[str] = Counter()
    schema_fields: set[str] = set()
    try:
        for raw_chunk, first_row_number in _iter_source_chunks(source, config.chunk_size):
            normalized, chunk_report = normalize_chunk(
                raw_chunk,
                source,
                str(config.input_dir),
                first_row_number,
            )
            normalized = flag_outside_country_boundaries(normalized, boundaries)
            schema_fields.update(chunk_report["source_columns"])
            report["rows"] += chunk_report["rows"]
            report["invalid_rows"] += chunk_report["invalid_rows"]
            report["review_rows"] += chunk_report["review_rows"]
            report["missing_or_invalid_frp_rows"] += chunk_report["missing_frp_rows"]
            row_counter.update(
                reason
                for reasons in normalized["validation_reasons"]
                if reasons
                for reason in reasons.split(";")
            )
            table = _to_arrow(normalized, schema)
            if writer is None:
                writer = pq.ParquetWriter(output_path, schema, compression="zstd")
            writer.write_table(table)
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        LOGGER.exception("Failed to process FIRMS input %s", source.path)
    finally:
        if writer is not None:
            writer.close()

    from .schema import CSV_ALIASES

    normalized_fields = {
        alias.casefold()
        for aliases in CSV_ALIASES.values()
        for alias in aliases
    }
    missing_fields = [
        target
        for target, aliases in CSV_ALIASES.items()
        if not any(alias.casefold() in {name.strip().casefold() for name in schema_fields} for alias in aliases)
    ]
    report["missing_fields"] = json.dumps(sorted(set(missing_fields)))
    report["unexpected_fields"] = json.dumps(
        sorted(
            name
            for name in schema_fields
            if name.strip().casefold() not in normalized_fields
        )
    )
    report["validation_reason_counts"] = json.dumps(
        dict(sorted(row_counter.items())), sort_keys=True
    )
    if report["rows"] == 0 and not report["error"]:
        report["error"] = "Input file contained no observation rows."
    return report


def ingest_inputs(config: PipelineConfig) -> Path:
    sources = discover_sources(
        config.input_dir,
        include_nrt=config.include_nrt,
        countries=config.countries,
    )
    if not sources:
        raise FileNotFoundError(
            f"No FIRMS CSV or point-shapefile inputs found under {config.input_dir}."
        )
    LOGGER.info("Discovered %d FIRMS source files.", len(sources))
    schema = _arrow_schema()
    boundaries = load_country_boundaries(config.country_boundaries)
    reports = [
        _process_source(source, config, schema, boundaries)
        for source in sources
    ]

    validated_dir = config.output_dir / "validated"
    validated_dir.mkdir(parents=True, exist_ok=True)
    report_path = validated_dir / "validation_report.csv"
    pd.DataFrame(reports).to_csv(report_path, index=False)
    schemas = (
        pd.DataFrame(reports)[
            ["country", "source_product", "processing", "format", "missing_fields", "unexpected_fields"]
        ]
        .drop_duplicates()
        .sort_values(["country", "source_product", "processing"])
    )
    schemas.to_csv(validated_dir / "input_schema_report.csv", index=False)

    errors = [report for report in reports if report["error"]]
    if errors:
        examples = "; ".join(
            f"{report['source_file']}: {report['error']}" for report in errors[:5]
        )
        raise RuntimeError(
            f"{len(errors)} FIRMS input file(s) failed. See {report_path}. {examples}"
        )
    return report_path
