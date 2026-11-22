import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, Flame, Filter, Eye, Maximize2, Compass, Sparkles, Sliders, Info, ShieldCheck } from 'lucide-react';
import { HotspotObservation, RegionPreset, SensorType } from '../../types/fire';

interface FireMapProps {
  hotspots: HotspotObservation[];
  selectedRegion: RegionPreset;
  selectedSensor: SensorType;
  onSelectSensor: (sensor: SensorType) => void;
  onFilterChange?: (filtered: HotspotObservation[]) => void;
}

export const FireMap: React.FC<FireMapProps> = ({
  hotspots,
  selectedRegion,
  selectedSensor,
  onSelectSensor
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotObservation | null>(null);

  // Filters state
  const [minFRP, setMinFRP] = useState<number>(0);
  const [dayNightFilter, setDayNightFilter] = useState<'ALL' | 'D' | 'N'>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | 'HIGH'>('ALL');
  const [tileLayerType, setTileLayerType] = useState<'dark' | 'satellite'>('dark');
  const [showFootprintCircles, setShowFootprintCircles] = useState<boolean>(true);
  const [showBboxDrawer, setShowBboxDrawer] = useState<boolean>(false);
  
  // Custom Bounding Box state
  const [bboxCoords, setBboxCoords] = useState({
    north: selectedRegion.bounds[1][0],
    south: selectedRegion.bounds[0][0],
    east: selectedRegion.bounds[1][1],
    west: selectedRegion.bounds[0][1]
  });

  // Keep bbox coords updated when region changes
  useEffect(() => {
    setBboxCoords({
      north: selectedRegion.bounds[1][0],
      south: selectedRegion.bounds[0][0],
      east: selectedRegion.bounds[1][1],
      west: selectedRegion.bounds[0][1]
    });
  }, [selectedRegion]);

  // Tile layers URLs
  const tileUrls = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: selectedRegion.center,
        zoom: selectedRegion.zoom,
        zoomControl: false,
        attributionControl: false
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      const tileLayer = L.tileLayer(tileUrls[tileLayerType], {
        maxZoom: 18,
        subdomains: 'abcd'
      }).addTo(map);

      // Attribution
      L.control.attribution({
        position: 'bottomright',
        prefix: 'NASA FIRMS | CartoDB'
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map view when selected region changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView(selectedRegion.center, selectedRegion.zoom, {
        animate: true,
        duration: 1.2
      });
    }
  }, [selectedRegion]);

  // Update tile layer when tileLayerType changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapInstanceRef.current?.removeLayer(layer);
      }
    });

    L.tileLayer(tileUrls[tileLayerType], {
      maxZoom: 18,
      subdomains: 'abcd'
    }).addTo(mapInstanceRef.current);

    if (markersLayerRef.current) {
      markersLayerRef.current.addTo(mapInstanceRef.current);
    }
  }, [tileLayerType]);

  // Filter hotspots based on user controls
  const filteredHotspots = hotspots.filter((spot) => {
    // Sensor filter
    if (selectedSensor === 'MODIS' && spot.instrument !== 'MODIS') return false;
    if (selectedSensor === 'VIIRS' && spot.instrument !== 'VIIRS') return false;
    
    // FRP filter
    if (spot.frp < minFRP) return false;

    // Day/Night filter
    if (dayNightFilter !== 'ALL' && spot.daynight !== dayNightFilter) return false;

    // Confidence filter
    if (confidenceFilter === 'HIGH') {
      if (typeof spot.confidence === 'number' && spot.confidence < 75) return false;
      if (spot.confidence === 'low' || spot.confidence === 'nominal') return false;
    }

    return true;
  });

  // Render markers onto the map
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    filteredHotspots.forEach((spot) => {
      const isModis = spot.instrument === 'MODIS';

      const fillColor = isModis ? '#f59e0b' : '#10b981';

      // Marker radius based on FRP intensity
      const radius = Math.min(14, Math.max(4, Math.log10(spot.frp + 1) * 4));

      // Hotspot circle marker
      const marker = L.circleMarker([spot.latitude, spot.longitude], {
        radius,
        fillColor,
        color: '#ffffff',
        weight: 1,
        opacity: 0.9,
        fillOpacity: 0.8
      });

      // Swath footprint geometry visualization (swelling at swath edges)
      if (showFootprintCircles) {
        // Approximate pixel footprint in meters: scan * 1000m
        const footprintMeters = isModis ? (spot.scan * 1000) / 2 : (spot.scan * 1000) / 2;
        const footprintCircle = L.circle([spot.latitude, spot.longitude], {
          radius: footprintMeters,
          color: isModis ? '#f59e0b' : '#10b981',
          weight: 0.8,
          opacity: 0.35,
          fillColor: isModis ? '#f59e0b' : '#10b981',
          fillOpacity: 0.08,
          dashArray: isModis ? '4, 4' : undefined
        });
        markersLayerRef.current?.addLayer(footprintCircle);
      }

      marker.on('click', () => {
        setSelectedHotspot(spot);
      });

      markersLayerRef.current?.addLayer(marker);
    });
  }, [filteredHotspots, selectedSensor, showFootprintCircles]);

  // Apply custom BBOX
  const handleApplyBbox = () => {
    if (mapInstanceRef.current) {
      const bounds = L.latLngBounds(
        L.latLng(bboxCoords.south, bboxCoords.west),
        L.latLng(bboxCoords.north, bboxCoords.east)
      );
      mapInstanceRef.current.fitBounds(bounds, { animate: true, padding: [30, 30] });
      setShowBboxDrawer(false);
    }
  };

  return (
    <div className="relative w-full h-[700px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl flex flex-col">
      
      {/* Top Map Action Bar */}
      <div className="absolute top-3 left-3 right-16 z-[400] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        
        {/* Left: Quick Sensor & Base Layer Bar */}
        <div className="flex items-center gap-2 pointer-events-auto bg-slate-950/85 backdrop-blur-md p-1.5 rounded-xl border border-slate-800/90 shadow-lg">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSelectSensor('MODIS')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                selectedSensor === 'MODIS'
                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              MODIS
            </button>
            <button
              onClick={() => onSelectSensor('VIIRS')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                selectedSensor === 'VIIRS'
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              VIIRS
            </button>
            <button
              onClick={() => onSelectSensor('ALL_RAW')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                selectedSensor === 'ALL_RAW'
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3 h-3 text-cyan-400" />
              All raw
            </button>
          </div>

          <div className="h-4 w-[1px] bg-slate-800 mx-1"></div>

          {/* Basemap Toggle */}
          <div className="flex items-center text-xs">
            <button
              onClick={() => setTileLayerType(tileLayerType === 'dark' ? 'satellite' : 'dark')}
              className="text-slate-300 hover:text-white px-2 py-1 rounded-md bg-slate-900 border border-slate-700/60 flex items-center gap-1"
              title="Toggle CartoDB Dark vs Esri High-Resolution Satellite Base"
            >
              <Eye className="w-3 h-3 text-cyan-400" />
              <span>{tileLayerType === 'dark' ? 'Satellite' : 'Dark Space'}</span>
            </button>
          </div>

          {/* Pixel Footprint Circle Toggle */}
          <button
            onClick={() => setShowFootprintCircles(!showFootprintCircles)}
            className={`px-2 py-1 rounded-md text-xs border flex items-center gap-1 transition-all ${
              showFootprintCircles
                ? 'bg-purple-950/70 border-purple-600/70 text-purple-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
            title="Display instrument ground footprint envelopes (showing scan-angle distortion)"
          >
            <Compass className="w-3 h-3" />
            <span>Footprints</span>
          </button>
        </div>

        {/* Right: Coordinates & Bounding Box Drawer Trigger */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setShowBboxDrawer(!showBboxDrawer)}
            className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800/90 text-xs text-slate-200 hover:text-cyan-300 hover:border-cyan-800/80 shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Select Coordinates / BBOX</span>
          </button>

          <div className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800/90 text-xs font-mono text-cyan-400 shadow-lg">
            <span>{filteredHotspots.length} Active Detections</span>
          </div>
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Custom Coordinates BBOX Drawer Modal */}
      {showBboxDrawer && (
        <div className="absolute top-16 right-4 z-[450] w-80 bg-slate-950/95 backdrop-blur-md border border-cyan-800/80 rounded-xl p-4 shadow-2xl">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-cyan-400" />
              Geographical Coordinates Filter
            </h4>
            <button
              onClick={() => setShowBboxDrawer(false)}
              className="text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <p className="text-[11px] text-slate-400 mb-3">
            Specify bounding box coordinates in decimal degrees to crop observations:
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">North Lat (°)</label>
              <input
                type="number"
                step="0.1"
                value={bboxCoords.north}
                onChange={(e) => setBboxCoords({ ...bboxCoords, north: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">South Lat (°)</label>
              <input
                type="number"
                step="0.1"
                value={bboxCoords.south}
                onChange={(e) => setBboxCoords({ ...bboxCoords, south: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">West Lng (°)</label>
              <input
                type="number"
                step="0.1"
                value={bboxCoords.west}
                onChange={(e) => setBboxCoords({ ...bboxCoords, west: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">East Lng (°)</label>
              <input
                type="number"
                step="0.1"
                value={bboxCoords.east}
                onChange={(e) => setBboxCoords({ ...bboxCoords, east: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setBboxCoords({
                  north: selectedRegion.bounds[1][0],
                  south: selectedRegion.bounds[0][0],
                  east: selectedRegion.bounds[1][1],
                  west: selectedRegion.bounds[0][1]
                });
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200 px-2.5 py-1"
            >
              Reset to Region
            </button>
            <button
              onClick={handleApplyBbox}
              className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow cursor-pointer"
            >
              Apply Filter
            </button>
          </div>
        </div>
      )}

      {/* Floating Filter Drawer at Bottom-Left */}
      <div className="absolute bottom-4 left-4 z-[400] bg-slate-950/90 backdrop-blur-md border border-slate-800/90 rounded-xl p-3 shadow-2xl max-w-sm w-full">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200 mb-2 pb-1.5 border-b border-slate-800">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            Detection &amp; Radiometry Filters
          </span>
          <span className="text-[10px] text-cyan-400 font-mono font-normal">
            {filteredHotspots.length} shown
          </span>
        </div>

        {/* Min FRP Slider */}
        <div className="mb-2.5">
          <div className="flex justify-between text-[11px] text-slate-300 mb-1">
            <span>Min Fire Radiative Power:</span>
            <span className="font-mono text-amber-400 font-bold">{minFRP} MW</span>
          </div>
          <input
            type="range"
            min="0"
            max="150"
            step="5"
            value={minFRP}
            onChange={(e) => setMinFRP(Number(e.target.value))}
            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
            <span>0 MW (VIIRS fine)</span>
            <span>50 MW</span>
            <span>150 MW (Intense)</span>
          </div>
        </div>

        {/* Orbit Pass and Confidence Quick Filters */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Orbit Pass</label>
            <select
              value={dayNightFilter}
              onChange={(e) => setDayNightFilter(e.target.value as any)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
            >
              <option value="ALL">Day &amp; Night Passes</option>
              <option value="D">Daytime Only (D)</option>
              <option value="N">Nighttime Only (N)</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Quality Confidence</label>
            <select
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as any)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
            >
              <option value="ALL">All Valid Passes</option>
              <option value="HIGH">High Confidence Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Map Legend (Bottom-Right) */}
      <div className="absolute bottom-4 right-4 z-[400] bg-slate-950/90 backdrop-blur-md border border-slate-800/90 rounded-xl p-3 shadow-2xl text-xs w-64">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200 mb-2 pb-1 border-b border-slate-800">
          <Info className="w-3.5 h-3.5 text-cyan-400" />
          <span>Legend &amp; Footprint Scale</span>
        </div>

        {/* Sensor Color Keys */}
        <div className="space-y-1.5 text-[11px] mb-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
              MODIS (Terra/Aqua)
            </span>
            <span className="font-mono text-slate-400 text-[10px]">1000m (±4.8km)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
              VIIRS (S-NPP/N20)
            </span>
            <span className="font-mono text-slate-400 text-[10px]">375m (±0.8km)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
              Harmonized Standard
            </span>
            <span className="font-mono text-slate-400 text-[10px]">0.1° Unified</span>
          </div>
        </div>

        {/* FRP Energy Gradient */}
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Low FRP (&lt;10 MW)</span>
            <span>Extreme (&gt;200 MW)</span>
          </div>
          <div className="h-2 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-600 w-full"></div>
        </div>
      </div>

      {/* Selected Hotspot Detailed Telemetry Inspector Drawer */}
      {selectedHotspot && (
        <div className="absolute top-16 left-4 z-[450] w-96 bg-slate-950/95 backdrop-blur-md border border-cyan-700/80 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-left duration-200">
          <div className="flex items-start justify-between pb-2 mb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  selectedHotspot.instrument === 'MODIS'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}>
                  {selectedHotspot.satellite} ({selectedHotspot.instrument})
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {selectedHotspot.acqDate} {selectedHotspot.acqTime} UTC
                </span>
              </div>
              <h3 className="text-base font-bold text-white mt-1 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400" />
                Hotspot Observation Telemetry
              </h3>
            </div>
            <button
              onClick={() => setSelectedHotspot(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Raw Sensor Attributes */}
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Coordinates</span>
              <span className="font-mono text-slate-200 font-medium">
                {selectedHotspot.latitude.toFixed(4)}°, {selectedHotspot.longitude.toFixed(4)}°
              </span>
            </div>

            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Fire Radiative Power</span>
              <span className="font-mono text-amber-400 font-bold text-sm">
                {selectedHotspot.frp} MW
              </span>
            </div>

            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Brightness Temp</span>
              <span className="font-mono text-slate-200 font-medium">
                {selectedHotspot.brightness} K ({Math.round(selectedHotspot.brightness - 273.15)}°C)
              </span>
            </div>

            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Footprint Size</span>
              <span className="font-mono text-slate-200 font-medium">
                {selectedHotspot.scan} × {selectedHotspot.track} km
              </span>
            </div>

            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Confidence Level</span>
              <span className="font-mono text-cyan-300 font-medium">
                {selectedHotspot.confidence}
              </span>
            </div>

            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Day / Night Pass</span>
              <span className="font-mono text-slate-200 font-medium">
                {selectedHotspot.daynight === 'D' ? 'Day (Solar Illumination)' : 'Night (Thermal Only)'}
              </span>
            </div>
          </div>

          {/* Harmonized Transformation Box */}
          <div className="bg-gradient-to-br from-cyan-950/60 to-blue-950/60 p-3 rounded-xl border border-cyan-800/80">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Harmonization Cross-Calibration</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-cyan-400/80 block">Statistical Weight:</span>
                <span className="font-mono text-slate-100 font-bold">
                  {selectedHotspot.harmonizedWeight}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-cyan-400/80 block">Calibrated FRP:</span>
                <span className="font-mono text-cyan-300 font-bold">
                  {selectedHotspot.harmonizedFRP} MW
                </span>
              </div>
              <div className="col-span-2 pt-1 border-t border-cyan-900/60 flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Equivalent Fire Units:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {selectedHotspot.equivalentFireUnits} EFU
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
