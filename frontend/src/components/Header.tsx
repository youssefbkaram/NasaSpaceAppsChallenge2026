import React from 'react';
import { Satellite, Download, Info, MapPin, Sparkles } from 'lucide-react';
import { RegionPreset } from '../types/fire';
import { REGION_PRESETS } from '../data/regionPresets';
import { ALL_COUNTRIES_REGION, LOCAL_COUNTRY_DATASETS } from '../data/localCountryData';
import { FIRMS_DATA_MODE } from '../services/firmsDataService';

interface HeaderProps {
  selectedRegion: RegionPreset;
  onSelectRegion: (region: RegionPreset) => void;
  activeTab: 'map' | 'calendar' | 'analytics' | 'ai';
  setActiveTab: (tab: 'map' | 'calendar' | 'analytics' | 'ai') => void;
  onOpenExport: () => void;
  onOpenMethodology: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedRegion,
  onSelectRegion,
  activeTab,
  setActiveTab,
  onOpenExport,
  onOpenMethodology,
}) => {
  const selectableRegions = React.useMemo(() => {
    if (FIRMS_DATA_MODE !== 'local') {
      return REGION_PRESETS.filter((region) => region.id !== 'all');
    }
    const suriname = LOCAL_COUNTRY_DATASETS.find((d) => d.region.id === 'suriname')?.region;
    const others = LOCAL_COUNTRY_DATASETS
      .filter((d) => d.region.id !== 'suriname')
      .map(({ region }) => region)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [suriname, ...others, ALL_COUNTRIES_REGION].filter((r): r is RegionPreset => Boolean(r));
  }, []);

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-400/25 text-cyan-300">
            <Satellite className="w-[18px] h-[18px]" strokeWidth={1.8} />
            <span className="absolute right-[5px] bottom-[5px] h-1.5 w-1.5 rounded-full bg-orange-400 ring-2 ring-slate-950" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-tight text-white">
                NASA FIRMS Explorer
              </span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                MODIS + VIIRS
              </span>
            </div>
          </div>
        </div>

        {/* Center: Clean Mode Switcher */}
        <nav className="flex items-center bg-slate-900 border border-slate-800/90 rounded-lg p-1 text-xs">
          <button
            onClick={() => setActiveTab('map')}
            className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
              activeTab === 'map'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Map
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Burning Calendar
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sensor Comparison
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition cursor-pointer ${
              activeTab === 'ai'
                ? 'bg-cyan-900/70 text-cyan-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Analyzer
          </button>
        </nav>

        {/* Right Actions: Region select, Export, Info */}
        <div className="flex items-center gap-2">
          {/* Quick Region Selector */}
          <div className="hidden md:flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-orange-400" />
            <select
              value={selectedRegion.id}
              onChange={(e) => {
                const reg = selectableRegions.find(r => r.id === e.target.value);
                if (reg) onSelectRegion(reg);
              }}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer pr-1 text-xs font-medium"
            >
              {selectableRegions.map((region) => (
                <option key={region.id} value={region.id} className="bg-slate-900 text-slate-200">
                  {region.id === 'suriname' ? '⭐ Suriname (Harmonized 2000–2024)' : region.name}
                </option>
              ))}
            </select>
          </div>

          {/* Methodology Info */}
          <button
            onClick={onOpenMethodology}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Data source and methodology status"
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Methodology</span>
          </button>

          {/* Export */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>

      </div>
    </header>
  );
};
