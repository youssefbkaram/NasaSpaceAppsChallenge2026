from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd


_COUNTRY_FIELD_CANDIDATES = ("country", "admin", "name_0", "name", "sovereignt")


def load_country_boundaries(path: Path | None) -> gpd.GeoDataFrame | None:
    if path is None:
        return None
    if not path.is_file():
        raise FileNotFoundError(f"Country boundary file does not exist: {path}")
    boundaries = gpd.read_file(path)
    if boundaries.crs is None:
        raise ValueError(f"Country boundary file has no CRS: {path}")
    boundaries = boundaries.to_crs("EPSG:4326")
    country_field = next(
        (
            column
            for candidate in _COUNTRY_FIELD_CANDIDATES
            for column in boundaries.columns
            if str(column).casefold() == candidate
        ),
        None,
    )
    if country_field is None:
        raise ValueError(
            "Country boundaries need a country-name field (for example country, ADMIN, or NAME_0)."
        )
    polygon_mask = boundaries.geometry.geom_type.isin({"Polygon", "MultiPolygon"})
    if not polygon_mask.all():
        raise ValueError("Country boundary input must contain polygon geometries only.")
    boundaries = boundaries[[country_field, "geometry"]].rename(
        columns={country_field: "boundary_country"}
    )
    boundaries["boundary_country"] = boundaries["boundary_country"].astype(str).str.casefold()
    return boundaries


def flag_outside_country_boundaries(
    observations: pd.DataFrame,
    boundaries: gpd.GeoDataFrame | None,
) -> pd.DataFrame:
    result = observations.copy()
    if boundaries is None:
        result["boundary_check_status"] = "not_checked_missing_boundary_data"
        return result

    result["boundary_check_status"] = "country_boundary_not_found"
    country_map = {
        str(country).casefold(): group
        for country, group in boundaries.groupby("boundary_country")
    }
    valid_points = result["latitude"].notna() & result["longitude"].notna()
    for country, positions in result.loc[valid_points].groupby("country").groups.items():
        boundary = country_map.get(str(country).casefold())
        if boundary is None:
            continue
        points = gpd.GeoDataFrame(
            {"row_position": list(positions)},
            geometry=gpd.points_from_xy(
                result.loc[positions, "longitude"],
                result.loc[positions, "latitude"],
            ),
            crs="EPSG:4326",
        )
        matched = gpd.sjoin(
            points,
            boundary[["geometry"]],
            how="left",
            predicate="intersects",
        )
        inside_positions = set(matched.loc[matched.index_right.notna(), "row_position"])
        for position in positions:
            if position in inside_positions:
                result.at[position, "boundary_check_status"] = "inside_country_boundary"
            else:
                result.at[position, "boundary_check_status"] = "outside_country_boundary"
                current = result.at[position, "validation_reasons"] or ""
                result.at[position, "validation_reasons"] = (
                    f"{current};outside_country_boundary".strip(";")
                )
                if result.at[position, "validation_status"] == "valid":
                    result.at[position, "validation_status"] = "review"
    result.loc[
        ~valid_points & result["boundary_check_status"].eq("country_boundary_not_found"),
        "boundary_check_status",
    ] = "not_checked_invalid_coordinates"
    return result
