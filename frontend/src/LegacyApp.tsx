import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FIRMSMap } from './components/Map/FIRMSMap';
import { BurningCalendar } from './components/Calendar/BurningCalendar';
import { HistoricalComparisons } from './components/Analytics/HistoricalComparisons';
import { HarmonizationModelBanner } from './components/Analytics/HarmonizationModelBanner';
import { HarmonizationExplainer } from './components/Methodology/HarmonizationExplainer';
import { DataExportModal } from './components/Export/DataExportModal';
import { Footer } from './components/Footer';
import { AIAnalyzer } from './components/AI/AIAnalyzer';

import type { HotspotObservation, RegionPreset, SensorType } from './types/fire';
import { REGION_PRESETS } from './data/regionPresets';
import { LOCAL_COUNTRY_DATASETS } from './data/localCountryData';
import {
  fetchHarmonizedMonthlyData,
  type HarmonizedMonthlyResponse
} from './services/harmonizedDataService';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';

function getInitialObservationDate(): string {
  return '2026-11-13';
}

export function App() {
  const defaultRegion = REGION_PRESETS.find((region) => region.id === 'egypt') ?? REGION_PRESETS[0];
  const [selectedRegion, setSelectedRegion] = useState<RegionPreset>(defaultRegion);
  const [selectedSensor, setSelectedSensor] = useState<SensorType>('ALL_RAW');
  const [activeTab, setActiveTab] = useState<'map' | 'calendar' | 'analytics' | 'ai'>('map');
  const [currentDate, setCurrentDate] = useState<string>(getInitialObservationDate);
  const [observations, setObservations] = useState<HotspotObservation[]>([]);

  // Harmonized data state
  const [harmonizedData, setHarmonizedData] = useState<HarmonizedMonthlyResponse | null>(null);
  const [isHarmonizedLoading, setIsHarmonizedLoading] = useState<boolean>(false);
  const [harmonizedError, setHarmonizedError] = useState<string | null>(null);

  // Modals state
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState<boolean>(false);

  // Fetch harmonized data when tab is calendar/analytics or region changes
  useEffect(() => {
    if (activeTab !== 'calendar' && activeTab !== 'analytics') return;

    let isMounted = true;
    const controller = new AbortController();

    async function loadData() {
      setIsHarmonizedLoading(true);
      setHarmonizedError(null);
      try {
        const countryToFetch = selectedRegion.id === 'all' ? 'Suriname' : selectedRegion.name;
        const result = await fetchHarmonizedMonthlyData(countryToFetch, controller.signal);
        if (isMounted) {
          setHarmonizedData(result);
        }
      } catch (err) {
        if (isMounted && !(err instanceof DOMException && err.name === 'AbortError')) {
          setHarmonizedError(err instanceof Error ? err.message : 'Failed to load harmonized dataset.');
        }
      } finally {
        if (isMounted) {
          setIsHarmonizedLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeTab, selectedRegion]);

  const surinameRegion = LOCAL_COUNTRY_DATASETS.find((c) => c.region.id === 'suriname')?.region;

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans antialiased">
      
      {/* Clean Modern Navigation */}
      <Header
        selectedRegion={selectedRegion}
        onSelectRegion={setSelectedRegion}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenMethodology={() => setIsMethodologyOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 space-y-4">
        
        {/* View 1: Clean Interactive Map */}
        {activeTab === 'map' && (
          <FIRMSMap
            selectedRegion={selectedRegion}
            selectedSensor={selectedSensor}
            onSelectSensor={setSelectedSensor}
            currentDate={currentDate}
            onDateChange={setCurrentDate}
            onObservationsChange={setObservations}
          />
        )}

        {activeTab === 'ai' && (
          <AIAnalyzer selectedRegion={selectedRegion} defaultDate={currentDate} />
        )}

        {/* View 2 & 3: Harmonized Burning Calendar & Historical Analytics */}
        {activeTab !== 'map' && (
          <div className="space-y-4">
            {isHarmonizedLoading && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-12 text-center flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                <h3 className="text-base font-semibold text-white">Loading Calibrated Fire Activity Dataset</h3>
                <p className="text-xs text-slate-400 max-w-md">
                  Fetching verified NASA FIRMS observations and Negative Binomial GLM cross-sensor calibration for {selectedRegion.name}...
                </p>
              </div>
            )}

            {!isHarmonizedLoading && harmonizedError && (
              <div className="rounded-2xl border border-rose-800/60 bg-slate-950 p-6 text-sm text-slate-300">
                <div className="flex items-center gap-2 text-rose-400 font-semibold mb-2">
                  <AlertCircle className="w-5 h-5" />
                  <h4>Unable to load harmonized dataset</h4>
                </div>
                <p className="text-xs text-slate-400">{harmonizedError}</p>
              </div>
            )}

            {!isHarmonizedLoading && !harmonizedError && harmonizedData && !harmonizedData.isAvailable && (
              <section className="rounded-2xl border border-amber-800/60 bg-slate-950 p-6 text-sm text-slate-300 space-y-3">
                <div className="flex items-center gap-2 text-amber-300 font-semibold">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <h3>Harmonized outputs unavailable for {selectedRegion.name}</h3>
                </div>
                <p className="max-w-3xl text-xs leading-relaxed text-slate-400">
                  {harmonizedData.message || `Available static harmonized summaries: ${harmonizedData.availableCountries.join(', ')}.`}
                </p>
                {surinameRegion && (
                  <button
                    onClick={() => setSelectedRegion(surinameRegion)}
                    className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-white transition cursor-pointer flex items-center gap-2"
                  >
                    <span>View Suriname harmonized summary</span>
                  </button>
                )}
              </section>
            )}

            {!isHarmonizedLoading && !harmonizedError && harmonizedData && harmonizedData.isAvailable && (
              <>
                {/* Scientific Model Diagnostics Header */}
                <HarmonizationModelBanner
                  country={harmonizedData.country}
                  diagnostics={harmonizedData.diagnostics}
                />

                {/* View 2: Burning Calendar Heatmap Matrix */}
                {activeTab === 'calendar' && (
                  <BurningCalendar
                    data={harmonizedData.metrics}
                    selectedSensor={selectedSensor}
                  />
                )}

                {/* View 3: Historical Climatology & Multi-Year Analytics */}
                {activeTab === 'analytics' && (
                  <HistoricalComparisons
                    data={harmonizedData.metrics}
                    selectedRegion={selectedRegion}
                    selectedSensor={selectedSensor}
                  />
                )}
              </>
            )}
          </div>
        )}

      </main>

      {/* Clean Minimalist Footer */}
      <Footer />

      {/* Real Data Export Modal */}
      <DataExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        hotspots={observations}
        selectedRegion={selectedRegion}
      />

      {/* Methodology Explainer Modal */}
      <HarmonizationExplainer
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />

    </div>
  );
}

export default App;
