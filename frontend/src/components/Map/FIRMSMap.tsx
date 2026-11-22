import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import type { HotspotObservation, RegionPreset, SensorType } from '../../types/fire';
import {
  FIRMS_DATA_END_DATE,
  FIRMS_DATA_START_DATE,
  MAX_FIRMS_QUERY_DAYS
} from '../../data/firmsDataAvailability';
import { FIRMSDateController } from './FIRMSDateController';
import { fetchNASAObservations, FIRMS_DATA_MODE } from '../../services/firmsDataService';

interface FIRMSMapProps {
  selectedRegion: RegionPreset;
  selectedSensor: SensorType;
  onSelectSensor: (sensor: SensorType) => void;
  currentDate: string;
  onDateChange: (newDate: string) => void;
  onObservationsChange: (observations: HotspotObservation[]) => void;
}

function shiftDate(date: string, offset: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function createObservationPopup(spot: HotspotObservation): HTMLElement {
  const content = document.createElement('div');
  content.className = 'firms-observation-popup-content';

  const heading = document.createElement('div');
  heading.className = `firms-observation-popup-heading ${spot.instrument === 'MODIS' ? 'is-modis' : 'is-viirs'}`;
  heading.textContent = `${spot.satellite} (${spot.instrument})`;
  content.appendChild(heading);

  const fields: Array<[string, string]> = [
    ['Date (UTC)', spot.acqDate],
    ['Time (UTC)', `${spot.acqTime.slice(0, 2)}:${spot.acqTime.slice(2, 4)}`],
    ['Latitude', `${spot.latitude.toFixed(5)}°`],
    ['Longitude', `${spot.longitude.toFixed(5)}°`],
    ['Satellite', spot.satellite],
    ['Confidence', spot.confidence === undefined || spot.confidence === '' ? '—' : `${spot.confidence}${typeof spot.confidence === 'number' && spot.instrument === 'MODIS' ? '%' : ''}`],
    ['FRP', `${spot.frp} MW`],
    ['Day/Night', spot.daynight === 'D' ? 'Day' : 'Night'],
    ['Brightness', `${spot.brightness} K`],
    ['Brightness T31', spot.brightT31 === undefined ? '—' : `${spot.brightT31} K`],
    ['Scan / Track', `${spot.scan} / ${spot.track} km`],
    ['Processing', spot.quality ?? '—'],
    ['Version', spot.version || '—'],
    ['Type', spot.type === undefined ? '—' : String(spot.type)],
    ['Country', spot.country ?? '—']
  ];

  const details = document.createElement('dl');
  details.className = 'firms-observation-popup-details';
  for (const [label, value] of fields) {
    const name = document.createElement('dt');
    name.textContent = label;
    const data = document.createElement('dd');
    data.textContent = value;
    details.append(name, data);
  }
  content.appendChild(details);

  const note = document.createElement('p');
  note.className = 'firms-observation-popup-note';
  note.textContent = spot.dataOrigin === 'synthetic'
    ? 'Synthetic FIRMS-format demo record; not a NASA observation.'
    : 'Raw satellite detection; not necessarily a unique fire.';
  content.appendChild(note);
  return content;
}

export const FIRMSMap: React.FC<FIRMSMapProps> = ({
  selectedRegion,
  selectedSensor,
  onSelectSensor,
  currentDate,
  onDateChange,
  onObservationsChange
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Data states
  const [activeHotspots, setActiveHotspots] = useState<HotspotObservation[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number }>({ lat: 15.0, lng: 10.0 });
  const [currentZoom, setCurrentZoom] = useState<number>(3);
  const [timeSpan, setTimeSpan] = useState<'24h' | '3d' | '7d' | 'custom'>('24h');
  const [customStartDate, setCustomStartDate] = useState(currentDate);
  const [customEndDate, setCustomEndDate] = useState(currentDate);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoadingFeed, setIsLoadingFeed] = useState<boolean>(false);

  // Counts
  const [modisCount, setModisCount] = useState<number>(0);
  const [viirsCount, setViirsCount] = useState<number>(0);

  // Basemap & Compare Tool
  const [basemapChoice, setBasemapChoice] = useState<'dark' | 'satellite' | 'gibs'>('dark');
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);
  const [swipePosition, setSwipePosition] = useState<number>(50);
  const compareLeftSensor: SensorType = 'MODIS';
  const compareRightSensor: SensorType = 'VIIRS';
  const endDate = timeSpan === 'custom' ? customEndDate : currentDate;
  const requestedDayCount = timeSpan === '24h' ? 1
    : timeSpan === '3d' ? 3
    : timeSpan === '7d' ? 7
    : inclusiveDayCount(customStartDate, customEndDate);
  const startDate = timeSpan === 'custom'
    ? customStartDate
    : shiftDate(endDate, 1 - requestedDayCount);
  const isRangeValid = requestedDayCount >= 1 &&
    requestedDayCount <= MAX_FIRMS_QUERY_DAYS &&
    startDate >= FIRMS_DATA_START_DATE &&
    endDate <= FIRMS_DATA_END_DATE;

  // Use tile providers that do not require a separate map API key.
  const getTileLayer = (type: string, date: string) => {
    switch (type) {
      case 'satellite':
        return L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 18, attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' }
        );
      case 'gibs':
        return L.tileLayer(
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
          { maxZoom: 9, attribution: 'Imagery courtesy NASA EOSDIS GIBS' }
        );
      case 'dark':
      default:
        return L.tileLayer(
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
        );
    }
  };

  const updateURLHash = useCallback((lat: number, lng: number, zoom: number, date: string) => {
    window.location.hash = `d:${date};@${lat.toFixed(1)},${lng.toFixed(1)},${zoom}.0z`;
  }, []);

  // Fetch observations for the selected date and region from NASA FIRMS.
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingFeed(true);
    setFeedError(null);
    setActiveHotspots([]);
    setModisCount(0);
    setViirsCount(0);
    onObservationsChange([]);

    if (!isRangeValid) {
      setIsLoadingFeed(false);
      setFeedError(`Choose a valid date range of 1–${MAX_FIRMS_QUERY_DAYS} days from ${FIRMS_DATA_START_DATE} through ${FIRMS_DATA_END_DATE}.`);
      return () => controller.abort();
    }

    fetchNASAObservations(startDate, selectedRegion, requestedDayCount, controller.signal)
      .then((observations) => {
        setActiveHotspots(observations);
        setModisCount(observations.filter((spot) => spot.instrument === 'MODIS').length);
        setViirsCount(observations.filter((spot) => spot.instrument === 'VIIRS').length);
        onObservationsChange(observations);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'NASA FIRMS data could not be loaded.';
        setFeedError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingFeed(false);
      });

    return () => controller.abort();
  }, [startDate, requestedDayCount, isRangeValid, selectedRegion, onObservationsChange]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let initialCenter: [number, number] = selectedRegion.center || [15.0, 10.0];
    let initialZoom = selectedRegion.zoom || 3;
    const hash = window.location.hash;
    if (hash && hash.includes('@')) {
      const [latitude, longitude, zoom] = hash.split('@')[1].split(',');
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      const parsedZoom = Number.parseInt(zoom, 10);
      if (
        Number.isFinite(parsedLatitude) &&
        Number.isFinite(parsedLongitude) &&
        Number.isFinite(parsedZoom) &&
        parsedLatitude >= -90 && parsedLatitude <= 90 &&
        parsedLongitude >= -180 && parsedLongitude <= 180
      ) {
        initialCenter = [parsedLatitude, parsedLongitude];
        initialZoom = parsedZoom;
      }
    }

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true
    });

    canvasRendererRef.current = L.canvas({ padding: 0.5, tolerance: 12 });
    L.control.zoom({ position: 'topright' }).addTo(map);

    tileLayerRef.current = getTileLayer(basemapChoice, currentDate).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (e) => {
      setCursorCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setCurrentZoom(z);
      updateURLHash(c.lat, c.lng, z, currentDate);
    });

    mapInstanceRef.current = map;
    let isDisposed = false;
    const invalidateMapSize = () => {
      if (!isDisposed) map.invalidateSize({ pan: false });
    };
    const resizeObserver = new ResizeObserver(invalidateMapSize);
    resizeObserver.observe(mapContainerRef.current);
    const resizeFrame = requestAnimationFrame(invalidateMapSize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Basemap when basemapChoice or currentDate changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }

    tileLayerRef.current = getTileLayer(basemapChoice, currentDate).addTo(mapInstanceRef.current);

    if (layerGroupRef.current) layerGroupRef.current.addTo(mapInstanceRef.current);
  }, [basemapChoice, currentDate]);

  // Fly to region when selectedRegion changes
  useEffect(() => {
    if (mapInstanceRef.current && selectedRegion.center) {
      mapInstanceRef.current.flyTo(selectedRegion.center, selectedRegion.zoom, { duration: 1.2 });
    }
  }, [selectedRegion]);

  // Re-render Hotspot Markers on Canvas
  useEffect(() => {
    if (!mapInstanceRef.current || !layerGroupRef.current) return;

    mapInstanceRef.current.closePopup();
    layerGroupRef.current.clearLayers();
    const map = mapInstanceRef.current;
    const mapWidth = mapContainerRef.current?.clientWidth || 1000;
    const splitPixelX = (swipePosition / 100) * mapWidth;
    const renderer = canvasRendererRef.current || undefined;

    activeHotspots.forEach((spot) => {
      const isModis = spot.instrument === 'MODIS';
      const isViirs = spot.instrument === 'VIIRS';

      // Non-compare sensor filtering
      if (!isCompareMode) {
        if (selectedSensor === 'MODIS' && !isModis) return;
        if (selectedSensor === 'VIIRS' && !isViirs) return;
      }

      if (isNaN(spot.latitude) || isNaN(spot.longitude)) return;

      const point = map.latLngToContainerPoint([spot.latitude, spot.longitude]);

      // Swipe compare tool check
      if (isCompareMode) {
        const isLeft = point.x <= splitPixelX;
        const targetSensor = isLeft ? compareLeftSensor : compareRightSensor;

        if (targetSensor === 'MODIS' && !isModis) return;
        if (targetSensor === 'VIIRS' && !isViirs) return;
      }

      const fillColor = isModis ? '#f97316' : '#10b981';

      const radius = Math.min(7.5, Math.max(3.0, Math.log10(spot.frp + 1) * 2.6));

      const marker = L.circleMarker([spot.latitude, spot.longitude], {
        renderer,
        radius,
        fillColor,
        color: '#ffffff',
        weight: 0.8,
        opacity: 0.9,
        fillOpacity: 0.85
      });

      marker.bindPopup(createObservationPopup(spot), {
        autoPan: true,
        className: 'firms-observation-popup',
        maxWidth: 320,
        minWidth: 250,
        offset: [0, -8]
      });
      layerGroupRef.current?.addLayer(marker);
    });
  }, [activeHotspots, selectedSensor, isCompareMode, swipePosition, compareLeftSensor, compareRightSensor]);

  // Handle Swipe dragging
  const handleSwipeMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCompareMode || !mapContainerRef.current) return;
    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setSwipePosition((x / rect.width) * 100);
  };

  // Time-Lapse playback
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const nextDate = shiftDate(currentDate, 1);
      if (nextDate > FIRMS_DATA_END_DATE) {
        setIsPlaying(false);
        return;
      }
      onDateChange(nextDate);
    }, 1600);

    return () => clearInterval(interval);
  }, [isPlaying, currentDate, onDateChange]);

  return (
    <div className="grid w-full grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section
        className="relative h-[560px] min-w-0 select-none overflow-hidden rounded-xl border border-slate-800 bg-[#090d16] shadow-sm lg:h-[760px]"
        onMouseMove={handleSwipeMove}
      >
      {/* SWIPE / COMPARE SPLIT BAR */}
      {isCompareMode && (
        <>
          <div
            style={{ left: `${swipePosition}%` }}
            className="absolute top-0 bottom-0 w-0.5 bg-white z-[420] shadow-[0_0_10px_rgba(255,255,255,0.7)] pointer-events-none"
          >
            <div className="absolute top-1/2 -translate-y-1/2 -left-3.5 w-7 h-7 rounded-full bg-slate-950 border border-slate-600 shadow-lg flex items-center justify-center text-white text-[11px] pointer-events-auto cursor-ew-resize">
              ⬌
            </div>
          </div>

          <div className="absolute top-14 left-4 z-[420] bg-slate-900/95 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-medium text-orange-400 shadow-lg pointer-events-auto">
            <span>Left: MODIS (Terra/Aqua 1km)</span>
          </div>

          <div className="absolute top-14 right-4 z-[420] bg-slate-900/95 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 shadow-lg pointer-events-auto">
            <span>Right: VIIRS (375m I-Band)</span>
          </div>
        </>
      )}

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="z-0 h-full w-full" />

      {/* Clean Bottom Coordinate Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-[400] bg-slate-950/90 border-t border-slate-800/80 px-4 py-1 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div>
          <span>Lat: {cursorCoords.lat.toFixed(4)}° Lon: {cursorCoords.lng.toFixed(4)}°</span>
          <span className="mx-2 text-slate-600">|</span>
          <span>Zoom: {currentZoom}</span>
        </div>

        <div className="text-slate-500">
          {cursorCoords.lat.toFixed(3)}°, {cursorCoords.lng.toFixed(3)}° · z{currentZoom}
        </div>
      </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-sm lg:h-[760px] lg:overflow-y-auto">
        <section>
          <h2 className="text-sm font-semibold text-white">Map controls</h2>
          <p className="mt-1 text-[11px] text-slate-400">Filter and navigate active-fire observations.</p>
        </section>

        {FIRMS_DATA_MODE === 'synthetic' && (
          <div role="status" className="rounded-lg border border-amber-700/70 bg-amber-950/40 p-3 text-[11px] leading-relaxed text-amber-200">
            <strong className="mb-1 block uppercase tracking-wide">Development demo data</strong>
            All plotted observations are synthetic and use FIRMS-style fields. They are not real NASA detections and must not be used for scientific analysis.
          </div>
        )}
        <section className="space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sensor</h3>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => onSelectSensor('ALL_RAW')}
              aria-pressed={selectedSensor === 'ALL_RAW'}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                selectedSensor === 'ALL_RAW'
                  ? 'border-cyan-700 bg-cyan-950/50 text-cyan-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              All detections (raw)
            </button>
            <button
              onClick={() => onSelectSensor('MODIS')}
              aria-pressed={selectedSensor === 'MODIS'}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                selectedSensor === 'MODIS'
                  ? 'border-orange-800 bg-orange-950/40 text-orange-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              MODIS · 1 km
            </button>
            <button
              onClick={() => onSelectSensor('VIIRS')}
              aria-pressed={selectedSensor === 'VIIRS'}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                selectedSensor === 'VIIRS'
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              VIIRS · 375 m
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            The raw overlay shows original sensor detections together; it is not a harmonized or coverage-corrected product.
          </p>
        </section>

        <section className="space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Basemap</h3>
          <button
            onClick={() => setBasemapChoice(basemapChoice === 'dark' ? 'satellite' : 'dark')}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 transition hover:border-slate-700 hover:bg-slate-800"
          >
            {basemapChoice === 'dark' ? 'Switch to satellite imagery' : 'Switch to dark basemap'}
          </button>
        </section>

        <section className="space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Observations</h3>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-200">
              <span className={`h-2 w-2 rounded-full ${feedError ? 'bg-rose-400' : isLoadingFeed ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span>
                {isLoadingFeed ? 'Loading observations…'
                  : feedError ? FIRMS_DATA_MODE === 'real' ? 'NASA FIRMS unavailable' : 'Data unavailable'
                  : FIRMS_DATA_MODE === 'synthetic'
                    ? `${activeHotspots.length.toLocaleString()} synthetic demo records`
                    : FIRMS_DATA_MODE === 'local'
                      ? `${activeHotspots.length.toLocaleString()} local FIRMS detections`
                      : `${activeHotspots.length.toLocaleString()} NASA FIRMS detections`}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <span className="text-orange-300">MODIS: {modisCount.toLocaleString()}</span>
              <span className="text-emerald-300">VIIRS: {viirsCount.toLocaleString()}</span>
            </div>
          </div>
          {feedError && (
            <div role="alert" className="rounded-lg border border-rose-800/80 bg-rose-950/30 p-3 text-[11px] leading-relaxed text-rose-200">
              <strong className="mb-1 block">Could not load observations.</strong>
              <span>{feedError}</span>
            </div>
          )}
        </section>

        <FIRMSDateController
          currentDate={currentDate}
          onDateChange={(date) => {
            onDateChange(date);
            if (timeSpan === 'custom') setCustomEndDate(date);
          }}
          timeSpan={timeSpan}
          onTimeSpanChange={(span) => {
            if (span === 'custom' && timeSpan !== 'custom') {
              setCustomStartDate(currentDate);
              setCustomEndDate(currentDate);
            }
            setTimeSpan(span);
          }}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          onCustomRangeChange={(startDate, endDate) => {
            setCustomStartDate(startDate);
            setCustomEndDate(endDate);
            if (endDate) onDateChange(endDate);
          }}
          isCompareMode={isCompareMode}
          onToggleCompareMode={() => setIsCompareMode(!isCompareMode)}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          totalDetectionsOnDate={activeHotspots.length}
        />
      </aside>
    </div>
  );
};
