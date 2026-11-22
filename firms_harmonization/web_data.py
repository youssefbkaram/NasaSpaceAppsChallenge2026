from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
from typing import Iterator

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .schema import CSV_ALIASES
from .sources import SourceFile, discover_sources

LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION = 1
_COLUMN_ALIASES = {
    name: tuple(alias.casefold() for alias in aliases)
    for name, aliases in CSV_ALIASES.items()
}
_WEB_SCHEMA = pa.schema([
    ("source_id", pa.string()),
    ("source_row_number", pa.int64()),
    ("latitude", pa.float64()),
    ("longitude", pa.float64()),
    ("brightness", pa.float64()),
    ("scan", pa.float64()),
    ("track", pa.float64()),
    ("acq_date", pa.string()),
    ("acq_time", pa.string()),
    ("satellite", pa.string()),
    ("instrument", pa.string()),
    ("confidence_numeric", pa.float64()),
    ("confidence_text", pa.string()),
    ("version", pa.string()),
    ("quality", pa.string()),
    ("bright_t31", pa.float64()),
    ("frp", pa.float64()),
    ("daynight", pa.string()),
    ("country", pa.string()),
    ("type", pa.float64()),
])


def _country_id(country: str) -> str:
    value = re.sub(r"[^a-z0-9-]+", "-", country.casefold()).strip("-")
    if not value:
        raise ValueError(f"Cannot make a country ID from {country!r}.")
    return value


def _source_id(source: SourceFile) -> str:
    product = source.source_product.removeprefix("DL_FIRE_")
    return re.sub(r"[^A-Za-z0-9._-]+", "_", f"{product}_{source.processing}")


def _source_chunks(source: SourceFile, chunk_size: int) -> Iterator[tuple[pd.DataFrame, int]]:
    if source.file_format == "csv":
        rows_read = 2
        chunks = pd.read_csv(
            source.path,
            chunksize=chunk_size,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            encoding="utf-8-sig",
        )
        for frame in chunks:
            yield frame, rows_read
            rows_read += len(frame)
        return

    if source.file_format == "shp":
        import geopandas as gpd

        frame = gpd.read_file(source.path)
        for offset in range(0, len(frame), chunk_size):
            yield frame.iloc[offset:offset + chunk_size], offset
        return

    raise ValueError(f"Unsupported FIRMS input format: {source.file_format}")


def _source_field(frame: pd.DataFrame, name: str) -> pd.Series:
    columns = {str(column).strip().casefold(): column for column in frame.columns}
    aliases = _COLUMN_ALIASES.get(name, (name,))
    for alias in aliases:
        original = columns.get(alias)
        if original is not None:
            return frame[original].astype("string").str.strip()

    if name in {"latitude", "longitude"} and "geometry" in columns:
        geometry = frame[columns["geometry"]]
        coordinate = geometry.map(
            lambda point: None
            if point is None or point.is_empty
            else point.y if name == "latitude" else point.x
        )
        return coordinate.astype("string")

    return pd.Series(pd.NA, index=frame.index, dtype="string")


def _source_satellite(frame: pd.DataFrame) -> pd.Series:
    codes = _source_field(frame, "satellite").fillna("").str.upper()
    satellite = pd.Series(pd.NA, index=frame.index, dtype="string")
    mappings = (
        (r"^(?:T|TERRA)$", "Terra"),
        (r"^(?:A|AQUA)$", "Aqua"),
        (r"(?:N21|J2|NOAA.?21|^2$)", "NOAA-21"),
        (r"(?:N20|J1|NOAA.?20|^1$)", "NOAA-20"),
        (r"(?:NPP|SNPP|^N$)", "Suomi-NPP"),
    )
    for pattern, value in mappings:
        satellite.loc[codes.str.contains(pattern, regex=True, na=False)] = value
    return satellite


def _finite_numeric(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    return numeric.where(np.isfinite(numeric))


def _prepare_chunk(
    raw: pd.DataFrame,
    source: SourceFile,
    first_row_number: int,
) -> pd.DataFrame:
    product = source.source_product.removeprefix("DL_FIRE_").upper()
    if product.startswith("M-C"):
        instrument = "MODIS"
    elif product.startswith(("SV-C", "J1V-C", "J2V-C")):
        instrument = "VIIRS"
    else:
        raise ValueError(f"Unsupported FIRMS product: {source.source_product}")

    latitude = _finite_numeric(_source_field(raw, "latitude"))
    longitude = _finite_numeric(_source_field(raw, "longitude"))
    brightness = _finite_numeric(_source_field(raw, "brightness_temperature"))
    scan = _finite_numeric(_source_field(raw, "scan"))
    track = _finite_numeric(_source_field(raw, "track"))
    frp = _finite_numeric(_source_field(raw, "frp"))
    date_values = pd.to_datetime(_source_field(raw, "acquisition_date"), format="mixed", errors="coerce")
    acquisition_date = date_values.dt.strftime("%Y-%m-%d").astype("string")

    time_values = pd.to_numeric(_source_field(raw, "acquisition_time"), errors="coerce")
    integer_time = time_values.notna() & (time_values % 1 == 0)
    valid_time = integer_time & time_values.between(0, 2359) & (time_values % 100 < 60)
    acquisition_time = (
        time_values.where(valid_time).astype("Int64").astype("string").str.zfill(4)
    )
    satellite = _source_satellite(raw)
    daynight = _source_field(raw, "daynight").fillna("").str.upper()
    valid = (
        latitude.between(-90, 90)
        & longitude.between(-180, 180)
        & brightness.notna()
        & scan.notna()
        & track.notna()
        & frp.notna()
        & acquisition_date.notna()
        & valid_time
        & satellite.notna()
        & daynight.isin({"D", "N"})
    )
    if not valid.any():
        return pd.DataFrame(columns=[field.name for field in _WEB_SCHEMA] + ["year"])

    valid_index = raw.index[valid]
    confidence = _source_field(raw, "confidence").loc[valid_index].fillna("")
    confidence_numeric = _finite_numeric(confidence)
    confidence_text = confidence.where(confidence_numeric.isna(), pd.NA)
    version = _source_field(raw, "version").loc[valid_index].fillna("")
    bright_t31 = _finite_numeric(_source_field(raw, "bright_t31").loc[valid_index])
    fire_type = _finite_numeric(_source_field(raw, "fire_type").loc[valid_index])
    selected_date = acquisition_date.loc[valid_index]
    result = pd.DataFrame({
        "source_id": _source_id(source),
        "source_row_number": np.arange(
            first_row_number, first_row_number + len(raw), dtype=np.int64
        )[np.flatnonzero(valid.to_numpy())],
        "latitude": latitude.loc[valid_index].astype("float64"),
        "longitude": longitude.loc[valid_index].astype("float64"),
        "brightness": brightness.loc[valid_index].astype("float64"),
        "scan": scan.loc[valid_index].astype("float64"),
        "track": track.loc[valid_index].astype("float64"),
        "acq_date": selected_date,
        "acq_time": acquisition_time.loc[valid_index],
        "satellite": satellite.loc[valid_index],
        "instrument": instrument,
        "confidence_numeric": confidence_numeric.astype("float64"),
        "confidence_text": confidence_text.astype("string"),
        "version": version,
        "quality": source.quality,
        "bright_t31": bright_t31.astype("float64"),
        "frp": frp.loc[valid_index].astype("float64"),
        "daynight": daynight.loc[valid_index],
        "country": source.country,
        "type": fire_type.astype("float64"),
    }, index=valid_index)
    result["year"] = selected_date.str.slice(0, 4).astype("int16")
    return result.reset_index(drop=True)


def build_web_dataset(
    input_dir: Path,
    output_dir: Path,
    *,
    chunk_size: int = 100_000,
    countries: tuple[str, ...] | None = None,
) -> dict[str, object]:
    input_dir = input_dir.resolve()
    output_dir = output_dir.resolve()
    if output_dir == input_dir:
        raise ValueError("The web dataset output directory cannot be the raw input directory.")
    if chunk_size < 1:
        raise ValueError("chunk_size must be greater than zero.")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(
            f"Output directory is not empty: {output_dir}. Choose a new directory."
        )

    sources = discover_sources(input_dir, countries=countries)
    if not sources:
        raise FileNotFoundError(f"No FIRMS CSV or point-shapefile inputs found under {input_dir}.")

    output_dir.mkdir(parents=True, exist_ok=True)
    country_stats: dict[str, dict[str, object]] = {}
    parquet_files: set[Path] = set()
    file_stats: dict[str, dict[str, object]] = {}
    total_records = 0

    for source in sources:
        country_id = _country_id(source.country)
        source_id = _source_id(source)
        writers: dict[int, pq.ParquetWriter] = {}
        source_records = 0
        try:
            for raw, first_row_number in _source_chunks(source, chunk_size):
                prepared = _prepare_chunk(raw, source, first_row_number)
                if prepared.empty:
                    continue
                for year, group in prepared.groupby("year", sort=True):
                    year = int(year)
                    destination = (
                        output_dir
                        / f"country_id={country_id}"
                        / f"year={year}"
                        / f"{source_id}.parquet"
                    )
                    writer = writers.get(year)
                    if writer is None:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        writer = pq.ParquetWriter(
                            destination,
                            _WEB_SCHEMA,
                            compression="zstd",
                            compression_level=3,
                            use_dictionary=["source_id", "satellite", "instrument", "quality", "country"],
                        )
                        writers[year] = writer
                        parquet_files.add(destination)
                        file_stats[destination.relative_to(output_dir).as_posix()] = {
                            "country_id": country_id,
                            "year": year,
                            "first_date": None,
                            "last_date": None,
                            "record_count": 0,
                        }
                    table = pa.Table.from_pandas(
                        group.drop(columns="year"),
                        schema=_WEB_SCHEMA,
                        preserve_index=False,
                        safe=True,
                    )
                    writer.write_table(table, row_group_size=chunk_size)
                    source_records += table.num_rows
                    stats = country_stats.setdefault(country_id, {
                        "country": source.country,
                        "records": 0,
                        "first_date": None,
                        "last_date": None,
                    })
                    stats["records"] = int(stats["records"]) + table.num_rows
                    first_date = str(group["acq_date"].min())
                    last_date = str(group["acq_date"].max())
                    file_entry = file_stats[destination.relative_to(output_dir).as_posix()]
                    file_entry["record_count"] = int(file_entry["record_count"]) + table.num_rows
                    file_entry["first_date"] = min(
                        str(file_entry["first_date"] or first_date), first_date
                    )
                    file_entry["last_date"] = max(
                        str(file_entry["last_date"] or last_date), last_date
                    )
                    stats["first_date"] = min(
                        str(stats["first_date"] or first_date), first_date
                    )
                    stats["last_date"] = max(
                        str(stats["last_date"] or last_date), last_date
                    )
        finally:
            for writer in writers.values():
                writer.close()

        LOGGER.info(
            "Indexed %s (%s): %s observations",
            source.path.relative_to(input_dir),
            source.quality,
            f"{source_records:,}",
        )
        total_records += source_records

    if total_records == 0:
        raise RuntimeError("The FIRMS sources contained no valid observations.")

    manifest: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "record_count": total_records,
        "parquet_file_count": len(parquet_files),
        "partition_columns": ["country_id", "year"],
        "countries": country_stats,
        "files": [file_stats[path] | {"path": path} for path in sorted(file_stats)],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def index_existing_web_dataset(output_dir: Path) -> dict[str, object]:
    output_dir = output_dir.resolve()
    manifest_path = output_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Web dataset manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("countries"), dict):
        raise ValueError(f"Unsupported web dataset manifest: {manifest_path}")

    files: list[dict[str, object]] = []
    for parquet_path in sorted(output_dir.glob("country_id=*/year=*/*.parquet")):
        country_id = parquet_path.parent.parent.name.removeprefix("country_id=")
        try:
            year = int(parquet_path.parent.name.removeprefix("year="))
        except ValueError as error:
            raise ValueError(f"Invalid year partition in {parquet_path}.") from error
        parquet = pq.ParquetFile(parquet_path)
        date_index = parquet.schema_arrow.get_field_index("acq_date")
        if date_index < 0:
            raise ValueError(f"Missing acq_date column in {parquet_path}.")
        dates: list[str] = []
        for row_group_index in range(parquet.metadata.num_row_groups):
            column = parquet.metadata.row_group(row_group_index).column(date_index)
            statistics = column.statistics
            if statistics is None or not statistics.has_min_max:
                raise ValueError(f"Missing acq_date statistics in {parquet_path}.")
            dates.extend((str(statistics.min), str(statistics.max)))
        if not dates:
            raise ValueError(f"No row groups found in {parquet_path}.")
        files.append({
            "path": parquet_path.relative_to(output_dir).as_posix(),
            "country_id": country_id,
            "year": year,
            "first_date": min(dates),
            "last_date": max(dates),
            "record_count": parquet.metadata.num_rows,
        })

    if not files:
        raise FileNotFoundError(f"No web Parquet files found under {output_dir}.")
    manifest["parquet_file_count"] = len(files)
    manifest["record_count"] = sum(int(file["record_count"]) for file in files)
    manifest["files"] = files
    manifest["indexed_at"] = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        prog="firms-build-web-data",
        description="Build a date- and country-partitioned Parquet dataset for the map API.",
    )
    parser.add_argument("--input-dir", type=Path, default=project_root / "data")
    parser.add_argument("--output-dir", type=Path, default=project_root / "data" / "web-parquet")
    parser.add_argument("--chunk-size", type=int, default=100_000)
    parser.add_argument("--countries", nargs="+")
    parser.add_argument(
        "--index-existing",
        action="store_true",
        help="Add file date ranges to an already-built dataset manifest without rebuilding Parquet.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if args.index_existing:
        if args.countries:
            parser.error("--countries cannot be used with --index-existing.")
        manifest = index_existing_web_dataset(args.output_dir)
    else:
        manifest = build_web_dataset(
            args.input_dir,
            args.output_dir,
            chunk_size=args.chunk_size,
            countries=tuple(args.countries) if args.countries else None,
        )
    print(
        f"Built {manifest['record_count']:,} observations in "
        f"{manifest['parquet_file_count']:,} Parquet files under {args.output_dir}"
    )


if __name__ == "__main__":
    main()
