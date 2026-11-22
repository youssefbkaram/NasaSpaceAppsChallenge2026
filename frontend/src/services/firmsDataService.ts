import { HotspotObservation, RegionPreset } from '../types/fire';
import {
  FIRMS_DATA_END_DATE,
  FIRMS_DATA_START_DATE,
  MAX_FIRMS_QUERY_DAYS
} from '../data/firmsDataAvailability';
import { createSyntheticFIRMSObservations } from './syntheticFirmsDataService';
import { fetchRemoteParquetObservations } from './remoteParquetFirmsDataService';

export type FIRMSDataMode = 'local' | 'real' | 'synthetic';
const configuredDataMode = import.meta.env.VITE_FIRMS_DATA_MODE;
const localFirmsApiBaseUrl =
  (import.meta.env.VITE_LOCAL_FIRMS_API_URL || import.meta.env.VITE_BACKEND_API_URL)
    ?.trim()
    .replace(/\/$/, '') ?? '';
const firmsParquetBaseUrl = import.meta.env.VITE_FIRMS_PARQUET_BASE_URL?.trim() ?? '';
export const FIRMS_DATA_MODE: FIRMSDataMode = configuredDataMode === 'real' ||
  configuredDataMode === 'synthetic' || configuredDataMode === 'local'
  ? configuredDataMode
  : 'local';

type FirmsSource =
  | 'MODIS_NRT'
  | 'MODIS_SP'
  | 'VIIRS_SNPP_NRT'
  | 'VIIRS_SNPP_SP'
  | 'VIIRS_NOAA20_NRT'
  | 'VIIRS_NOAA20_SP'
  | 'VIIRS_NOAA21_NRT'
  | 'VIIRS_NOAA21_SP';

const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_PROCESSING_LAG_DAYS = 150;
const responseCache = new Map<string, HotspotObservation[]>();
const LAUNCH_DATES: Partial<Record<FirmsSource, string>> = {
  VIIRS_SNPP_NRT: '2012-01-01',
  VIIRS_SNPP_SP: '2012-01-01',
  VIIRS_NOAA20_NRT: '2018-04-01',
  VIIRS_NOAA20_SP: '2018-04-01',
  VIIRS_NOAA21_NRT: '2024-01-01',
  VIIRS_NOAA21_SP: '2024-01-01'
};

function formatUTCDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return formatUTCDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));
}

function sourcesForDate(date: string): FirmsSource[] {
  const ageDays = (Date.now() - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
  const quality = ageDays >= STANDARD_PROCESSING_LAG_DAYS ? 'SP' : 'NRT';
  const sources: FirmsSource[] = [`MODIS_${quality}` as FirmsSource];

  for (const sensor of ['VIIRS_SNPP', 'VIIRS_NOAA20', 'VIIRS_NOAA21'] as const) {
    const source = `${sensor}_${quality}` as FirmsSource;
    if (date >= (LAUNCH_DATES[source] ?? '9999-12-31')) sources.push(source);
  }

  return sources;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isHotspotObservation(value: unknown): value is HotspotObservation {
  if (!value || typeof value !== 'object') return false;
  const observation = value as Record<string, unknown>;
  return typeof observation.id === 'string' &&
    typeof observation.latitude === 'number' &&
    typeof observation.longitude === 'number' &&
    typeof observation.acqDate === 'string' &&
    typeof observation.instrument === 'string' &&
    typeof observation.frp === 'number' &&
    observation.dataOrigin === 'NASA FIRMS local';
}

function parseFIRMSCSV(csvText: string, source: FirmsSource): HotspotObservation[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const index = (name: string, alternative?: string) => {
    const exact = headers.indexOf(name);
    return exact >= 0 || !alternative ? exact : headers.indexOf(alternative);
  };
  const column = (values: string[], name: string, alternative?: string) => {
    const position = index(name, alternative);
    return position < 0 ? undefined : values[position]?.trim();
  };

  const instrument = source.startsWith('MODIS_') ? 'MODIS' : 'VIIRS';
  const results: HotspotObservation[] = [];

  for (const [rowIndex, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    const values = line.split(',');
    const latitude = parseNumber(column(values, 'latitude'));
    const longitude = parseNumber(column(values, 'longitude'));
    const brightness = parseNumber(column(values, 'brightness', 'bright_ti4'));
    const scan = parseNumber(column(values, 'scan'));
    const track = parseNumber(column(values, 'track'));
    const frp = parseNumber(column(values, 'frp'));
    const acqDate = column(values, 'acq_date');
    const acqTime = column(values, 'acq_time');
    const satelliteCode = column(values, 'satellite')?.toUpperCase() ?? '';

    if (
      latitude === undefined || longitude === undefined ||
      brightness === undefined || scan === undefined || track === undefined ||
      frp === undefined || !acqDate || !acqTime
    ) {
      continue;
    }

    const satellite = satelliteCode === 'T' ? 'Terra'
      : satelliteCode === 'A' ? 'Aqua'
      : /N21|J2|NOAA.?21/.test(satelliteCode) ? 'NOAA-21'
      : /N20|J1|NOAA.?20|^1$/.test(satelliteCode) ? 'NOAA-20'
      : /NPP|SNPP|^N$/.test(satelliteCode) ? 'Suomi-NPP'
      : undefined;
    if (!satellite) continue;

    const confidenceValue = column(values, 'confidence');
    const numericConfidence = parseNumber(confidenceValue);
    const confidence = numericConfidence ?? confidenceValue;
    const version = column(values, 'version') ?? '';
    const daynightValue = column(values, 'daynight')?.toUpperCase();
    const quality = source.endsWith('_SP') ? 'SP' : 'NRT';
    if (daynightValue !== 'D' && daynightValue !== 'N') continue;

    results.push({
      id: `firms-${source}-${acqDate}-${acqTime}-${rowIndex}`,
      latitude,
      longitude,
      brightness,
      scan,
      track,
      acqDate,
      acqTime,
      satellite,
      instrument,
      confidence,
      version,
      quality,
      brightT31: parseNumber(column(values, 'bright_t31', 'bright_ti5')),
      frp,
      daynight: daynightValue,
      dataOrigin: 'NASA FIRMS',
      type: parseNumber(column(values, 'type'))
    });
  }

  return results;
}

async function fetchAreaSource(
  source: FirmsSource,
  date: string,
  bounds: RegionPreset['bounds'],
  days: number,
  signal?: AbortSignal
): Promise<HotspotObservation[]> {
  const [[south, west], [north, east]] = bounds;
  const bbox = [west, south, east, north].join(',');
  const cacheKey = `${source}|${date}|${days}|${bbox}`;
  const cached = responseCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    source,
    bbox,
    date,
    days: String(days)
  });
  const response = await fetch(`/api/firms/area?${params}`, { signal });
  const body = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!response.ok) {
    let detail = body;
    try {
      detail = JSON.parse(body).error ?? body;
    } catch {
      // FIRMS can return plain-text error messages.
    }
    if (response.status === 429 || /limit.{0,40}(reached|exceeded)|too many requests/i.test(detail)) {
      throw new Error(
        'NASA FIRMS has temporarily rate-limited this map key. Wait for the limit window to reset or use the local FIRMS archive mode.'
      );
    }
    throw new Error(detail || `NASA FIRMS request failed (${response.status}).`);
  }

  const csvBody = body.replace(/^\uFEFF/, '').trimStart();
  if (/limit.{0,40}(reached|exceeded)|too many requests/i.test(csvBody)) {
    throw new Error(
      'NASA FIRMS has temporarily rate-limited this map key. Wait for the limit window to reset or use the local FIRMS archive mode.'
    );
  }
  if (
    contentType.includes('text/html') ||
    csvBody.toLowerCase().startsWith('<!doctype html') ||
    csvBody.toLowerCase().startsWith('<html')
  ) {
    throw new Error(
      'The FIRMS API request received the website page instead of data. Restart the frontend from the frontend folder with `npm run dev`, then check NASA_FIRMS_MAP_KEY in frontend/.env.local.'
    );
  }

  if (csvBody && !csvBody.toLowerCase().startsWith('latitude,')) {
    throw new Error(`NASA FIRMS returned an unexpected response for ${source}: ${csvBody.slice(0, 180)}`);
  }

  const observations = parseFIRMSCSV(csvBody, source);
  responseCache.set(cacheKey, observations);
  if (responseCache.size > 60) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  return observations;
}

export async function fetchNASAObservations(
  startDate: string,
  region: RegionPreset,
  dayCount = 1,
  signal?: AbortSignal
): Promise<HotspotObservation[]> {
  const parsedDate = new Date(`${startDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== startDate
  ) {
    throw new Error('Choose a valid observation date.');
  }
  if (startDate < FIRMS_DATA_START_DATE || startDate > FIRMS_DATA_END_DATE) {
    throw new Error(`NASA FIRMS observations are available from ${FIRMS_DATA_START_DATE} through ${FIRMS_DATA_END_DATE}.`);
  }
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > MAX_FIRMS_QUERY_DAYS) {
    throw new Error(`The requested date range must be between 1 and ${MAX_FIRMS_QUERY_DAYS} days.`);
  }
  if (addDays(startDate, dayCount - 1) > FIRMS_DATA_END_DATE) {
    throw new Error(`The requested date range cannot extend beyond ${FIRMS_DATA_END_DATE}.`);
  }
  if (FIRMS_DATA_MODE === 'local') {
    if (firmsParquetBaseUrl) {
      return fetchRemoteParquetObservations(startDate, region, dayCount, signal);
    }
    const params = new URLSearchParams({
      region: region.id,
      date: startDate,
      days: String(dayCount)
    });
    const response = await fetch(`${localFirmsApiBaseUrl}/api/local-firms/data?${params}`, { signal });
    const body = await response.text();
    if (!response.ok) {
      let detail = body;
      try {
        detail = JSON.parse(body).error ?? body;
      } catch {
        // Keep the response body when the local data endpoint returns plain text.
      }
      throw new Error(detail || `Local FIRMS request failed (${response.status}).`);
    }
    const observations: unknown = JSON.parse(body);
    if (!Array.isArray(observations) || !observations.every(isHotspotObservation)) {
      throw new Error('The local FIRMS endpoint returned an invalid observation list.');
    }
    return observations;
  }
  if (FIRMS_DATA_MODE === 'synthetic') {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    return createSyntheticFIRMSObservations(startDate, region, dayCount);
  }

  const results: HotspotObservation[][] = [];
  const latestAvailableDate = FIRMS_DATA_END_DATE;
  for (let offset = 0; offset < dayCount;) {
    const requestDate = addDays(startDate, offset);
    if (requestDate > latestAvailableDate) break;

    const requestSources = sourcesForDate(requestDate);
    const remainingAvailableDays = Math.floor(
      (Date.parse(`${latestAvailableDate}T00:00:00Z`) - Date.parse(`${requestDate}T00:00:00Z`)) / DAY_MS
    ) + 1;
    let requestDays = Math.min(5, dayCount - offset, remainingAvailableDays);
    while (
      requestDays > 1 &&
      sourcesForDate(addDays(requestDate, requestDays - 1)).join(',') !== requestSources.join(',')
    ) {
      requestDays--;
    }

    const batch = await Promise.all(requestSources.map((source) =>
      fetchAreaSource(source, requestDate, region.bounds, requestDays, signal)
    ));
    results.push(...batch);
    offset += requestDays;
  }

  const unique = new Map<string, HotspotObservation>();
  for (const observation of results.flat()) {
    unique.set(observation.id, observation);
  }
  return [...unique.values()];
}
