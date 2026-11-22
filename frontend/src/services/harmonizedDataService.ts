import type { MonthlyFireMetric } from '../types/fire';

export interface ModelDiagnostics {
  model_version: string;
  status: string;
  model_formula: string;
  poisson_aic_training: number;
  negative_binomial_aic_training: number;
  negative_binomial_vs_poisson_delta_aic: number;
  negative_binomial_dispersion_alpha_method_of_moments: number;
  temporal_holdout?: {
    split_method: string;
    cutoff_month: string;
    holdout_rows: number;
    metrics_negative_binomial: {
      n: number;
      mae: number;
      rmse: number;
      observed_to_predicted_total: number;
    };
    leakage_prevention_note?: string;
  };
  cross_sensor_agreement?: {
    n_overlapping_months: number;
    pearson_correlation_modis_vs_viirs: number;
    mean_log_ratio_viirs_over_modis: number;
    note?: string;
    per_country?: Array<{
      country: string;
      mean_modis_count: number;
      mean_viirs_count: number;
      mean_viirs_to_modis_ratio: number;
    }>;
  };
  seasonal_bias_analysis?: Array<{
    month: number;
    n: number;
    mean_pearson_residual: number;
    mean_abs_pearson_residual: number;
  }>;
  limitations: string[];
}

export interface HarmonizedMonthlyResponse {
  country: string;
  availableCountries: string[];
  isAvailable: boolean;
  runDir?: string;
  message?: string;
  diagnostics?: ModelDiagnostics;
  metrics: MonthlyFireMetric[];
}

const cache = new Map<string, HarmonizedMonthlyResponse>();
const backendApiBaseUrl =
  (import.meta.env.VITE_BACKEND_API_URL || import.meta.env.VITE_LOCAL_FIRMS_API_URL)
    ?.trim()
    .replace(/\/$/, '') ?? '';
const hasRemoteParquetDataset = Boolean(import.meta.env.VITE_FIRMS_PARQUET_BASE_URL?.trim());
const staticDataBaseUrl = `${import.meta.env.BASE_URL}data/harmonized`;

interface StaticHarmonizedManifest {
  schema_version: 1;
  availableCountries: string[];
  files: Record<string, string>;
}

function isStaticHarmonizedManifest(value: unknown): value is StaticHarmonizedManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schema_version !== 1 ||
    !Array.isArray(manifest.availableCountries) ||
    !manifest.availableCountries.every((country) => typeof country === 'string') ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  ) {
    return false;
  }
  return Object.entries(manifest.files).every(([country, file]) =>
    /^[a-z0-9-]+$/.test(country) &&
    typeof file === 'string' &&
    /^[a-z0-9-]+\.json$/.test(file)
  );
}

function isHarmonizedMonthlyResponse(value: unknown): value is HarmonizedMonthlyResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  if (
    typeof response.country !== 'string' ||
    !Array.isArray(response.availableCountries) ||
    !response.availableCountries.every((country) => typeof country === 'string') ||
    typeof response.isAvailable !== 'boolean' ||
    !Array.isArray(response.metrics)
  ) {
    return false;
  }
  return response.metrics.every((value) => {
    if (!value || typeof value !== 'object') return false;
    const metric = value as Record<string, unknown>;
    return Number.isInteger(metric.year) &&
      Number.isInteger(metric.month) &&
      typeof metric.monthName === 'string' &&
      ['modisCount', 'viirsCount', 'harmonizedIndex', 'modisFRP', 'viirsFRP', 'harmonizedFRP', 'anomalyScore']
        .every((key) => typeof metric[key] === 'number' && Number.isFinite(metric[key])) &&
      typeof metric.isAnomaly === 'boolean' &&
      typeof metric.dominantBiome === 'string';
  });
}

async function fetchStaticHarmonizedData(
  country: string,
  normalizedCountry: string,
  signal?: AbortSignal
): Promise<HarmonizedMonthlyResponse> {
  const manifestResponse = await fetch(`${staticDataBaseUrl}/manifest.json`, { signal });
  if (!manifestResponse.ok) {
    throw new Error(`Could not load the static harmonized data index (${manifestResponse.status}).`);
  }
  const manifestValue: unknown = await manifestResponse.json().catch(() => null);
  if (!isStaticHarmonizedManifest(manifestValue)) {
    throw new Error('The static harmonized data index is invalid.');
  }

  const countryKey = normalizedCountry.replace(/\s+/g, '-');
  const file = manifestValue.files[countryKey];
  if (!file) {
    return {
      country,
      availableCountries: manifestValue.availableCountries,
      isAvailable: false,
      message: `Static harmonized monthly summaries are available for ${manifestValue.availableCountries.join(', ')}.`,
      metrics: []
    };
  }

  const response = await fetch(`${staticDataBaseUrl}/${file}`, { signal });
  if (!response.ok) {
    throw new Error(`Could not load the ${country} harmonized summary (${response.status}).`);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!isHarmonizedMonthlyResponse(value) || !value.isAvailable) {
    throw new Error(`The static harmonized summary for ${country} is invalid.`);
  }
  return { ...value, diagnostics: value.diagnostics ?? undefined };
}

export async function fetchHarmonizedMonthlyData(
  country = 'Suriname',
  signal?: AbortSignal
): Promise<HarmonizedMonthlyResponse> {
  const normalizedCountry = country.trim().toLowerCase();
  const cached = cache.get(normalizedCountry);
  if (cached) return cached;

  if (hasRemoteParquetDataset && !backendApiBaseUrl) {
    const data = await fetchStaticHarmonizedData(country, normalizedCountry, signal);
    cache.set(normalizedCountry, data);
    return data;
  }

  const params = new URLSearchParams({ country });
  const response = await fetch(`${backendApiBaseUrl}/api/harmonized/monthly?${params}`, { signal });

  if (!response.ok) {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const errorText = await response.text();
    if (contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(errorText)) {
      throw new Error(
        `The harmonized monthly API is unavailable (HTTP ${response.status}). This static site includes summaries only for its published countries.`
      );
    }
    let detail = errorText;
    try {
      detail = JSON.parse(errorText).error ?? errorText;
    } catch {
      // Keep plain-text API errors useful without exposing an HTML error page.
    }
    throw new Error(detail || `Failed to load harmonized monthly dataset (${response.status}).`);
  }

  const value: unknown = await response.json().catch(() => null);
  if (!isHarmonizedMonthlyResponse(value)) {
    throw new Error('The harmonized monthly API returned an invalid response.');
  }
  const data = { ...value, diagnostics: value.diagnostics ?? undefined };
  cache.set(normalizedCountry, data);
  return data;
}
