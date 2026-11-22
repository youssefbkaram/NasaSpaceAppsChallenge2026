from __future__ import annotations

from pathlib import Path


def parquet_file_list(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(path.rglob("*.parquet"))


def read_parquet_sql(path: Path, hive_partitioning: bool = False) -> str:
    files = parquet_file_list(path)
    if not files:
        raise FileNotFoundError(f"No Parquet files found under {path}")
    quoted = ", ".join(
        "'" + file.as_posix().replace("'", "''") + "'" for file in files
    )
    hive = ", hive_partitioning = true" if hive_partitioning else ""
    return f"read_parquet([{quoted}]{hive})"


def sql_string(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"
