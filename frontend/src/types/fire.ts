export type SensorType = 'MODIS' | 'VIIRS' | 'ALL_RAW';

export type SatellitePlatform = 'Terra' | 'Aqua' | 'Suomi-NPP' | 'NOAA-20' | 'NOAA-21' | 'Harmonized-Ensemble';

export interface HotspotObservation {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number; // Kelvin
  scan: number; // along-scan pixel size (km)
  track: number; // along-track pixel size (km)
  acqDate: string; // YYYY-MM-DD
  acqTime: string; // HHMM UTC
  satellite: SatellitePlatform;
  instrument: 'MODIS' | 'VIIRS';
  confidence?: number | string;
  version: string;
  quality?: 'NRT' | 'SP';
  brightT31?: number; // Kelvin
  frp: number; // Fire Radiative Power (MW)
  daynight: 'D' | 'N';
  dataOrigin?: 'NASA FIRMS' | 'NASA FIRMS local' | 'synthetic';
  country?: string;
  type?: number;
  harmonizedWeight?: number;
  harmonizedFRP?: number;
  equivalentFireUnits?: number;
}

export interface RegionPreset {
  id: string;
  name: string;
  description: string;
  center: [number, number]; // lat, lng
  zoom: number;
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
  biome: string;
  fireRegime: string;
}

export interface MonthlyFireMetric {
  year: number;
  month: number; // 1 - 12
  monthName: string;
  modisCount: number;
  viirsCount: number;
  harmonizedIndex: number;
  modisFRP: number; // Sum FRP in MW
  viirsFRP: number; // Sum FRP in MW
  harmonizedFRP: number;
  anomalyScore: number; // Z-score
  isAnomaly: boolean;
  anomalySeverity?: 'none' | 'moderate' | 'high' | 'extreme';
  dominantBiome: string;
  uncertaintyLower?: number;
  uncertaintyUpper?: number;
  qualityFlag?: string;
  dataCoverageStatus?: string;
  processingNote?: string;
  calibratedActivityEstimate?: number;
  rawModisCount?: number;
  rawViirsCount?: number;
  availabilityStatus?: string;
}

export interface AnomalyEvent {
  id: string;
  date: string;
  region: string;
  severity: 'moderate' | 'high' | 'critical';
  zScore: number;
  observedActivity: number;
  baselineActivity: number;
  percentAboveNormal: number;
  environmentalDrivers: {
    vpdAnomaly: string; // Vapor Pressure Deficit
    tempAnomaly: string;
    droughtIndex: string;
  };
  scientificNote: string;
}

export interface ForecastPeriod {
  month: string;
  historicalBaseline: number;
  forecastMean: number;
  forecastLower95: number;
  forecastUpper95: number;
  riskLevel: 'Low' | 'Moderate' | 'Elevated' | 'Extreme';
  confidence: number;
}

export interface SensorComparisonStats {
  modisTotalHotspots: number;
  viirsTotalHotspots: number;
  harmonizedTotalHotspots: number;
  viirsToModisRatio: number;
  meanModisFRP: number;
  meanViirsFRP: number;
  calibratedFRP: number;
  footprintDistortionMax: number; // e.g., 4.8x at MODIS swath edge
  resolutionAdvantage: string; // "375m vs 1000m"
}
