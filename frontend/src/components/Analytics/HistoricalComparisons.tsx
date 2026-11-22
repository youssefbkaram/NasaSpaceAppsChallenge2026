import React, { useState } from 'react';
import { TrendingUp, Layers, Calendar, BarChart3, Globe2, Activity } from 'lucide-react';
import { MonthlyFireMetric, RegionPreset, SensorType } from '../../types/fire';
import { REGION_PRESETS } from '../../data/regionPresets';

interface HistoricalComparisonsProps {
  data: MonthlyFireMetric[];
  selectedRegion: RegionPreset;
  selectedSensor: SensorType;
}

export const HistoricalComparisons: React.FC<HistoricalComparisonsProps> = ({
  data,
  selectedRegion
}) => {
  const [comparisonMode, setComparisonMode] = useState<'years' | 'seasonal' | 'regions'>('seasonal');
  const [selectedYears, setSelectedYears] = useState<number[]>([2019, 2020, 2023, 2024]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const allYears = Array.from(new Set(data.map(d => d.year))).sort((a, b) => b - a);

  // Compute 20-year monthly climatological baseline (mean and std dev)
  const monthlyClimatology = months.map((monthName, idx) => {
    const monthIndex = idx + 1;
    const monthData = data.filter(d => d.month === monthIndex);
    const harmonizedVals = monthData.map(d => d.harmonizedIndex);
    const modisVals = monthData.map(d => d.modisCount);
    const viirsVals = monthData.filter(d => d.year >= 2012).map(d => d.viirsCount);

    const mean = harmonizedVals.reduce((a, b) => a + b, 0) / (harmonizedVals.length || 1);
    const modisMean = modisVals.reduce((a, b) => a + b, 0) / (modisVals.length || 1);
    const viirsMean = viirsVals.reduce((a, b) => a + b, 0) / (viirsVals.length || 1);

    const variance = harmonizedVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (harmonizedVals.length || 1);
    const stdDev = Math.sqrt(variance);

    return {
      monthIndex,
      monthName,
      mean: Math.round(mean),
      modisMean: Math.round(modisMean),
      viirsMean: Math.round(viirsMean),
      upper1Sigma: Math.round(mean + stdDev),
      lower1Sigma: Math.max(0, Math.round(mean - stdDev)),
      upper2Sigma: Math.round(mean + 2 * stdDev),
      lower2Sigma: Math.max(0, Math.round(mean - 2 * stdDev)),
      maxRecorded: Math.max(...harmonizedVals, 0)
    };
  });

  const maxChartValue = Math.max(
    ...monthlyClimatology.map(m => m.upper2Sigma * 1.3),
    ...data.filter(d => selectedYears.includes(d.year)).map(d => d.harmonizedIndex)
  );

  const colors = ['#38bdf8', '#f59e0b', '#ec4899', '#10b981', '#a855f7'];

  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 shadow-2xl space-y-6">
      
      {/* Header and Mode Selector */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-bold text-white tracking-tight">
              Historical Fire Activity &amp; Climatology Comparisons
            </h3>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800/60">
              Harmonized Baseline
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Compare seasonal profiles, multi-year extreme events, and cross-regional biomass burning cycles.
          </p>
        </div>

        {/* View Mode Buttons */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
          <button
            onClick={() => setComparisonMode('seasonal')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              comparisonMode === 'seasonal'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Seasonal Climatology Envelope
          </button>
          <button
            onClick={() => setComparisonMode('years')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              comparisonMode === 'years'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Multi-Year Overlay
          </button>
          <button
            onClick={() => setComparisonMode('regions')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              comparisonMode === 'regions'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cross-Regional Regimes
          </button>
        </div>
      </div>

      {/* MODE 1: Seasonal Climatology Envelope */}
      {comparisonMode === 'seasonal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing 2000–2026 Climatological Mean with <span className="text-cyan-400 font-semibold">±1σ (68%)</span> and <span className="text-slate-500 font-semibold">±2σ (95%)</span> deviation bands:
            </span>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-cyan-300">
                <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span> Mean Baseline
              </span>
              <span className="flex items-center gap-1.5 text-emerald-300">
                <span className="w-3 h-2 bg-emerald-900/40 border border-emerald-500/40 inline-block"></span> Normal Range (±1σ)
              </span>
            </div>
          </div>

          {/* SVG Seasonal Envelope Visualization */}
          <div className="w-full h-80 bg-slate-900/50 rounded-xl border border-slate-800/80 p-4 relative flex flex-col justify-end">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 1100 280" preserveAspectRatio="none">
              <defs>
                <linearGradient id="envelopeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => (
                <line
                  key={idx}
                  x1="0"
                  y1={260 * (1 - ratio) + 10}
                  x2="1100"
                  y2={260 * (1 - ratio) + 10}
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeDasharray="4 4"
                />
              ))}

              {/* ±2 Sigma Polygon */}
              {(() => {
                const step = 1100 / 11;
                const upperPoints = monthlyClimatology.map((m, i) => `${i * step},${270 - (m.upper2Sigma / maxChartValue) * 250}`);
                const lowerPoints = [...monthlyClimatology].reverse().map((m, i) => `${(11 - i) * step},${270 - (m.lower2Sigma / maxChartValue) * 250}`);
                return (
                  <polygon
                    points={[...upperPoints, ...lowerPoints].join(' ')}
                    fill="#1e293b"
                    opacity="0.4"
                  />
                );
              })()}

              {/* ±1 Sigma Polygon */}
              {(() => {
                const step = 1100 / 11;
                const upperPoints = monthlyClimatology.map((m, i) => `${i * step},${270 - (m.upper1Sigma / maxChartValue) * 250}`);
                const lowerPoints = [...monthlyClimatology].reverse().map((m, i) => `${(11 - i) * step},${270 - (m.lower1Sigma / maxChartValue) * 250}`);
                return (
                  <polygon
                    points={[...upperPoints, ...lowerPoints].join(' ')}
                    fill="url(#envelopeGrad)"
                    stroke="#0891b2"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                );
              })()}

              {/* Mean Baseline Line */}
              {(() => {
                const step = 1100 / 11;
                const points = monthlyClimatology.map((m, i) => `${i * step},${270 - (m.mean / maxChartValue) * 250}`).join(' ');
                return (
                  <polyline
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="3"
                    points={points}
                  />
                );
              })()}

              {/* Selected Recent Year (e.g., 2024) Overlay Line */}
              {(() => {
                const step = 1100 / 11;
                const year2024 = data.filter(d => d.year === 2024).sort((a, b) => a.month - b.month);
                if (year2024.length === 12) {
                  const points = year2024.map((m, i) => `${i * step},${270 - (m.harmonizedIndex / maxChartValue) * 250}`).join(' ');
                  return (
                    <polyline
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      strokeDasharray="5 3"
                      points={points}
                    />
                  );
                }
                return null;
              })()}

              {/* Points for Mean */}
              {monthlyClimatology.map((m, i) => {
                const step = 1100 / 11;
                const cx = i * step;
                const cy = 270 - (m.mean / maxChartValue) * 250;
                return (
                  <g key={i}>
                    <circle cx={cx} cy={cy} r="4" fill="#0891b2" stroke="#ffffff" strokeWidth="1.5" />
                  </g>
                );
              })}
            </svg>

            {/* X-Axis Month Labels */}
            <div className="flex justify-between pt-3 border-t border-slate-800 text-xs font-mono text-slate-400">
              {months.map(m => (
                <div key={m} className="text-center w-12">{m}</div>
              ))}
            </div>
          </div>

          {/* Climatological Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Peak Climatological Month</span>
              <span className="text-sm font-bold text-cyan-300 font-mono">
                {monthlyClimatology.reduce((max, m) => m.mean > max.mean ? m : max).monthName}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Highest recurrent historical fire density driven by seasonal dry vegetation curing.
              </p>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Seasonal Dynamic Range</span>
              <span className="text-sm font-bold text-amber-300 font-mono">
                {(Math.max(...monthlyClimatology.map(m => m.mean)) / Math.max(1, Math.min(...monthlyClimatology.map(m => m.mean)))).toFixed(1)}× Variation
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Ratio between peak fire season activity and wet season background activity.
              </p>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Sensor Cross-Calibration Gap</span>
              <span className="text-sm font-bold text-emerald-300 font-mono">
                VIIRS detects 3.84× more spots
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Harmonization aligns MODIS (2000-2011) and VIIRS (2012+) to the same continuous baseline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: Multi-Year Overlay */}
      {comparisonMode === 'years' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">Select historical years to overlay against each other:</span>
            <div className="flex flex-wrap gap-1.5">
              {[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(yr => {
                const isSelected = selectedYears.includes(yr);
                return (
                  <button
                    key={yr}
                    onClick={() => {
                      if (isSelected) {
                        if (selectedYears.length > 1) setSelectedYears(selectedYears.filter(y => y !== yr));
                      } else {
                        setSelectedYears([...selectedYears, yr]);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {yr}
                  </button>
                );
              })}
            </div>
          </div>

          {/* SVG Multi-Line Chart */}
          <div className="w-full h-80 bg-slate-900/50 rounded-xl border border-slate-800/80 p-4 relative flex flex-col justify-end">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 1100 280" preserveAspectRatio="none">
              {/* Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => (
                <line
                  key={idx}
                  x1="0"
                  y1={260 * (1 - ratio) + 10}
                  x2="1100"
                  y2={260 * (1 - ratio) + 10}
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Year Lines */}
              {selectedYears.map((yr, yrIdx) => {
                const yrData = data.filter(d => d.year === yr).sort((a, b) => a.month - b.month);
                const step = 1100 / 11;
                const points = yrData.map((m, i) => `${i * step},${270 - (m.harmonizedIndex / maxChartValue) * 250}`).join(' ');
                const color = colors[yrIdx % colors.length];

                return (
                  <g key={yr}>
                    <polyline
                      fill="none"
                      stroke={color}
                      strokeWidth="2.5"
                      points={points}
                    />
                    {yrData.map((m, i) => (
                      <circle
                        key={i}
                        cx={i * step}
                        cy={270 - (m.harmonizedIndex / maxChartValue) * 250}
                        r="3.5"
                        fill={color}
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {/* X-Axis */}
            <div className="flex justify-between pt-3 border-t border-slate-800 text-xs font-mono text-slate-400">
              {months.map(m => (
                <div key={m} className="text-center w-12">{m}</div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            {selectedYears.map((yr, idx) => (
              <div key={yr} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }}></span>
                <span className="text-slate-200">{yr} Fire Season</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODE 3: Cross-Regional Regimes */}
      {comparisonMode === 'regions' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {REGION_PRESETS.map((region) => {
            const isCurrent = region.id === selectedRegion.id;
            return (
              <div
                key={region.id}
                className={`p-4 rounded-xl border transition-all ${
                  isCurrent
                    ? 'bg-cyan-950/30 border-cyan-500/60 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/20'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Globe2 className="w-4 h-4 text-cyan-400" />
                    {region.name}
                  </h4>
                  {isCurrent && (
                    <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                      Active
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mb-2">
                  <span className="font-semibold text-slate-300">Biome:</span> {region.biome}
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 text-xs text-slate-300">
                  <span className="text-[10px] text-cyan-400 font-semibold block mb-0.5">Fire Regime &amp; Peak Timing:</span>
                  {region.fireRegime}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
