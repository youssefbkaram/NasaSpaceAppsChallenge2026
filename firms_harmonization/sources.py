from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


CSV_PATTERN = re.compile(r"^fire_(archive|nrt)_(.+)\.csv$", re.IGNORECASE)
SHP_PATTERN = re.compile(r"^fire_(archive|nrt)_(.+)\.shp$", re.IGNORECASE)


@dataclass(frozen=True)
class SourceFile:
    path: Path
    country: str
    source_product: str
    processing: str
    file_format: str

    @property
    def quality(self) -> str:
        return "SP" if self.processing == "archive" else "NRT"

    @property
    def sensor_family(self) -> str:
        product = self.source_product.upper()
        if product.startswith("M-C"):
            return "MODIS"
        if product.startswith(("SV-C", "J1V-C", "J2V-C")):
            return "VIIRS"
        return "UNKNOWN"


def discover_sources(
    input_dir: Path,
    include_nrt: bool = True,
    countries: tuple[str, ...] | None = None,
) -> list[SourceFile]:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input data directory does not exist: {input_dir}")

    found: list[SourceFile] = []
    for path in sorted(input_dir.rglob("*")):
        if not path.is_file():
            continue
        pattern = CSV_PATTERN if path.suffix.lower() == ".csv" else SHP_PATTERN
        match = pattern.match(path.name)
        if not match:
            continue
        processing, product_suffix = match.groups()
        processing = processing.lower()
        if processing == "nrt" and not include_nrt:
            continue
        if len(path.parents) < 2:
            continue
        found.append(
            SourceFile(
                path=path,
                country=path.parents[1].name,
                source_product=f"DL_FIRE_{product_suffix}",
                processing=processing,
                file_format=path.suffix.lower().lstrip("."),
            )
        )

    if countries is not None:
        selected = {country.casefold() for country in countries}
        found = [source for source in found if source.country.casefold() in selected]

    # Prefer the supplied CSV when a product has both extracted formats.
    csv_products = {
        (source.country, source.source_product, source.processing)
        for source in found
        if source.file_format == "csv"
    }
    return [
        source
        for source in found
        if source.file_format == "csv"
        or (source.country, source.source_product, source.processing) not in csv_products
    ]
