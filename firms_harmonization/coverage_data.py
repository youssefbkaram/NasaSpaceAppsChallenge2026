from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import tempfile
from collections.abc import Iterator
from typing import Any

import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from shapely.geometry import GeometryCollection, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

LOGGER = logging.getLogger(__name__)
EQUAL_AREA_CRS = "EPSG:6933"
MASK_CLASS_NAMES = {
    0: "missing_input_data",
    1: "not_processed_trim",
    2: "not_processed_obsolete",
    3: "non_fire_water",
    4: "cloud",
    5: "non_fire_land",
    6: "unknown",
    7: "fire_low_confidence",
    8: "fire_nominal_confidence",
    9: "fire_high_confidence",
}
VALID_OBSERVATION_CLASSES = (5, 7, 8, 9)
FIRE_CLASSES = (7, 8, 9)
FIREMASK_FILL_VALUE = 255
GRANULE_DATE_PATTERN = re.compile(r"\.A(?P<year>\d{4})(?P<day>\d{3})\.")

PRODUCTS = {
    "MOD14A1": ("061", "MODIS", "Terra", ".hdf"),
    "MYD14A1": ("061", "MODIS", "Aqua", ".hdf"),
    "VNP14A1": ("002", "VIIRS", "Suomi-NPP", ".h5"),
    "VJ114A1": ("002", "VIIRS", "NOAA-20", ".h5"),
    "VJ214A1": ("002", "VIIRS", "NOAA-21", ".h5"),
}

_CSV_FIELDS = [
    "country",
    "date",
    "sensor_family",
    "satellite",
    "product",
    "product_version",
    "source_granule",
    "firemask_band_index",
    "date_source",
    "grid_resolution_m",
    "grid_id",
    "grid_x",
    "grid_y",
    *(f"firemask_class_{value}_pixel_days" for value in range(10)),
    "firemask_fill_value_pixel_days",
    "valid_pixel_days",
    "fire_pixel_days",
    "availability_status",
]


def load_aoi_geojson(path: Path) -> BaseGeometry:
    document = json.loads(path.read_text(encoding="utf-8"))
    crs = document.get("crs")
    if crs is not None:
        crs_name = json.dumps(crs).casefold()
        if "4326" not in crs_name and "crs84" not in crs_name:
            raise ValueError("The GeoJSON AOI must use WGS84 (EPSG:4326 or CRS84).")

    document_type = document.get("type")
    if document_type == "FeatureCollection":
        geometries = [
            shape(feature["geometry"])
            for feature in document.get("features", [])
            if feature.get("geometry") is not None
        ]
        geometry = unary_union(geometries) if geometries else GeometryCollection()
    elif document_type == "Feature":
        geometry = shape(document["geometry"])
    else:
        geometry = shape(document)

    if geometry.is_empty:
        raise ValueError(f"The AOI contains no geometry: {path}")
    if geometry.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("The AOI must be a GeoJSON Polygon or MultiPolygon.")
    if not geometry.is_valid:
        raise ValueError(f"The AOI geometry is invalid: {path}")
    min_x, min_y, max_x, max_y = geometry.bounds
    if min_x < -180 or max_x > 180 or min_y < -90 or max_y > 90:
        raise ValueError("The AOI bounds fall outside WGS84 longitude/latitude.")
    return geometry


def _granule_start_date(path: Path) -> date:
    match = GRANULE_DATE_PATTERN.search(path.name)
    if match is None:
        raise ValueError(f"Cannot determine the acquisition date from {path.name}.")
    year = int(match.group("year"))
    day_of_year = int(match.group("day"))
    last_day = date(year, 12, 31).timetuple().tm_yday
    if not 1 <= day_of_year <= last_day:
        raise ValueError(f"Invalid year/day in granule filename {path.name}.")
    try:
        return date(year, 1, 1) + timedelta(days=day_of_year - 1)
    except ValueError as exc:
        raise ValueError(f"Invalid year/day in granule filename {path.name}.") from exc


def _granule_overlaps_dates(path: Path, start_date: date, end_date: date) -> bool:
    granule_date = _granule_start_date(path)
    if path.name.startswith(("MOD14A1.", "MYD14A1.")):
        granule_end_date = granule_date + timedelta(days=7)
    else:
        granule_end_date = granule_date
    return granule_date <= end_date and granule_end_date >= start_date


def _product_for_file(path: Path) -> tuple[str, str, str, str]:
    for product, product_info in PRODUCTS.items():
        if path.name.startswith(product + "."):
            version, sensor, satellite, expected_suffix = product_info
            if path.suffix.casefold() != expected_suffix:
                raise ValueError(
                    f"{path.name} has an unexpected file extension for {product}."
                )
            return product, version, sensor, satellite
    raise ValueError(f"Unsupported NASA fire product granule: {path.name}")


def _modis_band_dates(
    metadata: dict[str, str],
    fallback_start: date,
    band_count: int,
) -> tuple[list[date], str]:
    date_values: list[date] = []
    for key, value in metadata.items():
        if key.casefold().replace("_", "") in {"dates", "datadays"}:
            date_values.extend(
                date.fromisoformat(value)
                for value in re.findall(r"\d{4}-\d{2}-\d{2}", str(value))
            )
    if date_values:
        if len(date_values) != band_count:
            raise ValueError(
                "The MODIS Data Days metadata does not match the FireMask band count."
            )
        return date_values, "product_data_days_metadata"
    if band_count > 8:
        raise ValueError("A daily MODIS FireMask granule cannot contain over 8 bands.")
    return (
        [fallback_start + timedelta(days=index) for index in range(band_count)],
        "granule_start_plus_band_index",
    )


def _find_layer(subdatasets: list[str], layer_name: str, granule: Path) -> str:
    matching = [
        subdataset
        for subdataset in subdatasets
        if re.search(rf"(?:[:/]){re.escape(layer_name)}$", subdataset, re.IGNORECASE)
    ]
    if len(matching) != 1:
        raise ValueError(
            f"Expected exactly one {layer_name} layer in {granule.name}; "
            f"found {len(matching)}."
        )
    return matching[0]


def _grid_assignment(
    width: int,
    height: int,
    transform: rasterio.Affine,
    source_crs: rasterio.crs.CRS,
    aoi: BaseGeometry,
    resolution_m: int,
) -> tuple[np.ndarray, int, int, int, np.ndarray]:
    source_geometry = transform_geom(
        "EPSG:4326",
        source_crs,
        mapping(aoi),
        precision=-1,
    )
    inside = geometry_mask(
        [source_geometry],
        out_shape=(height, width),
        transform=transform,
        invert=True,
        all_touched=False,
    )
    if not inside.any():
        return np.full((height, width), -1, dtype=np.int32), 0, 0, 0, inside

    columns = np.arange(width, dtype=np.float64) + 0.5
    rows = np.arange(height, dtype=np.float64) + 0.5
    x_source = transform.c + columns[None, :] * transform.a + rows[:, None] * transform.b
    y_source = transform.f + columns[None, :] * transform.d + rows[:, None] * transform.e
    transformer = Transformer.from_crs(source_crs, EQUAL_AREA_CRS, always_xy=True)
    x_equal_area, y_equal_area = transformer.transform(
        x_source[inside],
        y_source[inside],
    )
    grid_x = np.floor(np.asarray(x_equal_area) / resolution_m).astype(np.int64)
    grid_y = np.floor(np.asarray(y_equal_area) / resolution_m).astype(np.int64)

    min_grid_x = int(grid_x.min())
    max_grid_x = int(grid_x.max())
    min_grid_y = int(grid_y.min())
    grid_width = max_grid_x - min_grid_x + 1
    cell_index = np.full((height, width), -1, dtype=np.int32)
    cell_index[inside] = (
        (grid_y - min_grid_y) * grid_width + grid_x - min_grid_x
    ).astype(np.int32)
    return cell_index, min_grid_x, min_grid_y, grid_width, inside


def _aggregate_mask_classes(
    fire_mask: np.ndarray,
    cell_index: np.ndarray,
    inside: np.ndarray,
) -> np.ndarray:
    values = np.asarray(fire_mask)
    if values.ndim != 2 or values.shape != cell_index.shape:
        raise ValueError("Each FireMask band must match its source raster dimensions.")
    if np.any((values < 0) | ((values > 9) & (values != FIREMASK_FILL_VALUE))):
        raise ValueError(
            "FireMask contains values outside the documented 0-9 classes and 255 fill value."
        )
    if not inside.any():
        return np.zeros((0, 11), dtype=np.int64)

    selected_cells = cell_index[inside].astype(np.int64)
    selected_classes = values[inside].astype(np.int64)
    selected_classes[selected_classes == FIREMASK_FILL_VALUE] = 10
    cell_count = int(selected_cells.max()) + 1
    pair_indices = selected_cells * 11 + selected_classes
    counts = np.bincount(pair_indices, minlength=cell_count * 11)
    return counts.reshape(cell_count, 11)


def _iter_granule_rows(
    granule: Path,
    aoi: BaseGeometry,
    start_date: date,
    end_date: date,
    country: str,
    resolution_m: int,
) -> Iterator[dict[str, Any]]:
    product, product_version, sensor, satellite = _product_for_file(granule)
    granule_date = _granule_start_date(granule)
    with rasterio.open(granule) as container:
        subdatasets = list(container.subdatasets)
        root_tags = container.tags()

    firemask_uri = _find_layer(subdatasets, "FireMask", granule)
    with rasterio.open(firemask_uri) as firemask_dataset:
        if firemask_dataset.crs is None:
            raise ValueError(f"{granule.name} FireMask has no declared CRS.")
        if not firemask_dataset.transform.is_identity:
            transform = firemask_dataset.transform
        else:
            raise ValueError(f"{granule.name} FireMask has no usable geotransform.")

        dataset_tags = firemask_dataset.tags()
        metadata = {**root_tags, **dataset_tags}
        if product.startswith(("MOD14", "MYD14")):
            band_dates, date_source = _modis_band_dates(
                metadata,
                granule_date,
                firemask_dataset.count,
            )
        else:
            if firemask_dataset.count != 1:
                raise ValueError(
                    f"Expected one daily VIIRS FireMask band in {granule.name}; "
                    f"found {firemask_dataset.count}."
                )
            band_dates = [granule_date]
            date_source = "granule_filename"

        cell_index, min_grid_x, min_grid_y, grid_width, inside = _grid_assignment(
            firemask_dataset.width,
            firemask_dataset.height,
            transform,
            firemask_dataset.crs,
            aoi,
            resolution_m,
        )
        if not inside.any():
            return

        for band_index, acquisition_date in enumerate(band_dates, start=1):
            if not start_date <= acquisition_date <= end_date:
                continue
            fire_mask = firemask_dataset.read(band_index)
            class_counts = _aggregate_mask_classes(
                fire_mask,
                cell_index,
                inside,
            )
            for cell_index_value in np.flatnonzero(class_counts.any(axis=1)):
                grid_y_offset, grid_x_offset = divmod(
                    int(cell_index_value),
                    grid_width,
                )
                counts = class_counts[cell_index_value]
                valid_pixel_days = int(sum(counts[value] for value in VALID_OBSERVATION_CLASSES))
                fire_pixel_days = int(sum(counts[value] for value in FIRE_CLASSES))
                grid_x = min_grid_x + grid_x_offset
                grid_y = min_grid_y + grid_y_offset
                row: dict[str, Any] = {
                    "country": country,
                    "date": acquisition_date.isoformat(),
                    "sensor_family": sensor,
                    "satellite": satellite,
                    "product": product,
                    "product_version": product_version,
                    "source_granule": granule.name,
                    "firemask_band_index": band_index,
                    "date_source": date_source,
                    "grid_resolution_m": resolution_m,
                    "grid_id": f"EPSG6933_{resolution_m}m_{grid_x}_{grid_y}",
                    "grid_x": grid_x,
                    "grid_y": grid_y,
                    "valid_pixel_days": valid_pixel_days,
                    "fire_pixel_days": fire_pixel_days,
                    "availability_status": (
                        "valid_land_pixel_day_present"
                        if valid_pixel_days
                        else "no_valid_land_pixel_day_in_product"
                    ),
                }
                row.update(
                    {
                        f"firemask_class_{value}_pixel_days": int(counts[value])
                        for value in range(10)
                    }
                )
                row["firemask_fill_value_pixel_days"] = int(counts[10])
                yield row


def _check_drivers(paths: list[Path]) -> None:
    required = {
        "HDF4": any(path.suffix.casefold() == ".hdf" for path in paths),
        "HDF5": any(path.suffix.casefold() in {".h5", ".hdf5"} for path in paths),
    }
    with rasterio.Env() as env:
        missing = [
            driver
            for driver, needed in required.items()
            if needed and env.drivers().get(driver) is None
        ]
    if missing:
        driver_list = ", ".join(missing)
        raise RuntimeError(
            f"GDAL is missing required driver(s): {driver_list}. Create and use "
            "the environment in environment-coverage.yml."
        )


def _search_and_download(
    start_date: date,
    end_date: date,
    bounds: tuple[float, float, float, float],
    products: list[str],
    data_dir: Path,
    max_granules: int,
) -> list[Path]:
    if not os.environ.get("EARTHDATA_TOKEN"):
        raise RuntimeError(
            "Set EARTHDATA_TOKEN in your local shell before downloading. "
            "Do not paste or commit the token."
        )

    import earthaccess

    auth = earthaccess.login(strategy="environment", persist=False)
    if not auth.authenticated:
        raise RuntimeError("Earthdata authentication did not succeed.")

    granules = []
    for product in products:
        version = PRODUCTS[product][0]
        results = earthaccess.search_data(
            count=max_granules + 1,
            short_name=product,
            version=version,
            temporal=(start_date.isoformat(), end_date.isoformat()),
            bounding_box=bounds,
        )
        if len(results) > max_granules or len(granules) + len(results) > max_granules:
            raise ValueError(
                f"The requested area and dates exceed --max-granules "
                f"({max_granules}). Narrow the date range or AOI, or explicitly "
                "raise the limit."
            )
        LOGGER.info("NASA CMR found %d %s granules.", len(results), product)
        granules.extend(results)

    if not granules:
        raise FileNotFoundError(
            "NASA CMR found no granules for the selected products, AOI, and dates."
        )
    data_dir.mkdir(parents=True, exist_ok=True)
    downloaded = earthaccess.download(
        granules,
        local_path=data_dir,
        threads=4,
        force=False,
    )
    if not downloaded:
        raise RuntimeError("Earthaccess returned no downloaded granule paths.")
    LOGGER.info("Earthaccess downloaded or reused %d granule files.", len(downloaded))
    return [Path(path) for path in downloaded]


def _write_manifest(
    manifest_path: Path,
    *,
    aoi_path: Path,
    aoi_hash: str,
    country: str,
    start_date: date,
    end_date: date,
    resolution_m: int,
    granules: list[Path],
    row_count: int,
) -> None:
    manifest = {
        "schema_version": 1,
        "country": country,
        "aoi_file": aoi_path.name,
        "aoi_sha256": aoi_hash,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "grid_resolution_m": resolution_m,
        "grid_crs": EQUAL_AREA_CRS,
        "coverage_definition": (
            "One daily product-pixel classified as non-fire land or fire "
            "(FireMask classes 5 and 7-9); this is not an overpass count."
        ),
        "valid_observation_classes": list(VALID_OBSERVATION_CLASSES),
        "fire_classes": list(FIRE_CLASSES),
        "fill_value": FIREMASK_FILL_VALUE,
        "firemask_class_names": {str(key): value for key, value in MASK_CLASS_NAMES.items()},
        "source_products": [
            {
                "short_name": product,
                "version": PRODUCTS[product][0],
                "sensor_family": PRODUCTS[product][1],
                "satellite": PRODUCTS[product][2],
            }
            for product in sorted(
                {
                    _product_for_file(granule)[0]
                    for granule in granules
                    if granule.exists()
                }
            )
        ],
        "source_granule_count": len(granules),
        "source_granules": sorted(granule.name for granule in granules),
        "output_row_count": row_count,
        "sources": [
            "https://doi.org/10.5067/MODIS/MOD14A1.061",
            "https://doi.org/10.5067/MODIS/MYD14A1.061",
            "https://doi.org/10.5067/VIIRS/VNP14A1.002",
            "https://doi.org/10.5067/VIIRS/VJ114A1.002",
            "https://doi.org/10.5067/VIIRS/VJ214A1.002",
        ],
        "interpretation_limit": (
            "Daily FireMask composites indicate clear-land or fire pixel-days, "
            "not the number of sensor overpasses or independent fires. Sensor "
            "rates require overlap-period calibration and validation before "
            "being described as harmonized counts."
        ),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{manifest_path.stem}-",
        suffix=".tmp",
        dir=manifest_path.parent,
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as manifest_file:
            json.dump(manifest, manifest_file, indent=2, sort_keys=True)
            manifest_file.write("\n")
        os.replace(temporary_path, manifest_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def process_coverage(
    *,
    aoi_path: Path,
    data_dir: Path,
    output_path: Path,
    start_date: date,
    end_date: date,
    country: str,
    resolution_m: int = 5_000,
    products: list[str] | None = None,
) -> tuple[Path, Path]:
    if start_date > end_date:
        raise ValueError("The start date must be on or before the end date.")
    if resolution_m < 1:
        raise ValueError("The grid resolution must be a positive number of metres.")
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite coverage output: {output_path}")
    aoi_path = Path(aoi_path).resolve()
    data_dir = Path(data_dir).resolve()
    output_path = Path(output_path).resolve()
    manifest_path = output_path.with_suffix(output_path.suffix + ".manifest.json")
    if manifest_path.exists():
        raise FileExistsError(f"Refusing to overwrite coverage manifest: {manifest_path}")

    selected_products = products or list(PRODUCTS)
    unknown_products = set(selected_products) - PRODUCTS.keys()
    if unknown_products:
        raise ValueError(f"Unsupported products: {', '.join(sorted(unknown_products))}")
    aoi = load_aoi_geojson(aoi_path)
    granules = sorted(
        path
        for path in data_dir.rglob("*")
        if path.is_file()
        and path.suffix.casefold() in {".hdf", ".h5", ".hdf5"}
        and any(path.name.startswith(product + ".") for product in selected_products)
        and _granule_overlaps_dates(path, start_date, end_date)
    )
    if not granules:
        raise FileNotFoundError(
            f"No selected NASA FireMask granules found under {data_dir}."
        )
    _check_drivers(granules)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    aoi_hash = hashlib.sha256(aoi_path.read_bytes()).hexdigest()
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.stem}-",
        suffix=".tmp",
        dir=output_path.parent,
        text=True,
    )
    temporary_path = Path(temporary_name)
    row_count = 0
    processed_granules: list[Path] = []
    try:
        with os.fdopen(file_descriptor, "w", newline="", encoding="utf-8") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=_CSV_FIELDS)
            writer.writeheader()
            for granule in granules:
                _product_for_file(granule)
                if granule.stat().st_size == 0:
                    raise ValueError(f"NASA granule is empty: {granule}")
                granule_row_count = 0
                for row in _iter_granule_rows(
                    granule,
                    aoi,
                    start_date,
                    end_date,
                    country,
                    resolution_m,
                ):
                    writer.writerow(row)
                    granule_row_count += 1
                row_count += granule_row_count
                if granule_row_count:
                    processed_granules.append(granule)
                LOGGER.info(
                    "Processed %s: %d cell-days.",
                    granule.name,
                    granule_row_count,
                )
        if row_count == 0:
            raise ValueError(
                "The selected granules contain no AOI cells within the requested dates."
            )
        _write_manifest(
            manifest_path,
            aoi_path=aoi_path,
            aoi_hash=aoi_hash,
            country=country,
            start_date=start_date,
            end_date=end_date,
            resolution_m=resolution_m,
            granules=processed_granules,
            row_count=row_count,
        )
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
        if not output_path.exists():
            manifest_path.unlink(missing_ok=True)
    LOGGER.info(
        "Wrote %d valid-coverage cell-day rows to %s.",
        row_count,
        output_path,
    )
    return output_path, manifest_path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="firms-coverage",
        description=(
            "Download and grid NASA daily MODIS/VIIRS FireMask coverage. "
            "Counts describe classified pixel-days, not overpass counts."
        ),
    )
    parser.add_argument("--aoi", type=Path, required=True, help="WGS84 GeoJSON AOI.")
    parser.add_argument("--data-dir", type=Path, required=True, help="Granule/cache directory.")
    parser.add_argument("--output", type=Path, required=True, help="New CSV output path.")
    parser.add_argument("--start", type=date.fromisoformat, required=True, help="First UTC date.")
    parser.add_argument("--end", type=date.fromisoformat, required=True, help="Last UTC date.")
    parser.add_argument("--country", help="Output country label (defaults to AOI filename).")
    parser.add_argument(
        "--resolution-m",
        type=int,
        choices=(1_000, 5_000, 10_000),
        default=5_000,
    )
    parser.add_argument(
        "--products",
        nargs="+",
        choices=tuple(PRODUCTS),
        default=list(PRODUCTS),
        help="NASA product short names to use.",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Search NASA CMR and download granules using EARTHDATA_TOKEN.",
    )
    parser.add_argument(
        "--max-granules",
        type=int,
        default=500,
        help="Maximum granules to download in one request (default: 500).",
    )
    parser.add_argument("--log-level", default="INFO", choices=("DEBUG", "INFO", "WARNING", "ERROR"))
    return parser


def main() -> None:
    args = _parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if args.max_granules < 1:
        raise SystemExit("--max-granules must be positive.")
    aoi_path = args.aoi.resolve()
    aoi = load_aoi_geojson(aoi_path)
    data_dir = args.data_dir.resolve()
    if args.download:
        _search_and_download(
            args.start,
            args.end,
            aoi.bounds,
            args.products,
            data_dir,
            args.max_granules,
        )
    output_path, manifest_path = process_coverage(
        aoi_path=aoi_path,
        data_dir=data_dir,
        output_path=args.output,
        start_date=args.start,
        end_date=args.end,
        country=args.country or aoi_path.stem,
        resolution_m=args.resolution_m,
        products=args.products,
    )
    print(f"Wrote coverage rows: {output_path}")
    print(f"Wrote coverage provenance: {manifest_path}")


if __name__ == "__main__":
    main()
