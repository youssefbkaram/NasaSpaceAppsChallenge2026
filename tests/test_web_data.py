import csv
import gzip
import json
from http.server import ThreadingHTTPServer
from threading import BoundedSemaphore, Thread
from urllib.request import Request, urlopen

from firms_harmonization.web_api import (
    _observation,
    _validate_query,
    make_handler,
    query_observations,
)
from firms_harmonization.web_data import build_web_dataset, index_existing_web_dataset


def _write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def _record(date, satellite, confidence, fire_type="0"):
    return {
        "latitude": "25.0",
        "longitude": "30.0",
        "brightness": "330.0",
        "scan": "1.0",
        "track": "1.0",
        "acq_date": date,
        "acq_time": "1200",
        "satellite": satellite,
        "instrument": "MODIS" if satellite in {"T", "A"} else "VIIRS",
        "confidence": confidence,
        "version": "test-version",
        "bright_t31": "290.0",
        "frp": "4.5",
        "daynight": "D",
        "type": fire_type,
    }


def test_web_dataset_build_preserves_map_fields_and_query_partitions(tmp_path):
    data_dir = tmp_path / "input"
    output_dir = tmp_path / "web-parquet"
    modis_dir = data_dir / "Testland" / "DL_FIRE_M-C61_900001"
    viirs_dir = data_dir / "Testland" / "DL_FIRE_SV-C2_900002"
    _write_csv(
        modis_dir / "fire_archive_M-C61_900001.csv",
        [
            _record("2024-01-02", "T", "75"),
            _record("2024-01-03", "A", "80"),
        ],
    )
    viirs_record = _record("2024-01-03", "N", "n")
    viirs_record.pop("type")
    _write_csv(viirs_dir / "fire_nrt_SV-C2_900002.csv", [viirs_record])
    egypt_dir = data_dir / "Egypt" / "DL_FIRE_M-C61_848199"
    egypt_inside = _record("2024-01-03", "T", "75")
    egypt_outside = _record("2024-01-03", "T", "75")
    egypt_outside["latitude"] = "10.0"
    egypt_outside["longitude"] = "0.0"
    _write_csv(
        egypt_dir / "fire_archive_M-C61_848199.csv",
        [egypt_inside, egypt_outside],
    )

    manifest = build_web_dataset(data_dir, output_dir, chunk_size=1)

    assert manifest["record_count"] == 5
    assert manifest["countries"]["testland"]["records"] == 3
    testland_file = next(file for file in manifest["files"] if file["country_id"] == "testland")
    assert testland_file["first_date"] == "2024-01-02"
    assert testland_file["last_date"] == "2024-01-03"
    assert testland_file["record_count"] == 2
    refreshed_manifest = index_existing_web_dataset(output_dir)
    assert refreshed_manifest["record_count"] == 5
    assert len(refreshed_manifest["files"]) == manifest["parquet_file_count"]
    assert next(
        file for file in refreshed_manifest["files"] if file["country_id"] == "testland"
    )["first_date"] == "2024-01-02"
    rows = [
        _observation(row)
        for row in query_observations(
            output_dir,
            "testland",
            "2024-01-03",
            "2024-01-03",
        )
    ]

    assert len(rows) == 2
    modis = next(row for row in rows if row["instrument"] == "MODIS")
    viirs = next(row for row in rows if row["instrument"] == "VIIRS")
    assert modis["satellite"] == "Aqua"
    assert modis["confidence"] == 80
    assert modis["quality"] == "SP"
    assert modis["dataOrigin"] == "NASA FIRMS local"
    assert viirs["satellite"] == "Suomi-NPP"
    assert viirs["confidence"] == "n"
    assert viirs["quality"] == "NRT"
    assert "type" not in viirs
    all_country_rows = list(query_observations(
        output_dir,
        "all",
        "2024-01-03",
        "2024-01-03",
    ))
    egypt_rows = list(query_observations(
        output_dir,
        "egypt",
        "2024-01-03",
        "2024-01-03",
    ))
    assert len(all_country_rows) == 3
    assert len(egypt_rows) == 1

    handler = make_handler(
        output_dir,
        manifest,
        {"http://localhost:5173"},
        BoundedSemaphore(1),
        1,
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = Request(
            f"http://127.0.0.1:{server.server_port}/api/local-firms/data"
            "?region=testland&date=2024-01-03&days=1",
            headers={
                "Accept-Encoding": "gzip",
                "Origin": "http://localhost:5173",
            },
        )
        with urlopen(request) as response:
            body = gzip.decompress(response.read())
            assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert len(json.loads(body)) == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_web_api_query_validation_rejects_bad_region_and_range():
    countries = {"egypt": {}, "testland": {}}
    valid_params = {"region": ["egypt"], "date": ["2024-01-01"], "days": ["90"]}
    assert _validate_query(valid_params, countries) == (
        "egypt",
        "2024-01-01",
        "2024-03-30",
        90,
    )

    try:
        _validate_query(
            {"region": ["missing"], "date": ["2024-01-01"], "days": ["1"]},
            countries,
        )
    except ValueError as error:
        assert "country" in str(error)
    else:
        raise AssertionError("Unknown countries must be rejected.")

    try:
        _validate_query(
            {"region": ["all"], "date": ["2024-01-01"], "days": ["91"]},
            countries,
        )
    except ValueError as error:
        assert "1 to 90" in str(error)
    else:
        raise AssertionError("Date ranges over 90 days must be rejected.")


def test_web_api_query_validation_rejects_dates_before_inventory():
    try:
        _validate_query(
            {"region": ["all"], "date": ["1999-12-31"], "days": ["1"]},
            {"all": {}, "egypt": {}},
        )
    except ValueError as error:
        assert "2000-11-01" in str(error)
    else:
        raise AssertionError("Dates before the FIRMS MODIS inventory must be rejected.")
