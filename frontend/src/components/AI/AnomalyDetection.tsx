import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, Sliders, Activity, Flame, Wind, Thermometer, Droplets, Sparkles, CheckCircle2 } from 'lucide-react';
import { MonthlyFireMetric, AnomalyEvent, RegionPreset } from '../../types/fire';
import { ANOMALY_EVENTS } from '../../data/mockFireData';

interface AnomalyDetectionProps {
  data: MonthlyFireMetric[];
  selectedRegion: RegionPreset;
}

export const AnomalyDetection: React.FC<AnomalyDetectionProps> = ({
  data,
  selectedRegion
}) => {
  const [zThreshold, setZThreshold] = useState<number>(2.5);
  const [activeAnomaly, setActiveAnomaly] = useState<AnomalyEvent | null>(ANOMALY_EVENTS[0]);
  const [decompositionView, setDecompositionView] = useState<'anomaly' | 'stl'>('anomaly');

  // Filter detected anomalies by threshold
  const anomaliesInTimeline = data.filter(d => d.anomalyScore >= zThreshold);

  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 shadow-2xl space-y-6">
      
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-500 animate-pulse" />
            <h3 className="text-lg font-bold text-white tracking-tight">
              AI Fire Anomaly Detection &amp; Seasonality Decomposition
            </h3>
            <span className="text-xs font-mono text-rose-400 bg-rose-950 px-2 py-0.5 rounded border border-rose-800/60">
              Isolation Forest &amp; Climatological Z-Score
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Detects statistically anomalous fire outbreaks exceeding expected seasonal baselines, correlated with NASA Earthdata atmospheric drivers.
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
          <button
            onClick={() => setDecompositionView('anomaly')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              decompositionView === 'anomaly'
                ? 'bg-rose-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Anomaly Timeline &amp; Events
          </button>
          <button
            onClick={() => setDecompositionView('stl')}
            className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              decompositionView === 'stl'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            STL Seasonal Decomposition
          </button>
        </div>
      </div>

      {decompositionView === 'anomaly' ? (
        <>
          {/* Sensitivity Threshold Slider */}
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sliders className="w-5 h-5 text-rose-400" />
              <div>
                <span className="text-xs font-bold text-white block">
                  Statistical Anomaly Threshold (Z-Score):
                </span>
                <span className="text-[11px] text-slate-400">
                  Standard deviations above 20-year climatological monthly mean
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 w-full md:w-72">
              <input
                type="range"
                min="1.5"
                max="4.5"
                step="0.1"
                value={zThreshold}
                onChange={(e) => setZThreshold(parseFloat(e.target.value))}
                className="w-full accent-rose-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className="font-mono text-rose-400 font-bold text-sm min-w-12 text-right">
                {zThreshold.toFixed(1)}σ
              </span>
            </div>

            <div className="text-xs font-mono text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              <strong className="text-rose-400">{anomaliesInTimeline.length}</strong> Outbreak Months Detected
            </div>
          </div>

          {/* Anomaly Timeline Spark-Visualization */}
          <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>Timeline Hotspot Activity with Detected Anomaly Peaks:</span>
              <span className="font-mono text-rose-400">● Red Dots = Z &gt; {zThreshold.toFixed(1)}σ</span>
            </div>

            {/* SVG Timeline with Outliers */}
            <div className="w-full h-48 relative flex items-end">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 1200 160" preserveAspectRatio="none">
                {/* Baseline threshold line */}
                <line x1="0" y1={140 - zThreshold * 22} x2="1200" y2={140 - zThreshold * 22} stroke="#f43f5e" strokeWidth="1" strokeDasharray="3 3" />
                <text x="10" y={135 - zThreshold * 22} fill="#f43f5e" fontSize="10" fontFamily="monospace">
                  Threshold: +{zThreshold.toFixed(1)}σ
                </text>

                {/* Harmonized Series Path */}
                {(() => {
                  const step = 1200 / data.length;
                  const points = data.map((d, i) => `${i * step},${140 - Math.min(130, Math.max(0, d.anomalyScore * 22))}`).join(' ');
                  return (
                    <polyline
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="1.8"
                      opacity="0.85"
                      points={points}
                    />
                  );
                })()}

                {/* Anomaly Highlight Circles */}
                {data.map((d, i) => {
                  if (d.anomalyScore < zThreshold) return null;
                  const step = 1200 / data.length;
                  const cx = i * step;
                  const cy = 140 - Math.min(130, d.anomalyScore * 22);

                  return (
                    <g key={i}>
                      <circle cx={cx} cy={cy} r="5" fill="#f43f5e" stroke="#ffffff" strokeWidth="1.5" className="animate-pulse" />
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="flex justify-between pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
              <span>2000</span>
              <span>2005</span>
              <span>2010</span>
              <span>2015</span>
              <span>2020</span>
              <span>2026</span>
            </div>
          </div>

          {/* Detailed Anomaly Cards */}
          <div>
            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-400" />
              Documented Extreme Outbreak Case Studies
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ANOMALY_EVENTS.map((event) => {
                const isSelected = activeAnomaly?.id === event.id;
                return (
                  <div
                    key={event.id}
                    onClick={() => setActiveAnomaly(event)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-950/30 border-rose-500/70 shadow-lg shadow-rose-950/50 ring-1 ring-rose-500/30'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-200">
                            {event.date}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            event.severity === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}>
                            {event.severity}
                          </span>
                        </div>
                        <h5 className="text-sm font-bold text-white mt-1">{event.region}</h5>
                      </div>
                      <span className="text-sm font-mono font-bold text-rose-400 bg-rose-950/80 px-2.5 py-1 rounded-lg border border-rose-800">
                        +{event.zScore}σ
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] mb-3 bg-slate-950 p-2 rounded-lg border border-slate-800/80 font-mono">
                      <div>
                        <span className="text-[9px] text-slate-500 block">Observed:</span>
                        <span className="text-slate-200 font-bold">{event.observedActivity.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">Normal:</span>
                        <span className="text-slate-400">{event.baselineActivity.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">Surge:</span>
                        <span className="text-rose-400 font-bold">+{event.percentAboveNormal.toFixed(0)}%</span>
                      </div>
                    </div>

                    {/* Atmospheric Environmental Drivers */}
                    <div className="space-y-1 text-[11px] text-slate-300 mb-3 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex items-center gap-2 text-cyan-300">
                        <Wind className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                        <span>{event.environmentalDrivers.vpdAnomaly}</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-300">
                        <Thermometer className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        <span>{event.environmentalDrivers.tempAnomaly}</span>
                      </div>
                      <div className="flex items-center gap-2 text-rose-300">
                        <Droplets className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                        <span>{event.environmentalDrivers.droughtIndex}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed italic">
                      "{event.scientificNote}"
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* STL Seasonal Decomposition View */
        <div className="space-y-4">
          <div className="text-xs text-slate-400">
            Decomposed Time Series: <span className="text-cyan-400 font-mono font-bold">Y[t] = Trend[t] + Seasonal[t] + Residual[t]</span>
          </div>

          <div className="space-y-3">
            {/* Component 1: Trend */}
            <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-cyan-300">1. Long-Term Climatological Trend (Climate Warming &amp; Land-Use)</span>
                <span className="font-mono text-[10px] text-slate-400">LOESS Filter (36-Month Window)</span>
              </div>
              <div className="h-16 w-full flex items-center">
                <svg className="w-full h-full" viewBox="0 0 1000 60" preserveAspectRatio="none">
                  <path d="M 0,45 Q 300,42 500,32 T 1000,15" fill="none" stroke="#22d3ee" strokeWidth="2.5" />
                </svg>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Persistent upward drift (+18.4% since 2000) reflecting prolonged drought vulnerability and extended fire season length.
              </p>
            </div>

            {/* Component 2: Seasonal Harmonic */}
            <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-emerald-300">2. Periodic Seasonal Cycle (Annual Dry Season Ignition)</span>
                <span className="font-mono text-[10px] text-slate-400">12-Month Harmonic Fourier Fit</span>
              </div>
              <div className="h-16 w-full flex items-center">
                <svg className="w-full h-full" viewBox="0 0 1000 60" preserveAspectRatio="none">
                  <path
                    d="M 0,50 Q 50,5 100,50 T 200,50 T 300,50 T 400,50 T 500,50 T 600,50 T 700,50 T 800,50 T 900,50 T 1000,50"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Deterministic annual biomass cycle accounting for 74% of total time series variance.
              </p>
            </div>

            {/* Component 3: Residual / Anomalies */}
            <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-rose-400">3. Stochastic Residual &amp; Extreme Outbreaks (Anomalies)</span>
                <span className="font-mono text-[10px] text-rose-400 font-bold">Unmodeled High-Impact Peaks</span>
              </div>
              <div className="h-16 w-full flex items-center">
                <svg className="w-full h-full" viewBox="0 0 1000 60" preserveAspectRatio="none">
                  <line x1="0" y1="40" x2="1000" y2="40" stroke="#475569" strokeWidth="1" strokeDasharray="2 2" />
                  <path
                    d="M 0,40 L 200,40 L 250,42 L 350,38 L 400,10 L 450,40 L 680,40 L 720,5 L 760,40 L 850,38 L 920,8 L 960,40 L 1000,40"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Isolated spikes represent megadrought and windstorm outbreaks such as the 2019/2020 events.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
