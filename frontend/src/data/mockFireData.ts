import type {
  HotspotObservation,
  MonthlyFireMetric,
  AnomalyEvent,
  ForecastPeriod,
  SensorComparisonStats
} from '../types/fire';
import { REGION_PRESETS } from './regionPresets';

// Helper to generate hotspots around a region
export function generateHotspotsForRegion(regionId: string, count = 250): HotspotObservation[] {
  const preset = REGION_PRESETS.find(r => r.id === regionId) || REGION_PRESETS[0];
  const [south, west] = preset.bounds[0];
  const [north, east] = preset.bounds[1];

  const hotspots: HotspotObservation[] = [];
  const instruments: ('MODIS' | 'VIIRS')[] = ['MODIS', 'VIIRS', 'VIIRS', 'VIIRS']; // VIIRS detects more
  const satellites: Record<'MODIS' | 'VIIRS', ('Terra' | 'Aqua' | 'Suomi-NPP' | 'NOAA-20')[]> = {
    MODIS: ['Terra', 'Aqua'],
    VIIRS: ['Suomi-NPP', 'NOAA-20']
  };

  for (let i = 0; i < count; i++) {
    // Cluster hotspots in realistic clumps
    const clusterCenterLat = south + (north - south) * (0.2 + 0.6 * Math.sin(i * 0.17));
    const clusterCenterLng = west + (east - west) * (0.2 + 0.6 * Math.cos(i * 0.23));

    const lat = clusterCenterLat + (Math.random() - 0.5) * 1.8;
    const lng = clusterCenterLng + (Math.random() - 0.5) * 2.2;

    const instrument = instruments[Math.floor(Math.random() * instruments.length)];
    const satList = satellites[instrument];
    const satellite = satList[Math.floor(Math.random() * satList.length)];

    // Physics differences:
    // MODIS: 1km nadir, up to 4.8km edge; VIIRS: 0.375km nadir, up to 0.8km edge
    const isModis = instrument === 'MODIS';
    const scan = isModis ? Number((1.0 + Math.random() * 3.2).toFixed(2)) : Number((0.375 + Math.random() * 0.42).toFixed(3));
    const track = isModis ? Number((1.0 + Math.random() * 1.2).toFixed(2)) : Number((0.375 + Math.random() * 0.2).toFixed(3));

    // FRP: VIIRS detects low FRP fires (1 - 50 MW); MODIS generally higher (>10 MW)
    const rawFRP = isModis 
      ? Number((12 + Math.random() * 180 + (Math.random() > 0.85 ? 350 : 0)).toFixed(1))
      : Number((1.5 + Math.random() * 140 + (Math.random() > 0.85 ? 280 : 0)).toFixed(1));

    // Brightness Temp (Kelvin): 300K - 450K
    const brightness = Number((310 + Math.random() * 95 + (rawFRP > 100 ? 50 : 0)).toFixed(1));
    const brightT31 = Number((brightness - (15 + Math.random() * 35)).toFixed(1));

    // Harmonization factor: Accounts for sensor footprint swelling and detection probability
    // A MODIS 3x3km pixel covers ~9x the area of a VIIRS 375m pixel, but may represent multiple small fires.
    // Harmonized weight standardizes FRP and cluster count into equivalent standard fire units.
    const footprintRatio = (scan * track) / (0.375 * 0.375);
    const detectionThresholdWeight = isModis ? 1.45 : 0.42; // Scaling to match cross-sensor probability
    const harmonizedWeight = Number((1 / Math.sqrt(footprintRatio) * detectionThresholdWeight).toFixed(3));
    const harmonizedFRP = Number((rawFRP * (isModis ? 0.94 : 1.08)).toFixed(1));
    const equivalentFireUnits = Number((isModis ? 1.0 + Math.min(2.5, rawFRP / 80) : 0.65).toFixed(2));

    const daynight = Math.random() > 0.3 ? 'D' : 'N';
    const confidence = isModis 
      ? Math.floor(40 + Math.random() * 60)
      : (Math.random() > 0.15 ? 'nominal' : (Math.random() > 0.5 ? 'high' : 'low'));

    // Timestamp within current fire season window
    const day = 1 + Math.floor(Math.random() * 28);
    const month = (regionId === 'australia') ? 1 : (regionId === 'california' ? 9 : 8);
    const acqDate = `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hour = daynight === 'D' ? 10 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 4);
    const minute = Math.floor(Math.random() * 60);
    const acqTime = `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;

    hotspots.push({
      id: `fire-${regionId}-${i}`,
      latitude: Number(lat.toFixed(4)),
      longitude: Number(lng.toFixed(4)),
      brightness,
      brightT31,
      scan,
      track,
      acqDate,
      acqTime,
      satellite,
      instrument,
      confidence,
      version: isModis ? '6.1NRT' : '2.0NRT',
      frp: rawFRP,
      daynight,
      harmonizedWeight,
      harmonizedFRP,
      equivalentFireUnits
    });
  }

  return hotspots;
}

// Generate monthly historical metrics from 2000 to 2026
export function generateMonthlyHistoricalData(regionId: string): MonthlyFireMetric[] {
  const metrics: MonthlyFireMetric[] = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Seasonal peak month depending on region
  const peakMonth = regionId === 'australia' ? 1 // Jan
    : regionId === 'california' ? 9 // Sep
    : regionId === 'siberia' ? 7 // Jul
    : regionId === 'congo' ? 7 // Jul
    : 8; // Amazon: Aug-Sep

  for (let year = 2000; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      // Historical climate anomalies
      let climateFactor = 1.0;
      
      // Known historical fire events:
      if (regionId === 'amazon' && (year === 2005 || year === 2010 || year === 2019 || year === 2020 || year === 2023)) {
        climateFactor = 1.95; // Major Amazon drought years
      } else if (regionId === 'california' && (year === 2017 || year === 2018 || year === 2020 || year === 2021)) {
        climateFactor = 2.4; // Extreme California wildfire seasons
      } else if (regionId === 'australia' && (year === 2019 && month === 12 || year === 2020 && month <= 2)) {
        climateFactor = 4.2; // Black Summer megafire
      } else if (regionId === 'siberia' && (year === 2020 || year === 2021)) {
        climateFactor = 2.8; // Arctic Heatwave & Siberian fires
      }

      // Monthly seasonality curve (Gaussian shaped around peak month)
      const distFromPeak = Math.min(Math.abs(month - peakMonth), 12 - Math.abs(month - peakMonth));
      const seasonality = Math.exp(-(distFromPeak * distFromPeak) / 3.8);

      // Base monthly MODIS detection count
      const baseModis = (80 + 1200 * seasonality) * climateFactor * (0.85 + Math.random() * 0.3);
      const modisCount = Math.round(baseModis);
      const modisFRP = Math.round(modisCount * (28 + Math.random() * 12));

      // VIIRS operational timeline:
      // VIIRS launched on Suomi-NPP in late 2011 (first full year 2012).
      // NOAA-20 launched in late 2017 (operational 2018).
      // Prior to 2012, VIIRS = 0! This is the exact sensor discontinuity our project solves.
      let viirsCount = 0;
      let viirsFRP = 0;

      if (year >= 2012) {
        // VIIRS has 375m resolution: typically detects 3.2x to 4.5x more hotspots than MODIS for the same area
        const viirsMultiplier = (year >= 2018 ? 4.1 : 3.3) * (0.92 + Math.random() * 0.16);
        viirsCount = Math.round(modisCount * viirsMultiplier);
        viirsFRP = Math.round(viirsCount * (16 + Math.random() * 8));
      }

      // Harmonization algorithm:
      // Computes a normalized, continuous metric across the entire 2000-2026 timeline!
      // In the MODIS-only era (2000-2011), it models the equivalent 375m fire activity index.
      // In the dual-sensor era (2012-2026), it applies footprint-weighted cross-sensor Bayesian synthesis.
      let harmonizedIndex = 0;
      let harmonizedFRP = 0;

      if (year < 2012) {
        // Calibrated synthetic equivalent
        harmonizedIndex = Math.round(modisCount * 3.52);
        harmonizedFRP = Math.round(modisFRP * 1.15);
      } else {
        // Weighted fusion: 0.25 * MODIS_scaled + 0.75 * VIIRS_calibrated
        harmonizedIndex = Math.round((modisCount * 3.52 * 0.3) + (viirsCount * 0.7));
        harmonizedFRP = Math.round((modisFRP * 1.15 * 0.3) + (viirsFRP * 0.7));
      }

      // Anomaly detection score (Z-Score against baseline monthly mean)
      const baselineMean = (80 + 1200 * seasonality) * 3.52;
      const baselineStd = baselineMean * 0.35 + 20;
      const anomalyScore = Number(((harmonizedIndex - baselineMean) / baselineStd).toFixed(2));
      const isAnomaly = anomalyScore >= 2.0 && seasonality > 0.2;

      let anomalySeverity: 'none' | 'moderate' | 'high' | 'extreme' = 'none';
      if (anomalyScore >= 3.5) anomalySeverity = 'extreme';
      else if (anomalyScore >= 2.8) anomalySeverity = 'high';
      else if (anomalyScore >= 2.0) anomalySeverity = 'moderate';

      metrics.push({
        year,
        month,
        monthName: monthNames[month - 1],
        modisCount,
        viirsCount,
        harmonizedIndex,
        modisFRP,
        viirsFRP,
        harmonizedFRP,
        anomalyScore,
        isAnomaly,
        anomalySeverity,
        dominantBiome: REGION_PRESETS.find(r => r.id === regionId)?.biome || 'Global Forest'
      });
    }
  }

  return metrics;
}

export const ANOMALY_EVENTS: AnomalyEvent[] = [
  {
    id: 'anom-1',
    date: '2019-08-15',
    region: 'Amazon Basin (Deforestation Arc)',
    severity: 'critical',
    zScore: 4.35,
    observedActivity: 48520,
    baselineActivity: 18200,
    percentAboveNormal: 166.6,
    environmentalDrivers: {
      vpdAnomaly: '+2.8 kPa (Severe Atmospheric Drying)',
      tempAnomaly: '+2.4 °C above 1991–2020 climatology',
      droughtIndex: 'SPEI -2.15 (Extreme Agricultural Drought)'
    },
    scientificNote: 'Severe spike driven by late-dry-season pasture preparation fires coinciding with atmospheric blocking and negative rainfall anomaly across Mato Grosso and Rondônia.'
  },
  {
    id: 'anom-2',
    date: '2020-01-04',
    region: 'Southeast Australia',
    severity: 'critical',
    zScore: 5.82,
    observedActivity: 89400,
    baselineActivity: 14200,
    percentAboveNormal: 529.6,
    environmentalDrivers: {
      vpdAnomaly: '+3.6 kPa (Record Heat Dome)',
      tempAnomaly: '+3.9 °C regional peak',
      droughtIndex: 'Record positive Indian Ocean Dipole (+2.1 °C)'
    },
    scientificNote: 'Unprecedented Black Summer pyrocumulonimbus outbreak. VIIRS detected extensive low-intensity understory smoldering undetectable by MODIS due to thick smoke absorption.'
  },
  {
    id: 'anom-3',
    date: '2020-09-12',
    region: 'California Wildfire Corridor',
    severity: 'high',
    zScore: 3.91,
    observedActivity: 32400,
    baselineActivity: 9600,
    percentAboveNormal: 237.5,
    environmentalDrivers: {
      vpdAnomaly: '+2.9 kPa (Diablo Foehn Wind Event)',
      tempAnomaly: '+3.1 °C heatwave',
      droughtIndex: 'Fuel Moisture Index < 4% (Extreme)'
    },
    scientificNote: 'Simultaneous ignition of August Complex and Creek Fire. Sensor footprint distortion in MODIS (off-nadir >45°) caused significant pixel duplication corrected by our harmonization grid.'
  },
  {
    id: 'anom-4',
    date: '2021-07-20',
    region: 'Siberian Boreal Taiga (Sakha)',
    severity: 'high',
    zScore: 3.42,
    observedActivity: 27800,
    baselineActivity: 8800,
    percentAboveNormal: 215.9,
    environmentalDrivers: {
      vpdAnomaly: '+2.2 kPa (Arctic High-Pressure Ridge)',
      tempAnomaly: '+4.5 °C above regional normal',
      droughtIndex: 'Subsurface Peat Desiccation Level 4'
    },
    scientificNote: 'Sub-arctic "zombie fires" transitioning into deep peat smoldering. Cross-sensor calibration revealed VIIRS detected 5.2x more active thermal anomalies than MODIS due to dense canopy cover.'
  }
];

export const FORECAST_DATA: ForecastPeriod[] = [
  {
    month: 'Dec 2026',
    historicalBaseline: 8200,
    forecastMean: 9100,
    forecastLower95: 6400,
    forecastUpper95: 12200,
    riskLevel: 'Moderate',
    confidence: 0.88
  },
  {
    month: 'Jan 2027',
    historicalBaseline: 11400,
    forecastMean: 13800,
    forecastLower95: 9800,
    forecastUpper95: 18600,
    riskLevel: 'Elevated',
    confidence: 0.85
  },
  {
    month: 'Feb 2027',
    historicalBaseline: 14200,
    forecastMean: 18900,
    forecastLower95: 13200,
    forecastUpper95: 25400,
    riskLevel: 'Extreme',
    confidence: 0.81
  },
  {
    month: 'Mar 2027',
    historicalBaseline: 9800,
    forecastMean: 11500,
    forecastLower95: 7900,
    forecastUpper95: 15800,
    riskLevel: 'Elevated',
    confidence: 0.83
  },
  {
    month: 'Apr 2027',
    historicalBaseline: 6400,
    forecastMean: 6900,
    forecastLower95: 4800,
    forecastUpper95: 9300,
    riskLevel: 'Low',
    confidence: 0.89
  },
  {
    month: 'May 2027',
    historicalBaseline: 5100,
    forecastMean: 5300,
    forecastLower95: 3600,
    forecastUpper95: 7200,
    riskLevel: 'Low',
    confidence: 0.91
  }
];

export const SENSOR_STATS: SensorComparisonStats = {
  modisTotalHotspots: 142850,
  viirsTotalHotspots: 549300,
  harmonizedTotalHotspots: 482100,
  viirsToModisRatio: 3.84,
  meanModisFRP: 42.6,
  meanViirsFRP: 19.8,
  calibratedFRP: 24.3,
  footprintDistortionMax: 4.8,
  resolutionAdvantage: '375m I-Band vs 1000m M-Band'
};
