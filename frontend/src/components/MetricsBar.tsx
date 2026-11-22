import React from 'react';
import { Flame, ShieldAlert, Cpu, Layers, TrendingUp } from 'lucide-react';
import { SensorComparisonStats } from '../types/fire';

interface MetricsBarProps {
  stats: SensorComparisonStats;
  selectedSensor: string;
}

export const MetricsBar: React.FC<MetricsBarProps> = ({ stats, selectedSensor }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
      {/* Metric 1: MODIS Raw Count */}
      <div className={`p-3 rounded-xl border backdrop-blur-md transition-all ${
        selectedSensor === 'MODIS'
          ? 'bg-amber-950/30 border-amber-500/50 shadow-md shadow-amber-950/30'
          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
      }`}>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Raw MODIS
          </span>
          <span className="text-[10px] font-mono text-amber-400/90 bg-amber-950/80 px-1.5 py-0.5 rounded">
            1000m
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-slate-100">
          {stats.modisTotalHotspots.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Mean FRP:</span>
          <span className="font-mono text-amber-300 font-semibold">{stats.meanModisFRP} MW</span>
        </div>
      </div>

      {/* Metric 2: VIIRS Raw Count */}
      <div className={`p-3 rounded-xl border backdrop-blur-md transition-all ${
        selectedSensor === 'VIIRS'
          ? 'bg-emerald-950/30 border-emerald-500/50 shadow-md shadow-emerald-950/30'
          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
      }`}>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Raw VIIRS
          </span>
          <span className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/80 px-1.5 py-0.5 rounded">
            375m I-Band
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-slate-100">
          {stats.viirsTotalHotspots.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Detection Ratio:</span>
          <span className="font-mono text-emerald-300 font-semibold">{stats.viirsToModisRatio}× MODIS</span>
        </div>
      </div>

      {/* Metric 3: Harmonized Equivalent Index */}
      <div className={`p-3 rounded-xl border backdrop-blur-md transition-all ${
        selectedSensor === 'HARMONIZED'
          ? 'bg-cyan-950/40 border-cyan-400/60 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
      }`}>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium text-cyan-300">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Harmonized HEFAI
          </span>
          <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800/60">
            Unified
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-cyan-200">
          {stats.harmonizedTotalHotspots.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Continuous:</span>
          <span className="text-cyan-400 font-medium font-mono">2000 – 2026</span>
        </div>
      </div>

      {/* Metric 4: Cross-Sensor Footprint Distortion */}
      <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            Swath Distortion
          </span>
          <span className="text-[10px] font-mono text-purple-400/90 bg-purple-950/80 px-1.5 py-0.5 rounded">
            Bow-Tie
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-slate-100 flex items-baseline gap-1">
          {stats.footprintDistortionMax}× <span className="text-xs text-slate-400 font-normal">area growth</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Swath Edge:</span>
          <span className="text-purple-300 font-mono">Corrected</span>
        </div>
      </div>

      {/* Metric 5: Calibrated Fire Radiative Power */}
      <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            Calibrated FRP
          </span>
          <span className="text-[10px] font-mono text-orange-400/90 bg-orange-950/80 px-1.5 py-0.5 rounded">
            Energy
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-slate-100 flex items-baseline gap-1">
          {stats.calibratedFRP} <span className="text-xs text-slate-400 font-normal">MW / pix</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Cross-calibrated:</span>
          <span className="text-orange-300 font-mono">R² = 0.94</span>
        </div>
      </div>

      {/* Metric 6: Climate Anomalies Detected */}
      <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium text-rose-300">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            AI Anomaly Flags
          </span>
          <span className="text-[10px] font-mono text-rose-400 bg-rose-950 px-1.5 py-0.5 rounded border border-rose-800/60">
            Z &gt; 2.5σ
          </span>
        </div>
        <div className="text-xl font-bold font-mono text-rose-300 flex items-baseline gap-1">
          4 <span className="text-xs text-slate-400 font-normal">extreme surge events</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Climate Drivers:</span>
          <span className="text-rose-400 font-medium font-mono">VPD &amp; Drought</span>
        </div>
      </div>
    </div>
  );
};
