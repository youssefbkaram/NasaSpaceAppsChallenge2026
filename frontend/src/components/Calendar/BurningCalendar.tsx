import React, { useState } from 'react';
import { Calendar as CalendarIcon, Info, Flame, AlertTriangle, Layers, TrendingUp } from 'lucide-react';
import { MonthlyFireMetric, SensorType } from '../../types/fire';

interface BurningCalendarProps {
  data: MonthlyFireMetric[];
  selectedSensor: SensorType;
  onSelectCell?: (cell: MonthlyFireMetric) => void;
}

export const BurningCalendar: React.FC<BurningCalendarProps> = ({
  data,
  selectedSensor
}) => {
  const [selectedCell, setSelectedCell] = useState<MonthlyFireMetric | null>(null);
  const [displayMode, setDisplayMode] = useState<'harmonized' | 'modis' | 'viirs' | 'frp' | 'anomaly'>('harmonized');

  const years = Array.from(new Set(data.map(d => d.year))).sort((a, b) => a - b);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Calculate min & max values for color scaling based on display mode
  const getCellValue = (item: MonthlyFireMetric) => {
    switch (displayMode) {
      case 'modis':
        return item.modisCount;
      case 'viirs':
        return item.viirsCount;
      case 'frp':
        return item.harmonizedFRP;
      case 'anomaly':
        return Math.max(0, item.anomalyScore);
      case 'harmonized':
      default:
        return item.harmonizedIndex;
    }
  };

  const values = data.map(getCellValue);
  const maxValue = Math.max(...values, 1);

  // Return heat color based on normalized intensity
  const getHeatColor = (value: number, item: MonthlyFireMetric) => {
    // If VIIRS selected and prior to 2012, show distinctive hatch/gray for pre-launch
    if (displayMode === 'viirs' && item.year < 2012) {
      return 'bg-slate-900/40 border-slate-800/40 text-slate-600';
    }

    if (value === 0) return 'bg-slate-900/60 border-slate-800 text-slate-500';

    const ratio = Math.min(1, Math.max(0, value / maxValue));

    if (displayMode === 'anomaly') {
      if (item.anomalyScore >= 3.5) return 'bg-rose-600 text-white font-bold ring-2 ring-rose-400';
      if (item.anomalyScore >= 2.5) return 'bg-rose-700/80 text-rose-100 font-semibold';
      if (item.anomalyScore >= 2.0) return 'bg-amber-600/80 text-amber-100';
      if (item.anomalyScore >= 1.0) return 'bg-amber-900/50 text-amber-300';
      return 'bg-slate-900/80 text-slate-400';
    }

    // Heat gradient: Cool Blue/Slate -> Warm Amber -> Vivid Orange -> Intense Crimson
    if (ratio > 0.85) return 'bg-gradient-to-br from-orange-500 to-rose-600 text-white font-bold shadow-sm shadow-orange-900/50';
    if (ratio > 0.65) return 'bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 font-semibold';
    if (ratio > 0.45) return 'bg-amber-600/80 text-white font-medium';
    if (ratio > 0.25) return 'bg-amber-800/60 text-amber-100';
    if (ratio > 0.10) return 'bg-amber-950/70 text-amber-300';
    if (ratio > 0.03) return 'bg-slate-800/90 text-slate-300';
    return 'bg-slate-900/80 text-slate-500';
  };

  // Group metrics by year
  const dataByYear = years.reduce((acc, yr) => {
    acc[yr] = data.filter(d => d.year === yr).sort((a, b) => a.month - b.month);
    return acc;
  }, {} as Record<number, MonthlyFireMetric[]>);

  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 shadow-2xl space-y-4">
      
      {/* Calendar Header & Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white tracking-tight">
              Burning Activity Calendar (2000–2026)
            </h3>
            <span className="text-xs font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800/60">
              27-Year Climatological Matrix
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Visualizing year-by-month hotspot distribution. Notice the seamless historical continuity provided by harmonization compared to raw sensor jumps.
          </p>
        </div>

        {/* Display Metric Selector */}
        <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-1 text-xs">
          <button
            onClick={() => setDisplayMode('harmonized')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              displayMode === 'harmonized'
                ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Harmonized HEFAI
          </button>
          <button
            onClick={() => setDisplayMode('modis')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              displayMode === 'modis'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw MODIS
          </button>
          <button
            onClick={() => setDisplayMode('viirs')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              displayMode === 'viirs'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw VIIRS
          </button>
          <button
            onClick={() => setDisplayMode('frp')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              displayMode === 'frp'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Total FRP (MW)
          </button>
          <button
            onClick={() => setDisplayMode('anomaly')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              displayMode === 'anomaly'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Z-Score Anomaly
          </button>
        </div>
      </div>

      {/* Scientific Comparison Banner */}
      {displayMode === 'viirs' && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 p-3 rounded-xl text-xs text-emerald-200 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-emerald-300">Sensor Launch Demonstration:</span>
            {' '}Notice that the Raw VIIRS matrix is blank from 2000–2011 because VIIRS (Suomi-NPP) was launched in late 2011. This illustrates the critical scientific need for harmonization: without it, a historical analysis falsely implies zero fire activity in the 2000s!
          </div>
        </div>
      )}

      {/* Matrix Table */}
      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          {/* Header Row: Month Labels */}
          <div className="grid grid-cols-14 gap-1.5 pb-2 border-b border-slate-800 text-[11px] font-mono text-slate-400 text-center">
            <div className="text-left font-bold text-slate-300">Year</div>
            {months.map(m => (
              <div key={m} className="font-semibold">{m}</div>
            ))}
            <div className="font-bold text-cyan-400">Annual Total</div>
          </div>

          {/* Calendar Rows (Years 2000 to 2026) */}
          <div className="space-y-1 mt-2">
            {years.map(yr => {
              const yearMetrics = dataByYear[yr] || [];
              const annualTotal = yearMetrics.reduce((sum, item) => sum + getCellValue(item), 0);
              const hasAnomaly = yearMetrics.some(m => m.isAnomaly);

              return (
                <div key={yr} className="grid grid-cols-14 gap-1.5 items-center">
                  {/* Year Label */}
                  <div className="text-[11px] font-mono font-medium text-slate-300 flex items-center gap-1">
                    <span>{yr}</span>
                    {hasAnomaly && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" title="Contains climate anomaly event"></span>
                    )}
                  </div>

                  {/* 12 Month Cells */}
                  {yearMetrics.map((cell) => {
                    const val = getCellValue(cell);
                    const heatClass = getHeatColor(val, cell);
                    const isSelected = selectedCell?.year === cell.year && selectedCell?.month === cell.month;

                    return (
                      <button
                        key={`${cell.year}-${cell.month}`}
                        onClick={() => setSelectedCell(cell)}
                        className={`h-7 rounded text-[10px] font-mono flex items-center justify-center transition-all cursor-pointer relative border border-transparent ${heatClass} ${
                          isSelected ? 'ring-2 ring-cyan-400 scale-105 z-10' : 'hover:scale-105 hover:border-slate-400'
                        }`}
                        title={`${cell.monthName} ${cell.year}: ${val.toLocaleString()} (${displayMode.toUpperCase()})`}
                      >
                        {val > 0 ? (val > 9999 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)) : (displayMode === 'viirs' && cell.year < 2012 ? '—' : '0')}
                        {cell.isAnomaly && (
                          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                        )}
                      </button>
                    );
                  })}

                  {/* Annual Total Column */}
                  <div className="text-[10px] font-mono font-semibold text-right text-slate-300 pr-1">
                    {annualTotal > 0 ? (annualTotal > 9999 ? `${(annualTotal / 1000).toFixed(0)}k` : annualTotal) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Month Deep-Dive Inspector Card */}
      {selectedCell && (
        <div className="mt-4 p-4 rounded-xl border border-cyan-800 bg-slate-900/90 backdrop-blur-md shadow-xl animate-in fade-in">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                {selectedCell.monthName} {selectedCell.year}
              </span>
              <h4 className="text-sm font-bold text-white">Monthly Fire Activity Breakdown</h4>
              {selectedCell.isAnomaly && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800">
                  <AlertTriangle className="w-3 h-3" />
                  Anomaly Alert ({selectedCell.anomalySeverity?.toUpperCase()})
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Close ✕
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">MODIS Raw Hotspots</span>
              <span className="font-mono text-amber-400 font-bold text-base">
                {selectedCell.modisCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                FRP: {selectedCell.modisFRP.toLocaleString()} MW
              </span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">VIIRS Raw Hotspots</span>
              <span className="font-mono text-emerald-400 font-bold text-base">
                {selectedCell.year < 2012 ? 'Pre-Launch (0)' : selectedCell.viirsCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                {selectedCell.year < 2012 ? 'Pre-VIIRS Era' : `FRP: ${selectedCell.viirsFRP.toLocaleString()} MW`}
              </span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-cyan-900/60">
              <span className="text-[10px] text-cyan-400 block mb-0.5">Harmonized Activity</span>
              <span className="font-mono text-cyan-300 font-bold text-base">
                {selectedCell.harmonizedIndex.toLocaleString()}
              </span>
              <span className="text-[10px] text-cyan-400/80 block mt-0.5 font-mono">
                {selectedCell.uncertaintyLower && selectedCell.uncertaintyUpper
                  ? `95% CI: [${selectedCell.uncertaintyLower} – ${selectedCell.uncertaintyUpper}]`
                  : `FRP: ${selectedCell.harmonizedFRP.toLocaleString()} MW`}
              </span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">Statistical Z-Score</span>
              <span className={`font-mono font-bold text-base ${
                selectedCell.anomalyScore >= 2.0 ? 'text-rose-400' : 'text-slate-200'
              }`}>
                {selectedCell.anomalyScore > 0 ? `+${selectedCell.anomalyScore}σ` : `${selectedCell.anomalyScore}σ`}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {selectedCell.anomalyScore >= 2.0 ? 'Significant Surge' : 'Within Climatology'}
              </span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-0.5">Data Coverage & Status</span>
              <span className="font-mono text-purple-400 font-bold text-xs uppercase block truncate">
                {selectedCell.qualityFlag === 'sufficient_data'
                  ? 'Dual-Sensor Overlap'
                  : selectedCell.qualityFlag === 'single_sensor_modis_backcast'
                  ? 'MODIS Back-Cast (2000–2011)'
                  : selectedCell.qualityFlag === 'single_sensor_only'
                  ? 'Single Sensor Only'
                  : selectedCell.qualityFlag === 'no_data'
                  ? 'No Observations'
                  : selectedCell.qualityFlag || 'Verified'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5 truncate" title={selectedCell.processingNote}>
                {selectedCell.qualityFlag === 'single_sensor_modis_backcast'
                  ? 'Pre-VIIRS Sensor-Calibrated'
                  : selectedCell.processingNote
                  ? 'NB GLM Calibrated'
                  : 'Historical'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="text-[11px]">Heatmap Scale:</span>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="w-3.5 h-3.5 rounded bg-slate-900 border border-slate-800 inline-block"></span>
            <span>0</span>
            <span className="w-3.5 h-3.5 rounded bg-amber-950/70 inline-block"></span>
            <span>Low</span>
            <span className="w-3.5 h-3.5 rounded bg-amber-600/80 inline-block"></span>
            <span>Moderate</span>
            <span className="w-3.5 h-3.5 rounded bg-orange-500 inline-block"></span>
            <span>High</span>
            <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-orange-500 to-rose-600 inline-block"></span>
            <span>Extreme</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-700"></span> Pre-VIIRS Era: 2000–2011
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Dual-Sensor Era: 2012–2026
          </span>
        </div>
      </div>
    </div>
  );
};
