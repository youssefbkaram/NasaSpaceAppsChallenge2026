from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import numpy as np
import pandas as pd
from pyproj import Transformer

from .schema import CSV_ALIASES, STANDARD_COLUMNS
from .sources import SourceFile


_WGS84_TO_EQUAL_AREA = Transformer.from_crs(
    "EPSG:4326", "EPSG:6933", always_xy=True
)
_MISSING_STRINGS = {"", "na", "n/a", "nan", "null", "none"}
_NUMERIC_FIELDS = {
    "latitude",
    "longitude",
    "confidence_numeric",
    "frp",
    "frp_mw",
    "brightness_temperature",
    "bright_t31",
    "scan",
    "track",
}


def _clean(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    result = str(value).strip()
    return None if result.casefold() in _MISSING_STRINGS else result


def _source_field_map(columns: list[str]) -> dict[str, str]:
    by_normalized = {str(column).strip().casefold(): str(column) for column in columns}
    return {
        target: source
        for target, aliases in CSV_ALIASES.items()
        for alias in aliases
        if (source := by_normalized.get(alias.casefold())) is not None
    }


def _canonical_satellite(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"[\s_-]+", "", value).casefold()
    aliases = {
        "terra": "Terra",
        "aqua": "Aqua",
        "snpp": "Suomi-NPP",
        "suominpp": "Suomi-NPP",
        "n20": "NOAA-20",
        "noaa20": "NOAA-20",
        "noaa20viirs": "NOAA-20",
        "n21": "NOAA-21",
        "noaa21": "NOAA-21",
        "noaa21viirs": "NOAA-21",
    }
    return aliases.get(normalized)


def _canonical_instrument(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    return "VIIRS" if normalized == "SNPP" else normalized


def _sensor_name(instrument: str | None, satellite: str | None) -> str | None:
    if not instrument or not satellite:
        return None
    family = instrument.strip().upper()
    if family == "MODIS" and satellite in {"Terra", "Aqua"}:
        return f"MODIS_{satellite.upper()}"
    if family == "VIIRS" and satellite == "Suomi-NPP":
        return "VIIRS_SNPP"
    if family == "VIIRS" and satellite in {"NOAA-20", "NOAA-21"}:
        return f"VIIRS_{satellite.replace('-', '')}"
    return None


def normalize_chunk(
    raw: pd.DataFrame,
    source: SourceFile,
    input_root: str,
    first_row_number: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    source_columns = [str(column) for column in raw.columns]
    source_fields = _source_field_map(source_columns)
    frame = pd.DataFrame(index=raw.index)

    def field(name: str) -> pd.Series:
        original = source_fields.get(name)
        if original is None:
            return pd.Series([None] * len(raw), index=raw.index, dtype="object")
        return raw[original].map(_clean)

    for name in CSV_ALIASES:
        frame[name] = field(name)

    # For shapefiles, use point geometry only when a coordinate column is absent.
    if source.file_format == "shp" and hasattr(raw, "geometry"):
        geometry = raw.geometry
        if "latitude" not in source_fields:
            frame["latitude"] = geometry.map(
                lambda point: None if point is None or point.is_empty else str(point.y)
            )
        if "longitude" not in source_fields:
            frame["longitude"] = geometry.map(
                lambda point: None if point is None or point.is_empty else str(point.x)
            )

    frame["source_row_number"] = np.arange(
        first_row_number, first_row_number + len(frame), dtype=np.int64
    )
    frame["source_product"] = source.source_product
    frame["country"] = source.country
    frame["quality"] = source.quality
    frame["acquisition_time"] = frame["acquisition_time"].map(
        lambda value: value.zfill(4) if value and value.isdigit() and len(value) <= 4 else value
    )

    date_values = pd.to_datetime(
        frame["acquisition_date"], format="%Y-%m-%d", errors="coerce", utc=True
    )
    frame["acquisition_date"] = date_values.dt.strftime("%Y-%m-%d")
    frame["acquisition_datetime_utc"] = None
    valid_time = frame["acquisition_time"].map(
        lambda value: bool(value and re.fullmatch(r"\d{4}", value))
        and int(value[:2]) < 24
        and int(value[2:]) < 60
    )
    valid_datetime = date_values.notna() & valid_time
    frame.loc[valid_datetime, "acquisition_datetime_utc"] = (
        date_values.loc[valid_datetime].dt.strftime("%Y-%m-%d")
        + "T"
        + frame.loc[valid_datetime, "acquisition_time"].astype(str).str.slice(0, 2)
        + ":"
        + frame.loc[valid_datetime, "acquisition_time"].astype(str).str.slice(2, 4)
        + ":00Z"
    )
    frame["acquisition_datetime"] = frame["acquisition_datetime_utc"]

    frame["satellite_original"] = frame["satellite"]
    frame["satellite"] = frame["satellite"].map(_canonical_satellite)
    frame["instrument"] = frame["instrument"].map(_canonical_instrument)
    frame["sensor"] = [
        _sensor_name(instrument, satellite)
        for instrument, satellite in zip(frame["instrument"], frame["satellite"])
    ]
    frame["confidence"] = frame["confidence_original"]
    frame["confidence_raw"] = frame["confidence_original"]
    frame["confidence_numeric"] = pd.to_numeric(
        frame["confidence_original"], errors="coerce"
    )
    for name in _NUMERIC_FIELDS:
        if name in frame:
            frame[name] = pd.to_numeric(frame[name], errors="coerce")
    frame["frp_mw"] = frame["frp"]
    frame["processing_version"] = frame["version"]

    modis_confidence = frame["sensor"].fillna("").str.startswith("MODIS_")
    viirs_confidence = frame["sensor"].fillna("").str.startswith("VIIRS_")
    confidence_numeric = frame["confidence_numeric"]

    categories = pd.Series([None] * len(frame), index=frame.index, dtype="object")
    viirs_cat_map = {"l": "low", "n": "nominal", "h": "high"}
    viirs_mask = viirs_confidence & frame["confidence_original"].notna()
    if viirs_mask.any():
        categories.loc[viirs_mask] = (
            frame.loc[viirs_mask, "confidence_original"]
            .astype(str)
            .str.strip()
            .str.casefold()
            .map(viirs_cat_map)
        )
    modis_mask = modis_confidence & confidence_numeric.notna()
    if modis_mask.any():
        modis_num = confidence_numeric.loc[modis_mask]
        modis_cat = pd.cut(
            modis_num,
            bins=[-np.inf, 29.999, 79.999, np.inf],
            labels=["low", "nominal", "high"],
        ).astype(str)
        categories.loc[modis_mask] = modis_cat
    frame["confidence_category"] = categories

    frame["daynight"] = frame["daynight"].map(
        lambda value: value.upper() if value else None
    )
    frame["source_attributes_json"] = [
        json.dumps(
            {str(column): _clean(value) for column, value in row.items()},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        for row in raw.to_dict(orient="records")
    ]
    relative_source = source.path.as_posix()
    try:
        relative_source = source.path.resolve().relative_to(input_root).as_posix()
    except ValueError:
        pass
    frame["source_file"] = relative_source
    frame["observation_id"] = [
        hashlib.sha256(
            f"{relative_source}\0{row_number}".encode("utf-8")
        ).hexdigest()
        for row_number in frame["source_row_number"]
    ]

    reasons: list[list[str]] = [[] for _ in range(len(frame))]

    def mark(mask: pd.Series | np.ndarray, reason: str) -> None:
        for index in np.flatnonzero(np.asarray(mask, dtype=bool)):
            reasons[int(index)].append(reason)

    mark(frame["latitude"].isna() | frame["longitude"].isna(), "missing_coordinates")
    mark(
        frame["latitude"].notna()
        & ~frame["latitude"].between(-90, 90)
        | frame["longitude"].notna()
        & ~frame["longitude"].between(-180, 180),
        "invalid_coordinates",
    )
    mark(date_values.isna(), "invalid_or_missing_date")
    mark(~valid_time, "invalid_or_missing_time")
    mark(frame["frp"].isna(), "missing_or_invalid_frp")
    mark(frame["frp"].notna() & (frame["frp"] < 0), "negative_frp")
    mark(frame["frp"].notna() & (frame["frp"] == 0), "zero_frp")
    mark(frame["satellite"].isna(), "missing_or_unrecognized_satellite")
    mark(frame["instrument"].isna(), "missing_instrument")
    mark(frame["sensor"].isna(), "unrecognized_sensor_platform")
    mark(
        frame["daynight"].notna() & ~frame["daynight"].isin({"D", "N"}),
        "unexpected_daynight_value",
    )
    mark(
        frame["brightness_temperature"].notna()
        & ~frame["brightness_temperature"].between(150, 600),
        "suspicious_brightness_temperature",
    )
    mark(
        frame["bright_t31"].notna()
        & ~frame["bright_t31"].between(150, 450),
        "suspicious_bright_t31",
    )
    mark(
        (frame["scan"].notna() & (frame["scan"] <= 0))
        | (frame["track"].notna() & (frame["track"] <= 0)),
        "invalid_scan_or_track",
    )

    mark(
        modis_confidence
        & frame["confidence_original"].notna()
        & (confidence_numeric.isna() | ~confidence_numeric.between(0, 100)),
        "unexpected_modis_confidence",
    )
    mark(
        viirs_confidence
        & frame["confidence_original"].notna()
        & ~frame["confidence_original"].str.casefold().isin({"l", "n", "h", "low", "nominal", "high"}),
        "unexpected_viirs_confidence",
    )

    fatal_reasons = {
        "missing_coordinates",
        "invalid_coordinates",
        "invalid_or_missing_date",
        "invalid_or_missing_time",
        "missing_or_unrecognized_satellite",
        "missing_instrument",
        "unrecognized_sensor_platform",
        "missing_or_invalid_frp",
        "negative_frp",
        "invalid_scan_or_track",
    }
    frame["validation_reasons"] = [
        ";".join(row_reasons) for row_reasons in reasons
    ]
    frame["boundary_check_status"] = "not_checked_missing_boundary_data"
    frame["validation_status"] = [
        "invalid"
        if fatal_reasons.intersection(row_reasons)
        else "review"
        if row_reasons
        else "valid"
        for row_reasons in reasons
    ]

    valid_coordinates = frame["latitude"].between(-90, 90) & frame["longitude"].between(
        -180, 180
    )
    x_values, y_values = _WGS84_TO_EQUAL_AREA.transform(
        frame["longitude"].where(valid_coordinates).to_numpy(dtype=float, na_value=np.nan),
        frame["latitude"].where(valid_coordinates).to_numpy(dtype=float, na_value=np.nan),
    )
    frame["equal_area_x_m"] = x_values
    frame["equal_area_y_m"] = y_values
    frame["duplicate_record"] = False

    for column in STANDARD_COLUMNS:
        if column not in frame:
            frame[column] = None
    frame["source_attributes_json"] = frame["source_attributes_json"].astype("string")
    frame["equal_area_x_m"] = pd.to_numeric(frame["equal_area_x_m"], errors="coerce")
    frame["equal_area_y_m"] = pd.to_numeric(frame["equal_area_y_m"], errors="coerce")
    return frame, {
        "source_columns": source_columns,
        "missing_standard_fields": sorted(
            target
            for target, aliases in CSV_ALIASES.items()
            if not any(alias.casefold() in {c.strip().casefold() for c in source_columns} for alias in aliases)
        ),
        "unexpected_source_columns": sorted(
            column
            for column in source_columns
            if column.strip().casefold()
            not in {
                alias.casefold()
                for aliases in CSV_ALIASES.values()
                for alias in aliases
            }
        ),
        "rows": len(frame),
        "invalid_rows": int(frame["validation_status"].eq("invalid").sum()),
        "review_rows": int(frame["validation_status"].eq("review").sum()),
        "missing_frp_rows": int(frame["frp"].isna().sum()),
    }
