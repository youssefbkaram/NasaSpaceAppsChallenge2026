import json

import duckdb
import pandas as pd

from firms_harmonization.config import PipelineConfig
from firms_harmonization.duckdb_io import read_parquet_sql
from firms_harmonization.pipeline import run_pipeline


def _record(date: str, time: int, satellite: str, instrument: str, confidence: str, lat: float):
    return {
        "latitude": str(lat),
        "longitude": "-60.0",
        "brightness": "330.0",
        "scan": "1.0",
        "track": "1.0",
        "acq_date": date,
        "acq_time": f"{time:04d}",
        "satellite": satellite,
        "instrument": instrument,
        "confidence": confidence,
        "version": "test-version",
        "bright_t31": "290.0",
        "frp": "4.5",
        "daynight": "D",
        "type": "0",
    }


def test_pipeline_runs_on_realistic_firms_csv_shapes_and_writes_scientific_outputs(
    tmp_path,
) -> None:
    data_dir = tmp_path / "data"
    modis_dir = data_dir / "Testland" / "DL_FIRE_M-C61_900001"
    viirs_dir = data_dir / "Testland" / "DL_FIRE_SV-C2_900002"
    modis_dir.mkdir(parents=True)
    viirs_dir.mkdir(parents=True)
    modis_rows = []
    viirs_rows = []
    months = pd.date_range("2018-01-01", "2024-12-01", freq="MS")
    for index, timestamp in enumerate(months):
        if timestamp.strftime("%Y-%m") == "2020-02":
            continue
        acquisition_date = timestamp.strftime("%Y-%m-%d")
        modis_count = index % 4 + 1
        viirs_count = index % 3 + 2
        for detection in range(modis_count):
            modis_rows.append(
                _record(
                    acquisition_date,
                    1200 + detection,
                    "Terra",
                    "MODIS",
                    str(60 + index % 40),
                    -10.0 + detection * 0.0001,
                )
            )
        for detection in range(viirs_count):
            row = _record(
                acquisition_date,
                1210 + detection,
                "SNPP",
                "VIIRS",
                "n",
                -10.0 + detection * 0.0001,
            )
            row.pop("type")
            viirs_rows.append(row)
    modis_rows.append(modis_rows[0].copy())
    invalid = _record("2024-12-31", 1200, "Terra", "MODIS", "75", 95.0)
    modis_rows.append(invalid)

    pd.DataFrame(modis_rows).to_csv(
        modis_dir / "fire_archive_M-C61_900001.csv", index=False
    )
    pd.DataFrame(viirs_rows).to_csv(
        viirs_dir / "fire_archive_SV-C2_900002.csv", index=False
    )
    modis_nrt = _record("2024-12-15", 1215, "Terra", "MODIS", "75", -10.0)
    viirs_nrt = _record("2024-12-15", 1225, "SNPP", "VIIRS", "n", -10.0)
    viirs_nrt.pop("type")
    pd.DataFrame([modis_nrt]).to_csv(
        modis_dir / "fire_nrt_M-C61_900001.csv", index=False
    )
    pd.DataFrame([viirs_nrt]).to_csv(
        viirs_dir / "fire_nrt_SV-C2_900002.csv", index=False
    )

    output_dir = tmp_path / "processed" / "test-run"
    config = PipelineConfig(
        input_dir=data_dir,
        output_dir=output_dir,
        chunk_size=19,
        grid_resolutions_m=(1_000, 5_000),
        primary_grid_resolution_m=5_000,
        match_distance_thresholds_m=(1_000, 5_000),
        match_time_thresholds_minutes=(30, 60),
    )

    outputs = run_pipeline(config)

    standardized = output_dir / "standardized" / "observations"
    relation = read_parquet_sql(standardized, hive_partitioning=True)
    connection = duckdb.connect()
    try:
        total_rows = connection.execute(
            f"SELECT count(*) FROM {relation}"
        ).fetchone()[0]
        invalid_rows = connection.execute(
            f"SELECT count(*) FROM {relation} WHERE validation_status = 'invalid'"
        ).fetchone()[0]
        duplicate_rows = connection.execute(
            f"SELECT count(*) FROM {relation} WHERE duplicate_record"
        ).fetchone()[0]
        matched_rows = connection.execute(
            f"SELECT count(*) FROM read_parquet('{(output_dir / 'matched' / 'cross_sensor_candidates.parquet').as_posix()}')"
        ).fetchone()[0]
    finally:
        connection.close()

    calendar = pd.read_csv(output_dir / "aggregated" / "monthly_fire_calendar.csv")
    missing_month = calendar.loc[
        calendar["year"].eq(2020) & calendar["month"].eq(2)
    ].iloc[0]
    model_diagnostics = json.loads(
        (output_dir / "reports" / "harmonization_model_diagnostics.json").read_text(
            encoding="utf-8"
        )
    )
    harmonized = pd.read_csv(
        output_dir / "harmonized" / "monthly_relative_activity_index.csv"
    )

    assert len(outputs) >= 15
    assert total_rows == len(modis_rows) + len(viirs_rows) + 2
    assert invalid_rows == 1
    assert duplicate_rows == 1
    assert matched_rows > 0
    assert missing_month["availability_status"] == "no_observation_records_coverage_unknown"
    assert pd.isna(missing_month["modis_terra_count"])
    assert not harmonized.empty
    assert harmonized["relative_activity_index"].gt(0).all()
    assert harmonized["exposure_status"].str.contains("unavailable").all()
    assert harmonized["source_quality_information"].str.contains("NRT").any()
    assert model_diagnostics["exposure_available"] is False
    assert model_diagnostics["zero_observation_days_available"] is False
