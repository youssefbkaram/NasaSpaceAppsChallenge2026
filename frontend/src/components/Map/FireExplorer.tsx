import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Flame,
  Layers3,
  LoaderCircle,
  MapPin,
  Radio,
  RotateCcw,
  Satellite,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react';
import type { HotspotObservation, RegionPreset, SensorType } from '../../types/fire';
import { ALL_COUNTRIES_REGION, LOCAL_COUNTRY_DATASETS } from '../../data/localCountryData';
import { REGION_PRESETS } from '../../data/regionPresets';
import { FIRMS_DATA_MODE, fetchNASAObservations } from '../../services/firmsDataService';
import { DataExportModal } from '../Export/DataExportModal';
import { HarmonizationExplainer } from '../Methodology/HarmonizationExplainer';
import { AIAnalyzer } from '../AI/AIAnalyzer';

type ViewMode = 'map' | 'ai';
type PeriodMode = '24h' | '3d' | '7d' | 'custom';
type BasemapMode = 'dark' | 'satellite';

const EARLIEST_DATE = '2000-11-01';
const TODAY = new Date().toISOString().slice(0, 10);
const EMPTY_OBSERVATIONS: HotspotObservation[] = [];

function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function countDays(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function observationStart(endDate: string, mode: PeriodMode, customStart: string): string {
  if (mode === 'custom') return customStart;
  const days = mode === '24h' ? 1 : mode === '3d' ? 3 : 7;
  return shiftDate(endDate, 1 - days);
}

function sensorColor(instrument: HotspotObservation['instrument']): string {
  return instrument === 'MODIS' ? '#f59e0b' : '#22d3ee';
}

function MapCanvas({
  region,
  observations,
  basemap,
  onSelectObservation,
  onCursorMove
}: {
  region: RegionPreset;
  observations: HotspotObservation[];
  basemap: BasemapMode;
  onSelectObservation: (observation: HotspotObservation) => void;
  onCursorMove: (coords: { latitude: number; longitude: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const { center: regionCenter, zoom: regionZoom } = region;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: regionCenter,
      zoom: regionZoom,
      zoomControl: false,
      preferCanvas: true,
      worldCopyJump: true
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    rendererRef.current = L.canvas({ padding: 0.35 });
    layerRef.current = L.layerGroup().addTo(map);
    map.on('mousemove', (event) => {
      onCursorMove({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resizeObserver.observe(containerRef.current);
    const resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    return () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [onCursorMove, regionCenter, regionZoom]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.flyTo(regionCenter, regionZoom, { duration: 0.8 });
    onCursorMove({ latitude: regionCenter[0], longitude: regionCenter[1] });
  }, [regionCenter, regionZoom, onCursorMove]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (baseLayerRef.current) mapRef.current.removeLayer(baseLayerRef.current);
    const layer = basemap === 'satellite'
      ? L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
          attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        }
      )
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      });
    baseLayerRef.current = layer.addTo(mapRef.current);
  }, [basemap]);

  useEffect(() => {
    if (!layerRef.current) return;
    const group = layerRef.current;
    group.clearLayers();
    const renderer = rendererRef.current;
    for (const observation of observations) {
      const color = sensorColor(observation.instrument);
      L.circleMarker([observation.latitude, observation.longitude], {
        renderer: renderer ?? undefined,
        radius: Math.min(3 + Math.sqrt(Math.max(observation.frp, 0)) * 0.24, 7),
        color,
        weight: 0.8,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: observation.quality === 'NRT' ? 0.55 : 0.78
      })
        .on('click', () => onSelectObservation(observation))
        .addTo(group);
    }
  }, [observations, onSelectObservation]);

  return <div ref={containerRef} className="absolute inset-0 z-0" aria-label="Interactive fire detection map" />;
}

function Metric({ label, value, accent = 'text-slate-100' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-[88px] border-l border-slate-800 pl-4 first:border-0 first:pl-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function FilterSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-800/80 px-4 py-4 first:border-t-0">
      <h2 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function FireExplorer({
  onOpenClassic
}: {
  onOpenClassic: () => void;
}) {
  const regions = useMemo(() => {
    if (FIRMS_DATA_MODE === 'real' || FIRMS_DATA_MODE === 'synthetic') {
      return REGION_PRESETS.filter((region) => region.id !== 'all');
    }
    return [
      ...LOCAL_COUNTRY_DATASETS
        .filter(({ region }) => region.id !== 'suriname')
        .map(({ region }) => region)
        .sort((a, b) => a.name.localeCompare(b.name)),
      LOCAL_COUNTRY_DATASETS.find(({ region }) => region.id === 'suriname')?.region,
      ALL_COUNTRIES_REGION
    ].filter((region): region is RegionPreset => Boolean(region));
  }, []);

  const defaultRegion = regions.find((region) => region.id === 'all') ?? regions[0] ?? ALL_COUNTRIES_REGION;
  const [region, setRegion] = useState(defaultRegion);
  const [view, setView] = useState<ViewMode>('map');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sensor, setSensor] = useState<SensorType>('ALL_RAW');
  const [period, setPeriod] = useState<PeriodMode>('24h');
  const [endDate, setEndDate] = useState(() => {
    const date = new Date();
    if (FIRMS_DATA_MODE === 'local') date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  });
  const [customStart, setCustomStart] = useState(endDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [frpMinimum, setFrpMinimum] = useState('');
  const [qualitySP, setQualitySP] = useState(true);
  const [qualityNRT, setQualityNRT] = useState(true);
  const [basemap, setBasemap] = useState<BasemapMode>('dark');
  const [queryResult, setQueryResult] = useState<{
    key: string;
    observations: HotspotObservation[];
    error: string | null;
  } | null>(null);
  const [selectedObservation, setSelectedObservation] = useState<HotspotObservation | null>(null);
  const [cursor, setCursor] = useState({ latitude: 0, longitude: 0 });
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const requestId = useRef(0);
  const handleCursorMove = useCallback((coords: { latitude: number; longitude: number }) => {
    setCursor(coords);
  }, []);

  const startDate = observationStart(endDate, period, customStart);
  const actualEndDate = period === 'custom' ? customEnd : endDate;
  const days = countDays(startDate, actualEndDate);
  const validRange = startDate >= EARLIEST_DATE && actualEndDate <= TODAY && days >= 1 && days <= 7;
  const queryKey = `${region.id}|${startDate}|${actualEndDate}`;
  const currentQuery = queryResult?.key === queryKey ? queryResult : null;
  const observations = currentQuery?.observations ?? EMPTY_OBSERVATIONS;
  const isLoading = validRange && currentQuery === null;
  const error = currentQuery?.error ?? (!validRange && days > 7
    ? 'Map view supports up to 7 days at a time. Use AI Analyzer for longer date ranges.'
    : !validRange && (startDate < EARLIEST_DATE || actualEndDate > TODAY || days < 1)
      ? 'Choose a valid date range from 2000-11-01 through today.'
      : null);

  const filteredObservations = useMemo(() => observations.filter((observation) =>
    (sensor === 'ALL_RAW' || observation.instrument === sensor) &&
    (observation.quality === 'NRT' ? qualityNRT : qualitySP) &&
    (frpMinimum === '' || observation.frp >= Number(frpMinimum))
  ), [observations, sensor, qualityNRT, qualitySP, frpMinimum]);

  const modisCount = filteredObservations.filter(({ instrument }) => instrument === 'MODIS').length;
  const viirsCount = filteredObservations.filter(({ instrument }) => instrument === 'VIIRS').length;
  const dataSources = [...new Set(observations.map(({ dataOrigin }) => dataOrigin ?? 'unknown'))];

  useEffect(() => {
    if (!validRange) return;
    const controller = new AbortController();
    const currentRequestId = ++requestId.current;
    const requestKey = queryKey;
    void fetchNASAObservations(startDate, region, days, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setQueryResult({ key: requestKey, observations: result, error: null });
        setSelectedObservation(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setQueryResult({
          key: requestKey,
          observations: [],
          error: cause instanceof Error ? cause.message : 'Fire observations could not be loaded.'
        });
      });
    return () => controller.abort();
  }, [queryKey, startDate, region, days, validRange]);

  const dailyCounts = useMemo(() => {
    const byDate = new Map<string, { modis: number; viirs: number }>();
    for (const observation of filteredObservations) {
      const counts = byDate.get(observation.acqDate) ?? { modis: 0, viirs: 0 };
      if (observation.instrument === 'MODIS') counts.modis++;
      else counts.viirs++;
      byDate.set(observation.acqDate, counts);
    }
    const result = [];
    for (let offset = 0; offset < Math.max(days, 1); offset++) {
      const date = shiftDate(startDate, offset);
      result.push({ date, ...(byDate.get(date) ?? { modis: 0, viirs: 0 }) });
    }
    return result;
  }, [filteredObservations, startDate, days]);
  const maxDaily = Math.max(1, ...dailyCounts.map(({ modis, viirs }) => modis + viirs));
  const yearsCovered = new Set(observations.map(({ acqDate }) => acqDate.slice(0, 4))).size;

  const updateQuality = (quality: 'SP' | 'NRT') => {
    if (quality === 'SP') setQualitySP((current) => !current);
    else setQualityNRT((current) => !current);
  };

  const setQuickPeriod = (next: Exclude<PeriodMode, 'custom'>) => {
    if (period === 'custom') setEndDate(customEnd);
    setPeriod(next);
  };

  const selectPeriodDay = (date: string) => {
    setPeriod('24h');
    setEndDate(date);
  };

  return (
    <div className="flex h-[100dvh] min-h-[620px] flex-col overflow-hidden bg-[#0b1120] text-slate-200">
      <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0d1526] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500 text-slate-950">
            <Satellite className="h-[17px] w-[17px]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-wide text-slate-100">FireScope</h1>
            <p className="hidden text-[9px] uppercase tracking-[0.16em] text-slate-500 sm:block">
              MODIS + VIIRS active-fire intelligence
            </p>
          </div>
          <span className="hidden h-5 w-px bg-slate-800 md:block" />
          <div className="hidden items-center gap-4 md:flex">
            <Metric label="Detections" value={isLoading ? '…' : filteredObservations.length.toLocaleString()} />
            <Metric label="MODIS" value={modisCount.toLocaleString()} accent="text-amber-300" />
            <Metric label="VIIRS" value={viirsCount.toLocaleString()} accent="text-cyan-300" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                setView('map');
              }}
              className={`rounded px-2.5 py-1 text-[11px] font-medium ${view === 'map' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              title="Fire map"
            >
              <span className="hidden sm:inline">Explorer</span>
              <MapPin className="h-3.5 w-3.5 sm:hidden" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                setView('ai');
              }}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium ${view === 'ai' ? 'bg-amber-500/15 text-amber-200' : 'text-slate-400 hover:text-white'}`}
              title="AI fire analysis"
            >
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">AI Analysis</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-label="Toggle map filters"
            title="Map filters"
            className={`${view === 'map' ? 'flex' : 'hidden'} h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-300 lg:hidden`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            aria-label="Export filtered observations"
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-amber-500/50 hover:text-amber-200"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            type="button"
            onClick={onOpenClassic}
            aria-label="Open classic interface"
            className="rounded-md border border-slate-800 px-2.5 py-1.5 text-[10px] font-medium text-slate-500 transition hover:border-slate-600 hover:text-slate-200"
            title="Open the previous interface"
          >
            <span className="hidden md:inline">Classic UI</span>
            <Layers3 className="h-3.5 w-3.5 md:hidden" />
          </button>
        </div>
      </header>

      {view === 'ai' ? (
        <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-6xl">
            <label className="mb-4 block max-w-sm text-xs text-slate-300">
              Analysis region
              <select
                value={region.id}
                onChange={(event) => {
                  const selected = regions.find((candidate) => candidate.id === event.target.value);
                  if (selected) setRegion(selected);
                }}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                {regions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <AIAnalyzer selectedRegion={region} defaultDate={endDate} />
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          {filtersOpen && (
            <button
              type="button"
              aria-label="Close map filters"
              onClick={() => setFiltersOpen(false)}
              className="fixed inset-x-0 bottom-6 top-14 z-[580] bg-black/55 lg:hidden"
            />
          )}
          <aside className={`fixed bottom-6 left-0 top-14 z-[590] w-[286px] shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-[#0d1526] shadow-2xl lg:static lg:z-auto lg:flex lg:shadow-none ${
            filtersOpen ? 'flex' : 'hidden'
          }`}>
            <div className="border-b border-slate-800/80 px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Active detections</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
                    {isLoading ? <span className="text-base text-slate-500">Loading…</span> : filteredObservations.length.toLocaleString()}
                  </div>
                </div>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                  error ? 'border-rose-900/70 bg-rose-950/30 text-rose-300'
                    : isLoading ? 'border-amber-900/70 bg-amber-950/30 text-amber-300'
                      : 'border-emerald-900/70 bg-emerald-950/30 text-emerald-300'
                }`}>
                  {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                </div>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                {dataSources.length ? dataSources.join(' · ') : 'NASA FIRMS observations'}
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close map filters"
                className="rounded p-1 text-slate-500 hover:text-white lg:hidden"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {FIRMS_DATA_MODE === 'synthetic' && (
              <div className="mx-3 mt-3 rounded-md border border-amber-800/70 bg-amber-950/30 p-2.5 text-[10px] leading-4 text-amber-200">
                Demo observations are synthetic and are not NASA data.
              </div>
            )}

            <FilterSection title="Region" icon={<MapPin className="h-3.5 w-3.5" />}>
              <label className="relative block">
                <select
                  value={region.id}
                  onChange={(event) => {
                    const selected = regions.find((candidate) => candidate.id === event.target.value);
                    if (selected) setRegion(selected);
                  }}
                  className="w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 pr-8 text-xs text-slate-200 outline-none transition focus:border-amber-500/70"
                >
                  {regions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              </label>
              <p className="mt-2 text-[10px] leading-4 text-slate-500">{region.biome}</p>
            </FilterSection>

            <FilterSection title="Observation window · UTC" icon={<CalendarDays className="h-3.5 w-3.5" />}>
              <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-800 bg-slate-950 p-1">
                {([
                  ['24h', '24 hours'],
                  ['3d', '3 days'],
                  ['7d', '7 days']
                ] as const).map(([key, title]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setQuickPeriod(key)}
                    aria-pressed={period === key}
                    className={`rounded px-1.5 py-1.5 text-[10px] font-medium transition ${
                      period === key ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <label className="block text-[10px] text-slate-500">
                  {period === 'custom' ? 'From' : 'End date'}
                  <input
                    aria-label={period === 'custom' ? 'Date from' : 'Observation date'}
                    type="date"
                    min={period === 'custom' ? EARLIEST_DATE : (period === '7d' ? shiftDate(EARLIEST_DATE, 6) : period === '3d' ? shiftDate(EARLIEST_DATE, 2) : EARLIEST_DATE)}
                    max={period === 'custom' ? customEnd : TODAY}
                    value={period === 'custom' ? customStart : endDate}
                    onChange={(event) => period === 'custom' ? setCustomStart(event.target.value) : setEndDate(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500/70"
                  />
                </label>
                {period === 'custom' ? (
                  <label className="block text-[10px] text-slate-500">
                    To
                    <input
                      aria-label="Date to"
                      type="date"
                      min={customStart}
                      max={TODAY}
                      value={customEnd}
                      onChange={(event) => setCustomEnd(event.target.value)}
                      className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500/70"
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setPeriod('custom');
                    setCustomStart(startDate);
                    setCustomEnd(actualEndDate);
                  }}
                  className={`w-full rounded-md border px-2 py-1.5 text-[10px] font-medium transition ${
                    period === 'custom' ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Custom dates · up to 7 days
                </button>
                <p className={`text-[10px] ${validRange ? 'text-slate-500' : 'text-rose-300'}`}>
                  {validRange ? `${startDate} — ${actualEndDate} · ${days} ${days === 1 ? 'day' : 'days'}` : 'Choose a valid range of 1–7 days through today.'}
                </p>
              </div>
            </FilterSection>

            <FilterSection title="Sensor family" icon={<Satellite className="h-3.5 w-3.5" />}>
              <div className="space-y-1">
                {([
                  ['ALL_RAW', 'Both sensors · raw overlay', 'bg-slate-200'],
                  ['MODIS', 'MODIS · Terra / Aqua', 'bg-amber-400'],
                  ['VIIRS', 'VIIRS · SNPP / NOAA', 'bg-cyan-400']
                ] as const).map(([key, label, dot]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSensor(key)}
                    aria-pressed={sensor === key}
                    className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[11px] transition ${
                      sensor === key ? 'border-slate-600 bg-slate-800/80 text-slate-100' : 'border-transparent text-slate-400 hover:bg-slate-900'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    {label}
                    <span className={`ml-auto h-3.5 w-3.5 rounded-full border ${sensor === key ? 'border-amber-400 bg-amber-400/20' : 'border-slate-700'}`} />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-4 text-slate-600">
                The combined view is a raw overlay, not a harmonized count.
              </p>
            </FilterSection>

            <FilterSection title="Processing quality" icon={<Radio className="h-3.5 w-3.5" />}>
              <div className="flex gap-2">
                {([
                  ['SP', 'Science quality', qualitySP],
                  ['NRT', 'Near-real-time', qualityNRT]
                ] as const).map(([quality, label, enabled]) => (
                  <button
                    key={quality}
                    type="button"
                    onClick={() => updateQuality(quality)}
                    aria-pressed={enabled}
                    className={`flex-1 rounded-md border px-2 py-2 text-left text-[10px] ${
                      enabled ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-800 text-slate-600'
                    }`}
                  >
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${quality === 'SP' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {label}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Fire radiative power" icon={<Flame className="h-3.5 w-3.5" />}>
              <label className="block text-[10px] text-slate-500">
                Minimum FRP
                <div className="relative mt-1">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={frpMinimum}
                    onChange={(event) => setFrpMinimum(event.target.value)}
                    placeholder="No minimum"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 pr-12 text-xs text-slate-200 outline-none focus:border-amber-500/70"
                  />
                  <span className="absolute right-2.5 top-1.5 text-[10px] text-slate-600">MW</span>
                </div>
              </label>
              <button
                type="button"
                onClick={() => {
                  setSensor('ALL_RAW');
                  setFrpMinimum('');
                  setQualitySP(true);
                  setQualityNRT(true);
                  setPeriod('24h');
                  setCustomStart(endDate);
                  setCustomEnd(endDate);
                }}
                className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500 transition hover:text-amber-200"
              >
                <RotateCcw className="h-3 w-3" /> Reset filters
              </button>
            </FilterSection>

            <div className="mt-auto border-t border-slate-800 px-4 py-3">
              <div className="flex items-start gap-2">
                <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
                <p className="text-[9px] leading-4 text-slate-600">
                  Hotspots are satellite detections, not fire perimeters or unique incidents. Missing observations do not mean zero activity.
                </p>
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <section className="relative min-h-[330px] flex-1 overflow-hidden bg-[#101a2a]">
              <MapCanvas
                region={region}
                observations={filteredObservations}
                basemap={basemap}
                onSelectObservation={setSelectedObservation}
                onCursorMove={handleCursorMove}
              />

              <div className="pointer-events-none absolute inset-x-0 top-0 z-[450] flex items-start justify-between p-3 sm:p-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md border border-slate-700/80 bg-[#0b1120]/90 px-3 py-2 shadow-lg backdrop-blur-md">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-100">{region.name}</div>
                    <div className="text-[9px] text-slate-500">{startDate} — {actualEndDate} UTC</div>
                  </div>
                </div>
                <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-slate-700/80 bg-[#0b1120]/90 p-1 shadow-lg backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => setBasemap('dark')}
                    aria-pressed={basemap === 'dark'}
                    className={`rounded px-2 py-1 text-[9px] font-medium ${basemap === 'dark' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    onClick={() => setBasemap('satellite')}
                    aria-pressed={basemap === 'satellite'}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] font-medium ${basemap === 'satellite' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Layers3 className="h-3 w-3" /> Satellite
                  </button>
                </div>
              </div>

              <div className="pointer-events-none absolute bottom-8 left-3 z-[450] flex flex-wrap items-center gap-3 rounded-md border border-slate-700/70 bg-[#0b1120]/90 px-3 py-2 text-[9px] text-slate-400 shadow-lg backdrop-blur-md sm:bottom-4 sm:left-4">
                <span className="font-semibold uppercase tracking-[0.13em] text-slate-500">Sensor</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-400" /> MODIS</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-400" /> VIIRS</span>
                <span className="border-l border-slate-700 pl-3">Marker size ∝ √FRP</span>
              </div>

              {isLoading && (
                <div className="pointer-events-none absolute inset-0 z-[440] flex items-center justify-center bg-slate-950/20">
                  <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-[#0b1120]/95 px-3 py-2 text-[11px] text-slate-300 shadow-lg">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    Loading satellite detections…
                  </div>
                </div>
              )}
              {error && !isLoading && (
                <div role="alert" className="absolute left-1/2 top-1/2 z-[500] w-[min(90%,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-rose-900/70 bg-[#0b1120]/95 p-4 shadow-xl">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    <div className="text-xs leading-5 text-rose-100">{error}</div>
                  </div>
                </div>
              )}

              {selectedObservation && (
                <div className="absolute right-3 top-14 z-[500] w-[min(280px,calc(100%-24px))] rounded-lg border border-slate-700 bg-[#0d1526]/95 p-3 shadow-2xl backdrop-blur-md sm:right-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-semibold text-white">{selectedObservation.satellite}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">{selectedObservation.instrument} · {selectedObservation.quality ?? 'quality unknown'}</div>
                    </div>
                    <button type="button" onClick={() => setSelectedObservation(null)} aria-label="Close detection details" className="text-slate-500 hover:text-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded border border-slate-800 bg-slate-950 p-2">
                      <div className="text-[9px] uppercase tracking-wide text-slate-600">FRP</div>
                      <div className="mt-0.5 font-mono text-xs text-amber-200">{selectedObservation.frp.toFixed(1)} MW</div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950 p-2">
                      <div className="text-[9px] uppercase tracking-wide text-slate-600">Brightness</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-200">{selectedObservation.brightness.toFixed(1)} K</div>
                    </div>
                    <div className="col-span-2 rounded border border-slate-800 bg-slate-950 p-2">
                      <div className="text-[9px] uppercase tracking-wide text-slate-600">Acquisition · UTC</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-300">{selectedObservation.acqDate} {selectedObservation.acqTime}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] leading-4 text-slate-500">A hotspot is one satellite observation, not necessarily a unique fire.</div>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 z-[450] flex items-center justify-between border-t border-slate-700/60 bg-[#0b1120]/90 px-3 py-1 font-mono text-[9px] text-slate-500 backdrop-blur sm:px-4">
                <span>Lat {cursor.latitude.toFixed(3)}° · Lon {cursor.longitude.toFixed(3)}°</span>
                <span className="hidden sm:inline">{region.name} · EPSG:4326</span>
              </div>
            </section>

            <section className="flex h-[220px] shrink-0 flex-col border-t border-slate-800 bg-[#0d1526] sm:h-[238px]">
              <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-amber-400" />
                  <h2 className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-300">Daily detection activity</h2>
                  <span className="hidden text-[9px] text-slate-600 md:inline">raw observations · sensor families remain separate</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMethodologyOpen(true)}
                  className="flex shrink-0 items-center gap-1 text-[9px] text-slate-500 transition hover:text-amber-200"
                >
                  <CircleHelp className="h-3 w-3" /> Method
                </button>
              </div>
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col px-4 pb-2 pt-3">
                  <div className="flex min-h-0 flex-1 items-end gap-1.5 overflow-x-auto">
                    {dailyCounts.map(({ date, modis, viirs }) => {
                      const total = modis + viirs;
                      const barHeight = Math.max(4, total / maxDaily * 100);
                      return (
                        <button
                          key={date}
                          type="button"
                          title={`${date}: ${total.toLocaleString()} detections (${modis.toLocaleString()} MODIS, ${viirs.toLocaleString()} VIIRS)`}
                          onClick={() => selectPeriodDay(date)}
                          className="group flex h-full min-w-[28px] flex-1 flex-col items-center justify-end gap-1.5"
                        >
                          <span className="max-w-full truncate text-[8px] tabular-nums text-slate-600 opacity-0 transition group-hover:opacity-100">
                            {total ? total.toLocaleString() : '0'}
                          </span>
                          <span className={`flex w-full max-w-[42px] flex-col-reverse overflow-hidden rounded-t-[3px] transition ${
                            date === endDate ? 'ring-1 ring-amber-400/80' : 'group-hover:brightness-125'
                          }`} style={{ height: `${barHeight}%`, minHeight: 4 }}>
                            <span className="w-full bg-cyan-400/85" style={{ height: total ? `${viirs / total * 100}%` : '0%' }} />
                            <span className="w-full bg-amber-400/90" style={{ height: total ? `${modis / total * 100}%` : '0%' }} />
                          </span>
                          <span className={`whitespace-nowrap text-[8px] tabular-nums ${date === endDate ? 'text-amber-200' : 'text-slate-600'}`}>
                            {date.slice(5)}
                          </span>
                        </button>
                      );
                    })}
                    {!isLoading && dailyCounts.length === 0 && (
                      <div className="mb-8 flex w-full items-center justify-center text-[10px] text-slate-600">No observations in this window</div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-800/60 pt-2">
                    <span className="text-[9px] text-slate-600">{startDate} — {actualEndDate} · {days} {days === 1 ? 'day' : 'days'}</span>
                    <span className="flex items-center gap-3 text-[9px] text-slate-500">
                      <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-400" /> MODIS</span>
                      <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> VIIRS</span>
                    </span>
                  </div>
                </div>
                <div className="hidden w-[175px] shrink-0 flex-col justify-center gap-3 border-l border-slate-800/80 px-4 lg:flex">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-600">Window summary</div>
                  <div>
                    <div className="font-mono text-base font-semibold tabular-nums text-slate-100">{filteredObservations.length.toLocaleString()}</div>
                    <div className="text-[9px] text-slate-500">point observations</div>
                  </div>
                  <div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-amber-200">
                      {filteredObservations.length
                        ? `${(filteredObservations.reduce((sum, item) => sum + item.frp, 0) / filteredObservations.length).toFixed(1)} MW`
                        : '—'}
                    </div>
                    <div className="text-[9px] text-slate-500">mean FRP · not cross-sensor adjusted</div>
                  </div>
                  <div className="text-[9px] text-slate-600">
                    {yearsCovered ? `${yearsCovered} year${yearsCovered === 1 ? '' : 's'} in selection` : 'No dates represented'}
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      )}

      <div className="flex h-6 shrink-0 items-center justify-between border-t border-slate-800 bg-[#0a101d] px-3 text-[9px] text-slate-600">
        <span>NASA FIRMS active-fire observations · MODIS &amp; VIIRS</span>
        <span className="hidden sm:inline">Detection ≠ unique fire · raw counts are not harmonized</span>
      </div>

      <DataExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        hotspots={filteredObservations}
        selectedRegion={region}
      />
      <HarmonizationExplainer
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />
    </div>
  );
}
