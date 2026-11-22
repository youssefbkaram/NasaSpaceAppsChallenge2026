from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import json
from typing import Any


@dataclass(frozen=True)
class PipelineConfig:
    input_dir: Path
    output_dir: Path
    chunk_size: int = 100_000
    grid_resolutions_m: tuple[int, ...] = (1_000, 5_000, 10_000)
    primary_grid_resolution_m: int = 5_000
    match_distance_thresholds_m: tuple[int, ...] = (1_000, 5_000, 10_000)
    match_time_thresholds_minutes: tuple[int, ...] = (30, 60, 180)
    model_reference: str = "shared_relative_index"
    random_seed: int = 53121
    country_boundaries: Path | None = None
    countries: tuple[str, ...] | None = None
    include_nrt: bool = True
    strict: bool = False
    matching_enabled: bool = True
    model_enabled: bool = True
    extras: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_dir", Path(self.input_dir).resolve())
        object.__setattr__(self, "output_dir", Path(self.output_dir).resolve())
        if self.country_boundaries is not None:
            object.__setattr__(
                self, "country_boundaries", Path(self.country_boundaries).resolve()
            )
        if self.chunk_size < 1:
            raise ValueError("chunk_size must be positive.")
        if not self.grid_resolutions_m or any(value < 1 for value in self.grid_resolutions_m):
            raise ValueError("Grid resolutions must be positive metre values.")
        if self.primary_grid_resolution_m not in self.grid_resolutions_m:
            raise ValueError("The primary grid resolution must be listed in grid_resolutions_m.")
        if any(value < 1 for value in self.match_distance_thresholds_m):
            raise ValueError("Match distance thresholds must be positive.")
        if any(value < 1 for value in self.match_time_thresholds_minutes):
            raise ValueError("Match time thresholds must be positive.")
        if self.model_reference != "shared_relative_index":
            raise ValueError("Only the explicitly labeled shared_relative_index is implemented.")

    @classmethod
    def from_json(cls, path: Path) -> PipelineConfig:
        path = path.resolve()
        values = json.loads(path.read_text(encoding="utf-8"))
        for key in (
            "input_dir",
            "output_dir",
            "country_boundaries",
        ):
            if values.get(key) is not None:
                value = Path(values[key])
                values[key] = value if value.is_absolute() else path.parent / value
        for key in (
            "grid_resolutions_m",
            "match_distance_thresholds_m",
            "match_time_thresholds_minutes",
            "countries",
        ):
            if key in values:
                values[key] = tuple(values[key]) if values[key] is not None else None
        return cls(**values)
