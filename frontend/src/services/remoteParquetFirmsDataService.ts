import * as duckdb from '@duckdb/duckdb-wasm';
import { HotspotObservation, RegionPreset } from '../types/fire';

interface ParquetManifestFile {
  path: string;
  country_id: string;
  year: number;
  first_date: string;
  last_date: string;
  record_count: number;
}

interface ParquetManifest {
  schema_version: number;
  files: ParquetManifestFile[];
}

const EGYPT_BOUNDS = [[22.0, 24.7], [31.7, 36.9]] as const;
const fileAliases = new Map<string, string>();
const fileRegistrations = new Map<string, Promise<void>>();
let nextRegisteredFileId = 0;
let manifestPromise: Promise<ParquetManifest> | undefined;
let databasePromise: Promise<duckdb.AsyncDuckDB> | undefined;

function dataBaseUrl(): string {
  const rawUrl = import.meta.env.VITE_FIRMS_PARQUET_BASE_URL?.trim();
  if (!rawUrl) throw new Error('VITE_FIRMS_PARQUET_BASE_URL is not configured.');

  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('The public FIRMS Parquet URL must be an HTTPS base URL without credentials or query parameters.');
  }
  return url.href.replace(/\/$/, '');
}

function isManifestFile(value: unknown): value is ParquetManifestFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.path === 'string' &&
    /^country_id=[a-z0-9-]+\/year=\d{4}\/[^/]+\.parquet$/.test(file.path) &&
    typeof file.country_id === 'string' &&
    Number.isInteger(file.year) &&
    file.path.startsWith(`country_id=${file.country_id}/year=${file.year}/`) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(file.first_date)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(file.last_date)) &&
    typeof file.record_count === 'number' &&
    Number.isFinite(file.record_count) &&
    file.record_count > 0 &&
    String(file.first_date) <= String(file.last_date);
}

function isParquetManifest(value: unknown): value is ParquetManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return manifest.schema_version === 1 &&
    Array.isArray(manifest.files) &&
    manifest.files.every(isManifestFile);
}

async function loadManifest(baseUrl: string, signal?: AbortSignal): Promise<ParquetManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${baseUrl}/manifest.json`, { signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load FIRMS data manifest (${response.status}).`);
        const value: unknown = await response.json();
        if (!isParquetManifest(value)) {
          throw new Error('The FIRMS data manifest has an unsupported schema or invalid file index.');
        }
        return value;
      })
      .catch((error: unknown) => {
        manifestPromise = undefined;
        throw error;
      });
  }
  return manifestPromise;
}

async function getDatabase(): Promise<duckdb.AsyncDuckDB> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      if (!bundle.mainWorker) throw new Error('DuckDB-Wasm did not provide a browser worker.');
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(workerUrl);
      const database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      try {
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
      } catch (error) {
        await database.terminate();
        throw error;
      } finally {
        URL.revokeObjectURL(workerUrl);
      }
      return database;
    })().catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function observationFromRow(row: Record<string, unknown>): HotspotObservation {
  const sourceRowNumber = row.source_row_number;
  const confidence = row.confidence_numeric ?? row.confidence_text ?? '';
  return {
    id: `${String(row.country_id)}-${String(row.source_id)}-${String(sourceRowNumber)}`,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    brightness: Number(row.brightness),
    scan: Number(row.scan),
    track: Number(row.track),
    acqDate: String(row.acq_date),
    acqTime: String(row.acq_time),
    satellite: row.satellite as HotspotObservation['satellite'],
    instrument: row.instrument as HotspotObservation['instrument'],
    confidence: typeof confidence === 'number' || typeof confidence === 'string' ? confidence : '',
    version: String(row.version ?? ''),
    quality: row.quality as HotspotObservation['quality'],
    brightT31: row.bright_t31 == null ? undefined : Number(row.bright_t31),
    frp: Number(row.frp),
    daynight: row.daynight as HotspotObservation['daynight'],
    dataOrigin: 'NASA FIRMS local',
    country: row.country == null ? undefined : String(row.country),
    type: row.type == null ? undefined : Number(row.type)
  };
}

export async function fetchRemoteParquetObservations(
  startDate: string,
  region: RegionPreset,
  dayCount: number,
  signal?: AbortSignal
): Promise<HotspotObservation[]> {
  const baseUrl = dataBaseUrl();
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (dayCount - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const manifest = await loadManifest(baseUrl, signal);
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  const files = manifest.files.filter((file) =>
    (region.id === 'all' || file.country_id === region.id) &&
    file.first_date <= endDate &&
    file.last_date >= startDate
  );
  if (files.length === 0) return [];

  const database = await getDatabase();
  const fileNames = files.map((file) => {
    let name = fileAliases.get(file.path);
    if (!name) {
      const basename = file.path.split('/').pop() ?? `part-${nextRegisteredFileId}.parquet`;
      name = `country_id=${file.country_id}/year=${file.year}/${nextRegisteredFileId++}-${basename}`;
      fileAliases.set(file.path, name);
    }
    return name;
  });
  const pendingRegistrations = files
    .map((file, index) => ({ file, name: fileNames[index] }))
    .filter(({ file }) => !fileRegistrations.has(file.path));
  await Promise.all(pendingRegistrations.map(async ({ file, name }) => {
    const url = `${baseUrl}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    const registration = database.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false)
      .catch((error: unknown) => {
        fileRegistrations.delete(file.path);
        throw error;
      });
    fileRegistrations.set(file.path, registration);
  }));
  await Promise.all(files.map((file) => fileRegistrations.get(file.path)));
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

  const inputs = files.map((_, index) => sqlString(fileNames[index])).join(', ');
  const conditions = [
    `acq_date >= ${sqlString(startDate)}`,
    `acq_date <= ${sqlString(endDate)}`
  ];
  if (region.id === 'egypt' || region.id === 'all') {
    const [[south, west], [north, east]] = region.id === 'egypt' ? region.bounds : EGYPT_BOUNDS;
    conditions.push(
      `(country_id <> 'egypt' OR (latitude BETWEEN ${south} AND ${north} AND longitude BETWEEN ${west} AND ${east}))`
    );
  }

  const connection = await database.connect();
  try {
    const result = await connection.query(`
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
      FROM read_parquet([${inputs}], union_by_name = true, hive_partitioning = true)
      WHERE ${conditions.join(' AND ')}
    `);
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    return result.toArray().map((row) =>
      observationFromRow(row as unknown as Record<string, unknown>)
    );
  } finally {
    await connection.close();
  }
}
