from __future__ import annotations

import argparse
from datetime import datetime, timezone
import logging
from pathlib import Path

from .config import PipelineConfig
from .pipeline import run_pipeline


def _default_config() -> PipelineConfig:
    project_root = Path(__file__).resolve().parents[1]
    run_name = datetime.now(timezone.utc).strftime("run-%Y%m%dT%H%M%SZ")
    return PipelineConfig(
        input_dir=project_root / "data",
        output_dir=project_root / "data" / "processed" / run_name,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="firms-harmonize",
        description="Validate, aggregate, compare, and cautiously harmonize NASA FIRMS detections.",
    )
    parser.add_argument("--config", type=Path, help="JSON pipeline configuration.")
    parser.add_argument("--input-dir", type=Path, help="Override the raw-data directory.")
    parser.add_argument("--output-dir", type=Path, help="Override this run's output directory.")
    parser.add_argument(
        "--countries",
        nargs="+",
        help="Process only these top-level country folders (useful for test runs).",
    )
    parser.add_argument("--exclude-nrt", action="store_true", help="Exclude provisional NRT inputs.")
    parser.add_argument("--skip-matching", action="store_true", help="Skip pair-candidate generation.")
    parser.add_argument("--skip-model", action="store_true", help="Skip exploratory index fitting.")
    parser.add_argument("--log-level", default="INFO", choices=("DEBUG", "INFO", "WARNING", "ERROR"))
    return parser


def main() -> None:
    args = _parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config = PipelineConfig.from_json(args.config) if args.config else _default_config()
    overrides = {}
    if args.input_dir:
        overrides["input_dir"] = args.input_dir
    if args.output_dir:
        overrides["output_dir"] = args.output_dir
    if args.countries:
        overrides["countries"] = tuple(args.countries)
    if args.exclude_nrt:
        overrides["include_nrt"] = False
    if args.skip_matching:
        overrides["matching_enabled"] = False
    if args.skip_model:
        overrides["model_enabled"] = False
    if overrides:
        config = PipelineConfig(**{**config.__dict__, **overrides})
    outputs = run_pipeline(config)
    print(f"Completed FIRMS processing. {len(outputs)} output products are under {config.output_dir}")


if __name__ == "__main__":
    main()
