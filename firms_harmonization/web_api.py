from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import gzip
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
from threading import BoundedSemaphore
from typing import Iterator
from urllib.parse import parse_qs, urlsplit

import duckdb

LOGGER = logging.getLogger(__name__)
MAX_QUERY_DAYS = 90
EARLIEST_DATE = date(2000, 11, 1)
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EGYPT_BOUNDS = (22.0, 24.7, 31.7, 36.9)


def _read_manifest(data_dir: Path) -> dict[str, object]:
    manifest_path = data_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Web dataset manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != 1
        or not isinstance(manifest.get("countries"), dict)
        or int(manifest.get("record_count", 0)) <= 0
    ):
        raise ValueError(f"Unsupported or empty web dataset manifest: {manifest_path}")
    if not any(data_dir.glob("country_id=*/year=*/*.parquet")):
        raise FileNotFoundError(f"No web Parquet files found under {data_dir}.")
    return manifest


def _single_param(params: dict[str, list[str]], name: str) -> str | None:
    values = params.get(name)
    if not values:
        return None
    if len(values) != 1:
        raise ValueError(f"Provide exactly one {name} query parameter.")
    return values[0]


def _validate_query(
    params: dict[str, list[str]],
    countries: dict[str, object],
) -> tuple[str, str, str, int]:
    region = _single_param(params, "region")
    start_date = _single_param(params, "date")
    raw_days = _single_param(params, "days")
    if region is None or start_date is None or raw_days is None:
        raise ValueError("The region, date, and days parameters are required.")
    if region != "all" and region not in countries:
        raise ValueError("Choose a country with local FIRMS data or 'all'.")
    if not _DATE_PATTERN.fullmatch(start_date):
        raise ValueError("The date must use YYYY-MM-DD format.")
    try:
        parsed_date = date.fromisoformat(start_date)
    except ValueError as error:
        raise ValueError("Choose a valid calendar date.") from error
    if parsed_date.isoformat() != start_date:
        raise ValueError("Choose a valid calendar date.")
    if parsed_date < EARLIEST_DATE:
        raise ValueError("Observation queries start on 2000-11-01.")
    try:
        days = int(raw_days)
    except ValueError as error:
        raise ValueError("The days parameter must be an integer from 1 to 90.") from error
    if str(days) != raw_days or days < 1 or days > MAX_QUERY_DAYS:
        raise ValueError("The days parameter must be an integer from 1 to 90.")
    end_date = parsed_date + timedelta(days=days - 1)
    if end_date > datetime.now(timezone.utc).date():
        raise ValueError("The requested date range cannot extend beyond today.")
    return region, parsed_date.isoformat(), end_date.isoformat(), days


def query_observations(
    data_dir: Path,
    region: str,
    start_date: str,
    end_date: str,
    *,
    threads: int = 2,
) -> Iterator[tuple[object, ...]]:
    glob = (data_dir / "country_id=*" / "year=*" / "*.parquet").as_posix()
    connection = duckdb.connect(
        database=":memory:",
        config={"threads": str(max(1, threads))},
    )
    conditions = [
        "acq_date >= ?",
        "acq_date <= ?",
        "year >= ?",
        "year <= ?",
    ]
    parameters: list[object] = [
        start_date,
        end_date,
        int(start_date[:4]),
        int(end_date[:4]),
    ]
    if region != "all":
        conditions.append("country_id = ?")
        parameters.append(region)
    south, west, north, east = _EGYPT_BOUNDS
    conditions.append(
        "(country_id <> 'egypt' OR "
        "(latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?))"
    )
    parameters.extend([south, north, west, east])

    query = f"""
        SELECT
            country_id,
            source_id,
            source_row_number,
            latitude,
            longitude,
            brightness,
            scan,
            track,
            acq_date,
            acq_time,
            satellite,
            instrument,
            confidence_numeric,
            confidence_text,
            version,
            quality,
            bright_t31,
            frp,
            daynight,
            country,
            type
        FROM read_parquet(?, hive_partitioning = true, union_by_name = true)
        WHERE {" AND ".join(conditions)}
    """
    try:
        cursor = connection.execute(query, [glob, *parameters])
    except Exception:
        connection.close()
        raise

    def rows() -> Iterator[tuple[object, ...]]:
        try:
            while batch := cursor.fetchmany(2_000):
                yield from batch
        finally:
            connection.close()

    return rows()


def _observation(row: tuple[object, ...]) -> dict[str, object]:
    (
        country_id,
        source_id,
        source_row_number,
        latitude,
        longitude,
        brightness,
        scan,
        track,
        acquisition_date,
        acquisition_time,
        satellite,
        instrument,
        confidence_numeric,
        confidence_text,
        version,
        quality,
        bright_t31,
        frp,
        daynight,
        country,
        fire_type,
    ) = row
    result: dict[str, object] = {
        "id": f"{country_id}-{source_id}-{source_row_number}",
        "latitude": latitude,
        "longitude": longitude,
        "brightness": brightness,
        "scan": scan,
        "track": track,
        "acqDate": acquisition_date,
        "acqTime": acquisition_time,
        "satellite": satellite,
        "instrument": instrument,
        "confidence": confidence_numeric if confidence_numeric is not None else confidence_text or "",
        "version": version or "",
        "quality": quality,
        "frp": frp,
        "daynight": daynight,
        "dataOrigin": "NASA FIRMS local",
        "country": country,
    }
    if bright_t31 is not None:
        result["brightT31"] = bright_t31
    if fire_type is not None:
        result["type"] = fire_type
    return result


def _allowed_origins() -> set[str]:
    configured = os.environ.get(
        "FIRMS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return {origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()}


def make_handler(
    data_dir: Path,
    manifest: dict[str, object],
    origins: set[str],
    query_slots: BoundedSemaphore,
    query_threads: int,
) -> type[BaseHTTPRequestHandler]:
    countries = manifest.get("countries")
    if not isinstance(countries, dict):
        raise ValueError("The web dataset manifest has no country index.")

    class FIRMSWebHandler(BaseHTTPRequestHandler):
        server_version = "FIRMSDataAPI/1.0"

        def do_HEAD(self) -> None:
            path = urlsplit(self.path).path
            if path == "/healthz":
                self._send_json(200, {
                    "status": "ok",
                    "recordCount": manifest["record_count"],
                }, include_body=False)
                return
            self._send_json(404, {"error": "Not found."}, include_body=False)

        def do_POST(self) -> None:
            self._send_json(
                405,
                {"error": "Only read-only GET requests are accepted."},
                headers={"Allow": "GET, HEAD, OPTIONS"},
            )

        def _add_cors_headers(self) -> bool:
            origin = self.headers.get("Origin")
            if origin is None:
                return True
            if origin not in origins:
                return False
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            return True

        def do_OPTIONS(self) -> None:
            if urlsplit(self.path).path != "/api/local-firms/data":
                self.send_error(404)
                return
            origin = self.headers.get("Origin")
            if origin and origin not in origins:
                self.send_error(403)
                return
            self.send_response(204)
            if self._add_cors_headers():
                self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if path == "/healthz":
                self._send_json(200, {
                    "status": "ok",
                    "recordCount": manifest["record_count"],
                })
                return
            if path != "/api/local-firms/data":
                self._send_json(404, {"error": "Not found."})
                return

            origin = self.headers.get("Origin")
            if origin and origin not in origins:
                self._send_json(403, {"error": "This origin is not allowed."})
                return
            try:
                params = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                region, start_date, end_date, _ = _validate_query(params, countries)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return

            if not query_slots.acquire(blocking=False):
                self._send_json(
                    503,
                    {"error": "The data service is busy. Please retry shortly."},
                    headers={"Retry-After": "2"},
                )
                return

            connection_rows: Iterator[tuple[object, ...]] | None = None
            try:
                connection_rows = query_observations(
                    data_dir,
                    region,
                    start_date,
                    end_date,
                    threads=query_threads,
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._add_cors_headers()
                compressed = "gzip" in self.headers.get("Accept-Encoding", "").casefold()
                if compressed:
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Cache-Control", "public, max-age=60")
                self.end_headers()

                output = gzip.GzipFile(fileobj=self.wfile, mode="wb", mtime=0) if compressed else self.wfile
                output.write(b"[")
                first = True
                for row in connection_rows:
                    if not first:
                        output.write(b",")
                    output.write(json.dumps(
                        _observation(row),
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode("utf-8"))
                    first = False
                output.write(b"]")
                if compressed:
                    output.close()
            except BrokenPipeError:
                LOGGER.info("Client disconnected while receiving FIRMS data.")
            except Exception:
                LOGGER.exception("FIRMS Parquet query failed.")
                if not self.wfile.closed:
                    self.close_connection = True
            finally:
                if connection_rows is not None:
                    connection_rows.close()
                query_slots.release()

        def _send_json(
            self,
            status: int,
            payload: dict[str, object],
            headers: dict[str, str] | None = None,
            include_body: bool = True,
        ) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._add_cors_headers()
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.send_header("Content-Length", "0" if not include_body else str(len(body)))
            self.end_headers()
            if include_body:
                self.wfile.write(body)

        def log_message(self, format_string: str, *args: object) -> None:
            LOGGER.info("%s - %s", self.address_string(), format_string % args)

    return FIRMSWebHandler


def serve(
    data_dir: Path,
    host: str = "0.0.0.0",
    port: int = 8000,
    query_threads: int = 2,
    max_concurrent_queries: int = 2,
) -> None:
    data_dir = data_dir.resolve()
    manifest = _read_manifest(data_dir)
    handler = make_handler(
        data_dir,
        manifest,
        _allowed_origins(),
        BoundedSemaphore(max_concurrent_queries),
        query_threads,
    )
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    LOGGER.info(
        "Serving %s observations from %s on %s:%s",
        f"{int(manifest['record_count']):,}",
        data_dir,
        host,
        port,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping FIRMS data API.")
    finally:
        server.server_close()


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        prog="firms-serve-web-data",
        description="Serve filtered FIRMS observations from a local Parquet dataset.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("FIRMS_WEB_DATA_DIR", project_root / "data" / "web-parquet")),
    )
    parser.add_argument("--host", default=os.environ.get("FIRMS_WEB_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FIRMS_WEB_PORT", "8000")))
    parser.add_argument(
        "--query-threads",
        type=int,
        default=int(os.environ.get("FIRMS_QUERY_THREADS", "2")),
    )
    parser.add_argument(
        "--max-concurrent-queries",
        type=int,
        default=int(os.environ.get("FIRMS_MAX_CONCURRENT_QUERIES", "2")),
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    args = parser.parse_args()
    if args.port < 1 or args.port > 65535:
        parser.error("--port must be between 1 and 65535.")
    if args.query_threads < 1 or args.max_concurrent_queries < 1:
        parser.error("Query thread and concurrency limits must be positive.")
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    serve(
        args.data_dir,
        host=args.host,
        port=args.port,
        query_threads=args.query_threads,
        max_concurrent_queries=args.max_concurrent_queries,
    )


if __name__ == "__main__":
    main()
