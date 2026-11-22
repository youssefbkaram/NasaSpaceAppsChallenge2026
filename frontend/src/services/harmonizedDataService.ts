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

export async function fetchHarmonizedMonthlyData(
  country = 'Suriname',
  signal?: AbortSignal
): Promise<HarmonizedMonthlyResponse> {
  const normalizedCountry = country.trim().toLowerCase();
  const cached = cache.get(normalizedCountry);
  if (cached) return cached;

  const params = new URLSearchParams({ country });
  const response = await fetch(`${backendApiBaseUrl}/api/harmonized/monthly?${params}`, { signal });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load harmonized monthly dataset: ${errorText || response.statusText}`);
  }

  const data = (await response.json()) as HarmonizedMonthlyResponse;
  cache.set(normalizedCountry, data);
  return data;
}
