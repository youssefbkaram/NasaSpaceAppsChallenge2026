from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
import hashlib
import logging
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from scipy.spatial import cKDTree

from .config import PipelineConfig
from .duckdb_io import read_parquet_sql

LOGGER = logging.getLogger(__name__)

_MATCH_SCHEMA = pa.schema(
    [
        ("match_id", pa.string()),
        ("country", pa.string()),
        ("acquisition_date", pa.string()),
        ("modis_observation_id", pa.string()),
        ("viirs_observation_id", pa.string()),
        ("modis_sensor", pa.string()),
        ("viirs_sensor", pa.string()),
        ("separation_m", pa.float64()),
        ("time_difference_minutes", pa.float64()),
        ("distance_threshold_m", pa.int32()),
        ("time_threshold_minutes", pa.int32()),
        ("match_confidence", pa.float64()),
        ("multiplicity_type", pa.string()),
        ("confidence_interpretation", pa.string()),
        ("matching_method", pa.string()),
    ]
)
_UNMATCHED_SCHEMA = pa.schema(
    [
        ("observation_id", pa.string()),
        ("country", pa.string()),
        ("acquisition_date", pa.string()),
        ("sensor", pa.string()),
        ("reason", pa.string()),
        ("interpretation", pa.string()),
    ]
)


class _ParquetBatchWriter:
    def __init__(self, path: Path, schema: pa.Schema, flush_size: int = 50_000):
        self.path = path
        self.schema = schema
        self.flush_size = flush_size
        self.writer = pq.ParquetWriter(path, schema, compression="zstd")
        self.rows: list[dict[str, Any]] = []

    def append(self, row: dict[str, Any]) -> None:
        self.rows.append(row)
        if len(self.rows) >= self.flush_size:
            self.flush()

    def flush(self) -> None:
        if self.rows:
            self.writer.write_table(
                pa.Table.from_pylist(self.rows, schema=self.schema)
            )
            self.rows.clear()

    def close(self) -> None:
        self.flush()
        self.writer.close()


def _candidate_pairs(
    modis: pd.DataFrame,
    viirs: pd.DataFrame,
    max_distance_m: int,
    max_time_minutes: int,
) -> tuple[list[dict[str, Any]], set[str], set[str]]:
    modis = modis.reset_index(drop=True)
    viirs = viirs.reset_index(drop=True)
    if modis.empty or viirs.empty:
        return [], set(), set()

    viirs_xy = viirs[["equal_area_x_m", "equal_area_y_m"]].to_numpy(dtype=float)
    tree = cKDTree(viirs_xy)
    viirs_datetimes = pd.to_datetime(
        viirs["acquisition_datetime_utc"], utc=True, errors="coerce"
    )
    modis_datetimes = pd.to_datetime(
        modis["acquisition_datetime_utc"], utc=True, errors="coerce"
    )
    viirs_times = viirs_datetimes.dt.as_unit("ns").astype("int64").to_numpy()
    modis_times = modis_datetimes.dt.as_unit("ns").astype("int64").to_numpy()
    valid_viirs_time = ~viirs_datetimes.isna().to_numpy()
    valid_modis_time = ~modis_datetimes.isna().to_numpy()
    valid_viirs_indexes = np.flatnonzero(valid_viirs_time)
    viirs_order = np.argsort(viirs_times[valid_viirs_time])
    sorted_viirs_indexes = valid_viirs_indexes[viirs_order]
    valid_viirs_times_sorted = viirs_times[sorted_viirs_indexes]
    max_time_ns = max_time_minutes * 60_000_000_000

    candidates: list[dict[str, Any]] = []
    matched_ids: set[str] = set()
    temporally_eligible_ids: set[str] = set()
    for modis_index, modis_row in modis.iterrows():
        if not valid_modis_time[modis_index]:
            continue
        modis_time = int(modis_times[modis_index])
        first_time = int(
            np.searchsorted(valid_viirs_times_sorted, modis_time - max_time_ns, side="left")
        )
        after_time = int(
            np.searchsorted(valid_viirs_times_sorted, modis_time + max_time_ns, side="right")
        )
        temporal_indexes = sorted_viirs_indexes[first_time:after_time]
        if len(temporal_indexes):
            temporally_eligible_ids.add(str(modis_row["observation_id"]))
            temporally_eligible_ids.update(
                viirs.iloc[temporal_indexes]["observation_id"].astype(str)
            )
        point = np.array(
            [modis_row["equal_area_x_m"], modis_row["equal_area_y_m"]],
            dtype=float,
        )
        neighbor_indexes = tree.query_ball_point(point, r=max_distance_m)
        for viirs_index in neighbor_indexes:
            if not valid_viirs_time[viirs_index]:
                continue
            viirs_row = viirs.iloc[viirs_index]
            separation = float(
                np.hypot(
                    point[0] - viirs_row["equal_area_x_m"],
                    point[1] - viirs_row["equal_area_y_m"],
                )
            )
            time_difference = abs(modis_time - int(viirs_times[viirs_index])) / 60_000_000_000
            if time_difference > max_time_minutes:
                continue
            candidates.append(
                {
                    "modis_observation_id": str(modis_row["observation_id"]),
                    "viirs_observation_id": str(viirs_row["observation_id"]),
                    "modis_sensor": str(modis_row["sensor"]),
                    "viirs_sensor": str(viirs_row["sensor"]),
                    "separation_m": separation,
                    "time_difference_minutes": float(time_difference),
                }
            )
            matched_ids.add(str(modis_row["observation_id"]))
            matched_ids.add(str(viirs_row["observation_id"]))

    modis_counts = Counter(c["modis_observation_id"] for c in candidates)
    viirs_counts = Counter(c["viirs_observation_id"] for c in candidates)
    for c in candidates:
        m_count = modis_counts[c["modis_observation_id"]]
        v_count = viirs_counts[c["viirs_observation_id"]]
        if m_count == 1 and v_count == 1:
            c["multiplicity_type"] = "one_to_one"
        elif m_count > 1 and v_count == 1:
            c["multiplicity_type"] = "one_modis_to_many_viirs"
        elif m_count == 1 and v_count > 1:
            c["multiplicity_type"] = "many_modis_to_one_viirs"
        else:
            c["multiplicity_type"] = "many_to_many"

    return candidates, matched_ids, temporally_eligible_ids


def build_spatiotemporal_matches(
    config: PipelineConfig,
    standardized_path: Path,
) -> tuple[Path, Path, Path]:
    output_dir = config.output_dir / "matched"
    output_dir.mkdir(parents=True, exist_ok=True)
    match_path = output_dir / "cross_sensor_candidates.parquet"
    unmatched_path = output_dir / "observations_without_candidates.parquet"
    sensitivity_path = config.output_dir / "reports" / "matching_sensitivity.csv"
    sensitivity_path.parent.mkdir(parents=True, exist_ok=True)

    max_distance = max(config.match_distance_thresholds_m)
    max_time = max(config.match_time_thresholds_minutes)
    relation = read_parquet_sql(standardized_path, hive_partitioning=True)
    connection = duckdb.connect()
    match_writer = _ParquetBatchWriter(match_path, _MATCH_SCHEMA)
    unmatched_writer = _ParquetBatchWriter(unmatched_path, _UNMATCHED_SCHEMA)
    sensitivity_counts: Counter[tuple[str, int, int]] = Counter()
    match_quality_stats: dict[tuple[str, int, int], dict[str, Any]] = {}
    try:
        groups = connection.execute(
            f"""
            SELECT DISTINCT country, acquisition_year, month(CAST(acquisition_date AS DATE)) AS month
            FROM {relation}
            WHERE
                sensor IS NOT NULL
                AND acquisition_year IS NOT NULL
                AND acquisition_date IS NOT NULL
                AND equal_area_x_m IS NOT NULL
                AND equal_area_y_m IS NOT NULL
                AND acquisition_datetime_utc IS NOT NULL
            ORDER BY country, acquisition_year, month
            """
        ).fetchall()
        for country, year, month in groups:
            month_start = date(int(year), int(month), 1)
            if int(month) == 12:
                next_month = date(int(year) + 1, 1, 1)
            else:
                next_month = date(int(year), int(month) + 1, 1)
            start_with_context = (month_start - timedelta(days=1)).isoformat()
            end_with_context = (next_month + timedelta(days=1)).isoformat()
            query = f"""
                SELECT
                    observation_id,
                    country,
                    acquisition_date,
                    acquisition_datetime_utc,
                    sensor,
                    equal_area_x_m,
                    equal_area_y_m
                FROM {relation}
                WHERE
                    country = ?
                    AND acquisition_year BETWEEN ? AND ?
                    AND acquisition_date >= ?
                    AND acquisition_date < ?
                    AND sensor IS NOT NULL
                    AND sensor != 'UNKNOWN'
                    AND equal_area_x_m IS NOT NULL
                    AND equal_area_y_m IS NOT NULL
                    AND acquisition_datetime_utc IS NOT NULL
                    AND (sensor LIKE 'MODIS_%' OR sensor LIKE 'VIIRS_%')
            """
            monthly = connection.execute(
                query,
                [
                    country,
                    int(year) - 1,
                    int(year) + 1,
                    start_with_context,
                    end_with_context,
                ],
            ).fetchdf()
            if monthly.empty:
                continue
            modis_month = monthly[
                (monthly["acquisition_date"] >= month_start.isoformat())
                & (monthly["acquisition_date"] < next_month.isoformat())
                & monthly["sensor"].str.startswith("MODIS_")
            ]
            target_month = monthly[
                (monthly["acquisition_date"] >= month_start.isoformat())
                & (monthly["acquisition_date"] < next_month.isoformat())
            ]
            target_by_id = target_month.drop_duplicates("observation_id").set_index(
                "observation_id"
            )
            viirs_by_date = {
                str(day): group
                for day, group in monthly[
                    monthly["sensor"].str.startswith("VIIRS_")
                ].groupby("acquisition_date", sort=False)
            }
            matched_ids: set[str] = set()
            eligible_ids: set[str] = set()
            for observation_date, modis_rows in modis_month.groupby(
                "acquisition_date", sort=False
            ):
                center_date = date.fromisoformat(str(observation_date))
                nearby_viirs = [
                    viirs_by_date[day.isoformat()]
                    for day in (
                        center_date - timedelta(days=1),
                        center_date,
                        center_date + timedelta(days=1),
                    )
                    if day.isoformat() in viirs_by_date
                ]
                if not nearby_viirs:
                    continue
                viirs_rows = pd.concat(nearby_viirs, ignore_index=True)
                candidates, found_ids, time_eligible = _candidate_pairs(
                    modis_rows, viirs_rows, max_distance, max_time
                )
                matched_ids.update(found_ids)
                eligible_ids.update(time_eligible)
                for candidate in candidates:
                    modis_id = candidate["modis_observation_id"]
                    viirs_id = candidate["viirs_observation_id"]
                    separation = candidate["separation_m"]
                    time_difference = candidate["time_difference_minutes"]
                    multiplicity = candidate.get("multiplicity_type", "unclassified")
                    for distance_threshold in config.match_distance_thresholds_m:
                        for time_threshold in config.match_time_thresholds_minutes:
                            if separation > distance_threshold or time_difference > time_threshold:
                                continue
                            key = (str(country), distance_threshold, time_threshold)
                            sensitivity_counts[key] += 1
                            if key not in match_quality_stats:
                                match_quality_stats[key] = {
                                    "separations": [],
                                    "time_diffs": [],
                                    "modis_ids": set(),
                                    "viirs_ids": set(),
                                    "multiplicities": Counter(),
                                    "scores": [],
                                }
                            entry = match_quality_stats[key]
                            entry["separations"].append(separation)
                            entry["time_diffs"].append(time_difference)
                            entry["modis_ids"].add(modis_id)
                            entry["viirs_ids"].add(viirs_id)
                            entry["multiplicities"][multiplicity] += 1

                            match_id = hashlib.sha256(
                                (
                                    f"{modis_id}|{viirs_id}|{distance_threshold}|"
                                    f"{time_threshold}"
                                ).encode("utf-8")
                            ).hexdigest()
                            score = max(0.0, 1 - separation / distance_threshold) * max(
                                0.0, 1 - time_difference / time_threshold
                            )
                            entry["scores"].append(score)
                            match_writer.append(
                                {
                                    "match_id": match_id,
                                    "country": str(country),
                                    "acquisition_date": str(observation_date),
                                    "modis_observation_id": modis_id,
                                    "viirs_observation_id": viirs_id,
                                    "modis_sensor": candidate["modis_sensor"],
                                    "viirs_sensor": candidate["viirs_sensor"],
                                    "separation_m": separation,
                                    "time_difference_minutes": time_difference,
                                    "distance_threshold_m": distance_threshold,
                                    "time_threshold_minutes": time_threshold,
                                    "match_confidence": score,
                                    "multiplicity_type": multiplicity,
                                    "confidence_interpretation": (
                                        "heuristic proximity score; not a probability or fire identity"
                                    ),
                                    "matching_method": "EPSG:6933 distance and UTC acquisition-time difference",
                                }
                            )
            for observation_id in eligible_ids - matched_ids:
                if observation_id not in target_by_id.index:
                    continue
                row = target_by_id.loc[observation_id]
                unmatched_writer.append(
                    {
                        "observation_id": observation_id,
                        "country": str(country),
                        "acquisition_date": str(row["acquisition_date"]),
                        "sensor": str(row["sensor"]),
                        "reason": "no_candidate_within_configured_maximum_thresholds",
                        "interpretation": (
                            "no nearby cross-sensor detection was found in the records; "
                            "not evidence of no fire or a unique fire"
                        ),
                    }
                )
    except Exception:
        match_writer.close()
        unmatched_writer.close()
        connection.close()
        raise
    else:
        match_writer.close()
        unmatched_writer.close()
        connection.close()

    pd.DataFrame(
        [
            {
                "country": country,
                "distance_threshold_m": distance,
                "time_threshold_minutes": time,
                "candidate_pair_count": count,
                "exposure_available": False,
            }
            for (country, distance, time), count in sorted(sensitivity_counts.items())
        ]
        , columns=[
            "country",
            "distance_threshold_m",
            "time_threshold_minutes",
            "candidate_pair_count",
            "exposure_available",
        ]
    ).to_csv(sensitivity_path, index=False)

    quality_rows = []
    for (country, dist, time_min), entry in sorted(match_quality_stats.items()):
        seps = np.array(entry["separations"])
        tdiffs = np.array(entry["time_diffs"])
        scores = np.array(entry["scores"])
        mults = entry["multiplicities"]
        total_p = len(seps)
        quality_rows.append(
            {
                "country": country,
                "distance_threshold_m": dist,
                "time_threshold_minutes": time_min,
                "candidate_pair_count": total_p,
                "distinct_modis_matched": len(entry["modis_ids"]),
                "distinct_viirs_matched": len(entry["viirs_ids"]),
                "one_to_one_count": mults["one_to_one"],
                "one_modis_to_many_viirs_count": mults["one_modis_to_many_viirs"],
                "many_modis_to_one_viirs_count": mults["many_modis_to_one_viirs"],
                "many_to_many_count": mults["many_to_many"],
                "one_to_many_fraction": round(mults["one_modis_to_many_viirs"] / max(total_p, 1), 3),
                "mean_separation_m": round(float(np.mean(seps)), 1) if len(seps) else 0.0,
                "median_separation_m": round(float(np.median(seps)), 1) if len(seps) else 0.0,
                "mean_time_difference_min": round(float(np.mean(tdiffs)), 1) if len(tdiffs) else 0.0,
                "median_time_difference_min": round(float(np.median(tdiffs)), 1) if len(tdiffs) else 0.0,
                "mean_match_score": round(float(np.mean(scores)), 3) if len(scores) else 0.0,
            }
        )
    quality_path = config.output_dir / "reports" / "cross_sensor_match_quality.csv"
    pd.DataFrame(quality_rows).to_csv(quality_path, index=False)

    LOGGER.info(
        "Wrote cross-sensor candidate matches to %s. Candidates are not deduplicated fires.",
        match_path,
    )
    return match_path, unmatched_path, sensitivity_path, quality_path
