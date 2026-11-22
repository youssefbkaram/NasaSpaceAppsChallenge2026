import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from firms_harmonization.calendar import build_monthly_calendar
from firms_harmonization.config import PipelineConfig


def test_calendar_marks_unobserved_months_unknown_instead_of_zero(tmp_path) -> None:
    aggregate = tmp_path / "monthly.parquet"
    pq.write_table(
        pa.Table.from_pandas(
            pd.DataFrame(
                [
                    {
                        "country": "Testland",
                        "year": 2020,
                        "month": 1,
                        "sensor": "MODIS_TERRA",
                        "detection_count": 3,
                    },
                    {
                        "country": "Testland",
                        "year": 2020,
                        "month": 1,
                        "sensor": "VIIRS_SNPP",
                        "detection_count": 5,
                    },
                    {
                        "country": "Testland",
                        "year": 2020,
                        "month": 3,
                        "sensor": "MODIS_TERRA",
                        "detection_count": 2,
                    },
                ]
            ),
            preserve_index=False,
        ),
        aggregate,
    )
    output = build_monthly_calendar(
        PipelineConfig(
            input_dir=tmp_path,
            output_dir=tmp_path / "run",
            grid_resolutions_m=(5_000,),
            primary_grid_resolution_m=5_000,
        ),
        aggregate,
    )

    calendar = pd.read_csv(output)
    february = calendar.loc[calendar["month"].eq(2)].iloc[0]
    january = calendar.loc[calendar["month"].eq(1)].iloc[0]
    assert february["availability_status"] == "no_observation_records_coverage_unknown"
    assert pd.isna(february["modis_terra_count"])
    assert january["modis_terra_count"] == 3
    assert january["viirs_snpp_count"] == 5
    assert pd.isna(january["viirs_noaa20_count"])
