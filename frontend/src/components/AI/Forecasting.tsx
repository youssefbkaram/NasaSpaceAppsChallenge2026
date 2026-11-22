import React, { useState } from 'react';
import { Cpu, AlertTriangle, ShieldCheck, TrendingUp, Wind, Thermometer, Droplets, Flame, Sparkles } from 'lucide-react';
import { ForecastPeriod, RegionPreset } from '../../types/fire';
import { FORECAST_DATA } from '../../data/mockFireData';

interface ForecastingProps {
  selectedRegion: RegionPreset;
}

export const Forecasting: React.FC<ForecastingProps> = ({ selectedRegion }) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ForecastPeriod>(FORECAST_DATA[2]); // Peak Feb 2027

  // Environmental predictor features
  const environmentalDrivers = [
    {
      name: 'Vapor Pressure Deficit (VPD Anomaly)',
      source: 'NASA MERRA-2 Atmospheric Reanalysis',
      importance: 38,
      status: '+2.1 kPa above climatological norm',
      impact: 'High Risk (Atmospheric Aridity)',
      color: 'text-rose-400'
    },
    {
      name: 'Root-Zone Soil Moisture Deficit',
      source: 'NASA SMAP (Soil Moisture Active Passive)',
      importance: 27,
      status: '-34% root-zone moisture percentile',
      impact: 'High Risk (Vegetation Curing)',
      color: 'text-amber-400'
    },
    {
      name: 'Land Surface Temperature (LST Anomaly)',
      source: 'MODIS MOD11A2 / VIIRS VNP21',
      importance: 21,
      status: '+2.8 °C thermal anomaly',
      impact: 'Moderate Risk',
      color: 'text-orange-400'
    },
    {
      name: 'Combustible Fine Fuel Load Accumulation',
      source: 'Harmonized Fire Return Interval (HFRI)',
      importance: 14,
      status: '4.2 years since last catastrophic burn',
      impact: 'Fuel Available',
      color: 'text-cyan-400'
    }
  ];

  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 shadow-2xl space-y-6">
      
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-bold text-white tracking-tight">
              Future Fire Activity &amp; Climatological Risk Forecasting
            </h3>
            <span className="text-xs font-mono text-purple-400 bg-purple-950 px-2 py-0.5 rounded border border-purple-800/60">
              Bayesian Ensemble &amp; NASA Earthdata Covariates
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Probabilistic forward projections (6-month horizon) combining harmonized historical trends with environmental reanalysis variables.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
          <span>Active Forecast Model:</span>
          <span className="text-purple-300 font-semibold">Prophet + LightGBM Bayesian Hybrid</span>
        </div>
      </div>

      {/* Mandatory Scientific Accuracy Disclaimer */}
      <div className="bg-gradient-to-r from-purple-950/40 via-blue-950/30 to-slate-900/40 border border-purple-800/60 rounded-xl p-4 text-xs text-slate-300 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong className="text-purple-300 block mb-1">
            NASA Scientific Integrity &amp; Uncertainty Communication Standard:
          </strong>
          This model communicates estimated aggregate regional activity and statistical confidence intervals (±95% uncertainty envelope). It does <span className="text-white underline underline-offset-2">not</span> attempt or claim to predict deterministic ignition times or pinpoint coordinates, as lightning and human ignition triggers are inherently stochastic. Satellite hotspot detections reflect thermal radiation, not instantaneous discrete fire counts.
        </div>
      </div>

      {/* 6-Month Forecast Chart with 95% Confidence Envelope */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>6-Month Forward Projection (Dec 2026 – May 2027) with 95% Credible Bounds:</span>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-3 h-0.5 bg-slate-500 inline-block"></span> Climatological Normal
            </span>
            <span className="flex items-center gap-1.5 text-purple-400 font-semibold">
              <span className="w-3 h-1 bg-purple-500 inline-block"></span> Forecast Mean
            </span>
            <span className="flex items-center gap-1.5 text-purple-300">
              <span className="w-3 h-2 bg-purple-900/40 border border-purple-500/50 inline-block"></span> 95% Confidence Interval
            </span>
          </div>
        </div>

        {/* SVG Forecast Visualization */}
        <div className="w-full h-72 bg-slate-900/50 rounded-xl border border-slate-800/80 p-4 relative flex flex-col justify-end">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 1000 240" preserveAspectRatio="none">
            {/* Grid */}
            {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => (
              <line
                key={idx}
                x1="0"
                y1={210 * (1 - ratio) + 10}
                x2="1000"
                y2={210 * (1 - ratio) + 10}
                stroke="#334155"
                strokeWidth="0.8"
                strokeDasharray="4 4"
              />
            ))}

            {/* 95% Uncertainty Shaded Area */}
            {(() => {
              const maxVal = 28000;
              const step = 1000 / (FORECAST_DATA.length - 1);
              const upper = FORECAST_DATA.map((f, i) => `${i * step},${220 - (f.forecastUpper95 / maxVal) * 200}`);
              const lower = [...FORECAST_DATA].reverse().map((f, i) => `${(FORECAST_DATA.length - 1 - i) * step},${220 - (f.forecastLower95 / maxVal) * 200}`);
              return (
                <polygon
                  points={[...upper, ...lower].join(' ')}
                  fill="#7c3aed"
                  opacity="0.2"
                  stroke="#a855f7"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              );
            })()}

            {/* Historical Baseline Curve */}
            {(() => {
              const maxVal = 28000;
              const step = 1000 / (FORECAST_DATA.length - 1);
              const points = FORECAST_DATA.map((f, i) => `${i * step},${220 - (f.historicalBaseline / maxVal) * 200}`).join(' ');
              return (
                <polyline
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  points={points}
                />
              );
            })()}

            {/* Forecast Mean Line */}
            {(() => {
              const maxVal = 28000;
              const step = 1000 / (FORECAST_DATA.length - 1);
              const points = FORECAST_DATA.map((f, i) => `${i * step},${220 - (f.forecastMean / maxVal) * 200}`).join(' ');
              return (
                <polyline
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth="3"
                  points={points}
                />
              );
            })()}

            {/* Data Circles */}
            {FORECAST_DATA.map((f, i) => {
              const maxVal = 28000;
              const step = 1000 / (FORECAST_DATA.length - 1);
              const cx = i * step;
              const cy = 220 - (f.forecastMean / maxVal) * 200;

              return (
                <g key={i} className="cursor-pointer" onClick={() => setSelectedPeriod(f)}>
                  <circle cx={cx} cy={cy} r="5" fill="#a855f7" stroke="#ffffff" strokeWidth="2" />
                </g>
              );
            })}
          </svg>

          {/* X Axis Labels */}
          <div className="flex justify-between pt-3 border-t border-slate-800 text-xs font-mono text-slate-300">
            {FORECAST_DATA.map((f) => (
              <button
                key={f.month}
                onClick={() => setSelectedPeriod(f)}
                className={`text-center font-medium transition cursor-pointer ${
                  selectedPeriod.month === f.month ? 'text-purple-300 font-bold underline' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.month}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selected Period Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 block mb-1">Target Period</span>
          <span className="text-base font-bold font-mono text-white">{selectedPeriod.month}</span>
          <span className="text-[11px] text-slate-400 block mt-1">Projection Horizon</span>
        </div>

        <div className="bg-slate-900/70 p-3.5 rounded-xl border border-purple-900/60">
          <span className="text-[10px] text-purple-400 block mb-1">Estimated Fire Activity (Mean)</span>
          <span className="text-base font-bold font-mono text-purple-300">
            {selectedPeriod.forecastMean.toLocaleString()}
          </span>
          <span className="text-[11px] text-purple-400/80 block mt-1">
            Baseline: {selectedPeriod.historicalBaseline.toLocaleString()}
          </span>
        </div>

        <div className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 block mb-1">95% Credible Interval</span>
          <span className="text-sm font-bold font-mono text-slate-200">
            {selectedPeriod.forecastLower95.toLocaleString()} – {selectedPeriod.forecastUpper95.toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-500 block mt-1">Bayesian Uncertainty Envelope</span>
        </div>

        <div className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 block mb-1">Regional Hazard Level</span>
          <span className={`text-base font-bold font-mono ${
            selectedPeriod.riskLevel === 'Extreme'
              ? 'text-rose-400'
              : selectedPeriod.riskLevel === 'Elevated'
              ? 'text-amber-400'
              : 'text-emerald-400'
          }`}>
            {selectedPeriod.riskLevel} Risk
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">
            Model Confidence: {(selectedPeriod.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Environmental Predictor Feature Importances */}
      <div>
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-purple-400" />
          NASA Earthdata Environmental Covariates (Model Weights)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {environmentalDrivers.map((driver) => (
            <div key={driver.name} className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-slate-200">{driver.name}</span>
                <span className="font-mono text-purple-400 font-bold">{driver.importance}% weight</span>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mb-2">
                <div
                  style={{ width: `${driver.importance}%` }}
                  className="bg-purple-500 h-full rounded-full"
                ></div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono text-slate-500">{driver.source}</span>
                <span className={driver.color}>{driver.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
