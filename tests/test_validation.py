from pathlib import Path

import pandas as pd

from firms_harmonization.sources import SourceFile
from firms_harmonization.validation import normalize_chunk


def _source(tmp_path: Path, product: str, filename: str) -> SourceFile:
    country_dir = tmp_path / "Testland" / f"DL_FIRE_{product}"
    country_dir.mkdir(parents=True)
    path = country_dir / filename
    path.touch()
    processing = "nrt" if "nrt" in filename else "archive"
    return SourceFile(path, "Testland", f"DL_FIRE_{product}", processing, "csv")


def test_normalization_preserves_sensor_specific_confidence_and_flags_bad_rows(
    tmp_path: Path,
) -> None:
    modis = _source(
        tmp_path,
        "M-C61_900001",
        "fire_archive_M-C61_900001.csv",
    )
    raw_modis = pd.DataFrame(
        [
            {
                "latitude": "10",
                "longitude": "20",
                "brightness": "330.1",
                "scan": "1",
                "track": "1",
                "acq_date": "2020-01-02",
                "acq_time": "45",
                "satellite": "Terra",
                "instrument": "MODIS",
                "confidence": "85",
                "version": "6.1",
                "bright_t31": "290",
                "frp": "12.5",
                "daynight": "D",
                "type": "0",
            },
            {
                "latitude": "95",
                "longitude": "20",
                "brightness": "330",
                "scan": "1",
                "track": "1",
                "acq_date": "not-a-date",
                "acq_time": "2500",
                "satellite": "Terra",
                "instrument": "MODIS",
                "confidence": "85",
                "version": "6.1",
                "bright_t31": "290",
                "frp": "",
                "daynight": "D",
                "type": "",
            },
        ]
    )

    normalized, report = normalize_chunk(
        raw_modis, modis, str(tmp_path), first_row_number=2
    )

    assert normalized.loc[0, "sensor"] == "MODIS_TERRA"
    assert normalized.loc[0, "confidence_original"] == "85"
    assert normalized.loc[0, "confidence_numeric"] == 85
    assert normalized.loc[0, "acquisition_time"] == "0045"
    assert normalized.loc[0, "validation_status"] == "valid"
    assert normalized.loc[1, "validation_status"] == "invalid"
    assert "invalid_coordinates" in normalized.loc[1, "validation_reasons"]
    assert report["rows"] == 2
    assert report["invalid_rows"] == 1


def test_viirs_categorical_confidence_is_not_converted_to_numeric(tmp_path: Path) -> None:
    viirs = _source(
        tmp_path,
        "SV-C2_900002",
        "fire_archive_SV-C2_900002.csv",
    )
    raw = pd.DataFrame(
        [
            {
                "latitude": "10",
                "longitude": "20",
                "brightness": "330",
                "scan": "1",
                "track": "1",
                "acq_date": "2020-01-02",
                "acq_time": "1210",
                "satellite": "SNPP",
                "instrument": "SNPP",
                "confidence": "n",
                "version": "2",
                "bright_t31": "290",
                "frp": "3.2",
                "daynight": "N",
            }
        ]
    )

    normalized, _ = normalize_chunk(raw, viirs, str(tmp_path), 2)

    assert normalized.loc[0, "sensor"] == "VIIRS_SNPP"
    assert normalized.loc[0, "instrument"] == "VIIRS"
    assert normalized.loc[0, "confidence_original"] == "n"
    assert pd.isna(normalized.loc[0, "confidence_numeric"])
    assert normalized.loc[0, "validation_status"] == "valid"
    assert normalized.loc[0, "fire_type"] is None


def test_stage2_validation_flags_negative_frp_and_suspicious_values(tmp_path: Path) -> None:
    source = _source(tmp_path, "M-C61_900003", "fire_archive_M-C61_900003.csv")
    raw = pd.DataFrame(
        [
            {
                # Valid MODIS record
                "latitude": "15.5",
                "longitude": "32.5",
                "brightness": "325.4",
                "scan": "1.2",
                "track": "1.1",
                "acq_date": "2023-05-10",
                "acq_time": "1030",
                "satellite": "Aqua",
                "instrument": "MODIS",
                "confidence": "85",
                "version": "6.1",
                "bright_t31": "295.2",
                "frp": "24.5",
                "daynight": "D",
                "type": "0",
            },
            {
                # Negative FRP (found in Brazil archive) -> fatal / invalid
                "latitude": "-12.0",
                "longitude": "-55.0",
                "brightness": "310.0",
                "scan": "1.0",
                "track": "1.0",
                "acq_date": "2023-05-10",
                "acq_time": "1340",
                "satellite": "Terra",
                "instrument": "MODIS",
                "confidence": "50",
                "version": "6.1",
                "bright_t31": "290.0",
                "frp": "-1.0",
                "daynight": "D",
                "type": "0",
            },
            {
                # Zero FRP -> review flag
                "latitude": "-10.0",
                "longitude": "-50.0",
                "brightness": "305.0",
                "scan": "1.0",
                "track": "1.0",
                "acq_date": "2023-05-10",
                "acq_time": "1340",
                "satellite": "Terra",
                "instrument": "MODIS",
                "confidence": "45",
                "version": "6.1",
                "bright_t31": "290.0",
                "frp": "0.0",
                "daynight": "D",
                "type": "0",
            },
            {
                # Physically impossible brightness & scan <= 0
                "latitude": "20.0",
                "longitude": "30.0",
                "brightness": "850.0",  # Suspicious (>600K)
                "scan": "0.0",          # Invalid scan dimension (<=0)
                "track": "1.0",
                "acq_date": "2023-05-10",
                "acq_time": "1030",
                "satellite": "Aqua",
                "instrument": "MODIS",
                "confidence": "80",
                "version": "6.1",
                "bright_t31": "290.0",
                "frp": "10.0",
                "daynight": "D",
                "type": "0",
            },
        ]
    )

    normalized, report = normalize_chunk(raw, source, str(tmp_path), 1)

    # Record 0: Valid
    assert normalized.loc[0, "validation_status"] == "valid"
    assert normalized.loc[0, "confidence_category"] == "high"
    assert normalized.loc[0, "frp_mw"] == 24.5
    assert normalized.loc[0, "processing_version"] == "6.1"
    assert normalized.loc[0, "acquisition_datetime"] == "2023-05-10T10:30:00Z"

    # Record 1: Negative FRP
    assert normalized.loc[1, "validation_status"] == "invalid"
    assert "negative_frp" in normalized.loc[1, "validation_reasons"]

    # Record 2: Zero FRP (Review status)
    assert normalized.loc[2, "validation_status"] == "review"
    assert "zero_frp" in normalized.loc[2, "validation_reasons"]
    assert normalized.loc[2, "confidence_category"] == "nominal"

    # Record 3: Suspicious brightness + Invalid scan
    assert normalized.loc[3, "validation_status"] == "invalid"
    assert "invalid_scan_or_track" in normalized.loc[3, "validation_reasons"]
    assert "suspicious_brightness_temperature" in normalized.loc[3, "validation_reasons"]


def test_viirs_confidence_category_mapping(tmp_path: Path) -> None:
    source = _source(tmp_path, "J1V-C2_900004", "fire_archive_J1V-C2_900004.csv")
    raw = pd.DataFrame(
        [
            {"latitude": "10", "longitude": "20", "brightness": "320", "scan": "0.4", "track": "0.4", "acq_date": "2023-01-01", "acq_time": "0100", "satellite": "NOAA-20", "instrument": "VIIRS", "confidence": "l", "version": "2.0", "bright_t31": "290", "frp": "1.5", "daynight": "N"},
            {"latitude": "10", "longitude": "20", "brightness": "330", "scan": "0.4", "track": "0.4", "acq_date": "2023-01-01", "acq_time": "0100", "satellite": "NOAA-20", "instrument": "VIIRS", "confidence": "n", "version": "2.0", "bright_t31": "290", "frp": "2.5", "daynight": "N"},
            {"latitude": "10", "longitude": "20", "brightness": "340", "scan": "0.4", "track": "0.4", "acq_date": "2023-01-01", "acq_time": "0100", "satellite": "NOAA-20", "instrument": "VIIRS", "confidence": "h", "version": "2.0", "bright_t31": "290", "frp": "5.0", "daynight": "N"},
        ]
    )
    normalized, _ = normalize_chunk(raw, source, str(tmp_path), 1)
    assert normalized.loc[0, "confidence_category"] == "low"
    assert normalized.loc[1, "confidence_category"] == "nominal"
    assert normalized.loc[2, "confidence_category"] == "high"
    assert normalized.loc[0, "confidence_raw"] == "l"

