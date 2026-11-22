import csv
import json
from datetime import date

import numpy as np
import pytest

import firms_harmonization.coverage_data as coverage_data
from firms_harmonization.coverage_data import (
    _aggregate_mask_classes,
    _grid_assignment,
    _granule_overlaps_dates,
    _granule_start_date,
    _iter_granule_rows,
    _modis_band_dates,
    load_aoi_geojson,
    _search_and_download,
)
from rasterio.crs import CRS
from rasterio.transform import from_origin
from shapely.geometry import box


def test_firemask_classes_count_only_valid_land_and_fire_pixel_days() -> None:
    fire_mask = np.array([[0, 3, 4, 5, 6], [7, 8, 9, 1, 255]], dtype=np.uint8)
    cell_index = np.zeros(fire_mask.shape, dtype=np.int32)
    inside = np.ones(fire_mask.shape, dtype=bool)

    counts = _aggregate_mask_classes(fire_mask, cell_index, inside)

    assert counts.shape == (1, 11)
    assert counts[0, 5] == 1
    assert counts[0, 7:10].tolist() == [1, 1, 1]
    assert sum(counts[0, value] for value in (5, 7, 8, 9)) == 4
    assert sum(counts[0, value] for value in (7, 8, 9)) == 3
    assert counts[0, 10] == 1


def test_firemask_rejects_undocumented_values() -> None:
    fire_mask = np.array([[5, 254]], dtype=np.uint8)
    cell_index = np.zeros(fire_mask.shape, dtype=np.int32)
    inside = np.ones(fire_mask.shape, dtype=bool)

    with pytest.raises(ValueError, match="documented 0-9 classes"):
        _aggregate_mask_classes(fire_mask, cell_index, inside)


def test_modis_dates_use_product_metadata_when_available() -> None:
    dates, source = _modis_band_dates(
        {"Dates": "2024-01-01 2024-01-02"},
        date(2024, 1, 1),
        band_count=2,
    )

    assert dates == [date(2024, 1, 1), date(2024, 1, 2)]
    assert source == "product_data_days_metadata"


def test_modis_dates_fall_back_to_granule_start_for_missing_metadata() -> None:
    dates, source = _modis_band_dates({}, date(2023, 12, 31), band_count=2)

    assert dates == [date(2023, 12, 31), date(2024, 1, 1)]
    assert source == "granule_start_plus_band_index"


def test_granule_start_date_parses_year_and_day_of_year(tmp_path) -> None:
    path = tmp_path / "VNP14A1.A2024366.h21v06.002.sample.h5"

    assert _granule_start_date(path) == date(2024, 12, 31)


def test_granule_start_date_rejects_non_leap_year_day_366(tmp_path) -> None:
    path = tmp_path / "VNP14A1.A2023366.h21v06.002.sample.h5"

    with pytest.raises(ValueError, match="Invalid year/day"):
        _granule_start_date(path)


def test_modis_granule_is_selected_when_its_eight_day_window_overlaps(
    tmp_path,
) -> None:
    path = tmp_path / "MOD14A1.A2024001.h09v05.061.sample.hdf"

    assert _granule_overlaps_dates(path, date(2024, 1, 8), date(2024, 1, 8))
    assert not _granule_overlaps_dates(path, date(2024, 1, 9), date(2024, 1, 9))


def test_load_aoi_geojson_accepts_wgs84_polygon(tmp_path) -> None:
    path = tmp_path / "aoi.geojson"
    path.write_text(
        json.dumps(
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[30, 20], [31, 20], [31, 21], [30, 21], [30, 20]]
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    geometry = load_aoi_geojson(path)

    assert geometry.bounds == (30.0, 20.0, 31.0, 21.0)


def test_download_requires_a_local_earthdata_token(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="Set EARTHDATA_TOKEN"):
        _search_and_download(
            date(2024, 1, 1),
            date(2024, 1, 7),
            (30, 20, 31, 21),
            ["VNP14A1"],
            tmp_path,
            10,
        )


def test_equal_area_grid_assignment_uses_only_pixels_inside_aoi() -> None:
    transform = from_origin(0, 0.0002, 0.0001, 0.0001)
    aoi = box(0, 0, 0.0002, 0.0002)

    cell_index, min_grid_x, min_grid_y, grid_width, inside = _grid_assignment(
        2,
        2,
        transform,
        CRS.from_epsg(4326),
        aoi,
        resolution_m=20,
    )
    mask = np.array([[5, 7], [8, 9]], dtype=np.uint8)
    counts = _aggregate_mask_classes(mask, cell_index, inside)

    assert inside.sum() == 4
    assert (min_grid_x, min_grid_y, grid_width) == (0, 0, 1)
    assert counts[0, 5:10].tolist() == [1, 0, 1, 1, 1]


def test_viirs_granule_rows_keep_fill_separate_from_valid_exposure(monkeypatch, tmp_path) -> None:
    granule = tmp_path / "VNP14A1.A2024001.h21v06.002.sample.h5"
    firemask = np.array([[5, 7], [8, 255]], dtype=np.uint8)
    geometry = box(0, 0, 0.0002, 0.0002)

    class FakeDataset:
        subdatasets = ["HDF5:sample.h5://FireMask"]
        crs = CRS.from_epsg(4326)
        transform = from_origin(0, 0.0002, 0.0001, 0.0001)
        width = 2
        height = 2
        count = 1

        def __init__(self, is_container: bool) -> None:
            self.is_container = is_container

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def tags(self) -> dict[str, str]:
            return {}

        def read(self, _band: int) -> np.ndarray:
            return firemask

    def fake_open(path):
        return FakeDataset(is_container=path == granule)

    monkeypatch.setattr("firms_harmonization.coverage_data.rasterio.open", fake_open)

    rows = list(
        _iter_granule_rows(
            granule,
            geometry,
            date(2024, 1, 1),
            date(2024, 1, 1),
            "Egypt",
            20,
        )
    )

    assert len(rows) == 1
    assert rows[0]["product"] == "VNP14A1"
    assert rows[0]["valid_pixel_days"] == 3
    assert rows[0]["fire_pixel_days"] == 2
    assert rows[0]["firemask_fill_value_pixel_days"] == 1
    assert rows[0]["availability_status"] == "valid_land_pixel_day_present"


def test_process_coverage_writes_csv_and_manifest(tmp_path, monkeypatch) -> None:
    aoi_path = tmp_path / "egypt.geojson"
    aoi_path.write_text(
        json.dumps(
            {
                "type": "Polygon",
                "coordinates": [
                    [[30, 20], [31, 20], [31, 21], [30, 21], [30, 20]]
                ],
            }
        ),
        encoding="utf-8",
    )
    data_dir = tmp_path / "granules"
    data_dir.mkdir()
    (data_dir / "VNP14A1.A2024001.h21v06.002.sample.h5").write_bytes(b"fixture")
    output_path = tmp_path / "egypt-coverage.csv"
    monkeypatch.setattr(coverage_data, "_check_drivers", lambda _paths: None)
    monkeypatch.setattr(
        coverage_data,
        "_iter_granule_rows",
        lambda *_args: [
            {
                "country": "Egypt",
                "date": "2024-01-01",
                "valid_pixel_days": 3,
                "fire_pixel_days": 2,
            }
        ],
    )

    csv_path, manifest_path = coverage_data.process_coverage(
        aoi_path=aoi_path,
        data_dir=data_dir,
        output_path=output_path,
        start_date=date(2024, 1, 1),
        end_date=date(2024, 1, 7),
        country="Egypt",
        products=["VNP14A1"],
    )

    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        rows = list(csv.DictReader(csv_file))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert rows[0]["fire_pixel_days"] == "2"
    assert manifest["output_row_count"] == 1
    assert manifest["source_granules"] == [
        "VNP14A1.A2024001.h21v06.002.sample.h5"
    ]
