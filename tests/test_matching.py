import pandas as pd

from firms_harmonization.matching import _candidate_pairs


def test_candidate_matching_respects_distance_and_cross_midnight_time_window() -> None:
    modis = pd.DataFrame(
        [
            {
                "observation_id": "m-1",
                "sensor": "MODIS_TERRA",
                "equal_area_x_m": 1000.0,
                "equal_area_y_m": 2000.0,
                "acquisition_datetime_utc": "2020-01-01T23:50:00Z",
            }
        ]
    )
    viirs = pd.DataFrame(
        [
            {
                "observation_id": "v-1",
                "sensor": "VIIRS_SNPP",
                "equal_area_x_m": 1300.0,
                "equal_area_y_m": 2000.0,
                "acquisition_datetime_utc": "2020-01-02T00:10:00Z",
            },
            {
                "observation_id": "v-2",
                "sensor": "VIIRS_SNPP",
                "equal_area_x_m": 20_000.0,
                "equal_area_y_m": 20_000.0,
                "acquisition_datetime_utc": "2020-01-02T00:10:00Z",
            },
        ]
    )

    pairs, matched, temporally_eligible = _candidate_pairs(
        modis, viirs, max_distance_m=1_000, max_time_minutes=60
    )

    assert [(pair["modis_observation_id"], pair["viirs_observation_id"]) for pair in pairs] == [
        ("m-1", "v-1")
    ]
    assert matched == {"m-1", "v-1"}
    assert temporally_eligible == {"m-1", "v-1", "v-2"}
    assert pairs[0]["time_difference_minutes"] == 20
    assert pairs[0]["multiplicity_type"] == "one_to_one"


def test_candidate_matching_identifies_one_modis_to_many_viirs_multiplicity() -> None:
    modis = pd.DataFrame(
        [
            {
                "observation_id": "m-single",
                "sensor": "MODIS_AQUA",
                "equal_area_x_m": 5000.0,
                "equal_area_y_m": 5000.0,
                "acquisition_datetime_utc": "2023-08-15T13:30:00Z",
            }
        ]
    )
    # Two distinct VIIRS detections within 1km of the single MODIS 1km footprint
    viirs = pd.DataFrame(
        [
            {
                "observation_id": "v-subpixel-1",
                "sensor": "VIIRS_NOAA20",
                "equal_area_x_m": 5200.0,
                "equal_area_y_m": 5100.0,
                "acquisition_datetime_utc": "2023-08-15T13:40:00Z",
            },
            {
                "observation_id": "v-subpixel-2",
                "sensor": "VIIRS_NOAA20",
                "equal_area_x_m": 4900.0,
                "equal_area_y_m": 5050.0,
                "acquisition_datetime_utc": "2023-08-15T13:40:00Z",
            },
        ]
    )

    pairs, matched, _ = _candidate_pairs(
        modis, viirs, max_distance_m=1_000, max_time_minutes=30
    )

    assert len(pairs) == 2
    assert matched == {"m-single", "v-subpixel-1", "v-subpixel-2"}
    assert pairs[0]["multiplicity_type"] == "one_modis_to_many_viirs"
    assert pairs[1]["multiplicity_type"] == "one_modis_to_many_viirs"

