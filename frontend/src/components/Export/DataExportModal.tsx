import React, { useState } from 'react';
import { CheckCircle2, Database, Download, FileSpreadsheet, X } from 'lucide-react';
import { HotspotObservation, RegionPreset } from '../../types/fire';

interface DataExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotspots: HotspotObservation[];
  selectedRegion: RegionPreset;
}

type ExportFormat = 'csv' | 'geojson';

function csvValue(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const DataExportModal: React.FC<DataExportModalProps> = ({
  isOpen,
  onClose,
  hotspots,
  selectedRegion
}) => {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (hotspots.length === 0) return;

    const isSynthetic = hotspots.some((spot) => spot.dataOrigin === 'synthetic');
    const isLocal = hotspots.some((spot) => spot.dataOrigin === 'NASA FIRMS local');
    const dateStamp = new Date().toISOString().slice(0, 10);
    const metadata = [
      isSynthetic
        ? '# Source: Synthetic development demo; FIRMS-format fields, not NASA observations'
        : isLocal ? '# Source: NASA FIRMS country download files (local archive/NRT extracts)' : '# Source: NASA FIRMS Area API',
      `# Region: ${selectedRegion.name}`,
      '# Coordinates: EPSG:4326',
      isSynthetic
        ? '# SYNTHETIC DATA ONLY: do not interpret as real detections or use for scientific analysis.'
        : '# These are active-fire detections, not unique fires; MODIS and VIIRS are not harmonized. NRT records are provisional.',
      `# Downloaded: ${new Date().toISOString()}`,
      '#'
    ].join('\n');

    let content: string;
    let mimeType: string;
    let filename: string;

    if (exportFormat === 'csv') {
      const columns = [
        'latitude', 'longitude', 'brightness', 'scan', 'track', 'acq_date',
        'acq_time', 'satellite', 'instrument', 'confidence', 'version',
        'quality', 'bright_t31', 'frp', 'daynight', 'type', 'country'
      ];
      const rows = hotspots.map((spot) => [
        spot.latitude, spot.longitude, spot.brightness, spot.scan, spot.track,
        spot.acqDate, spot.acqTime, spot.satellite, spot.instrument,
        spot.confidence, spot.version, spot.quality, spot.brightT31,
        spot.frp, spot.daynight, spot.type, spot.country
      ].map(csvValue).join(','));

      content = `${metadata}\n${columns.join(',')}\n${rows.join('\n')}`;
      mimeType = 'text/csv;charset=utf-8;';
      filename = `${isSynthetic ? 'Synthetic_FIRMS_Format_Demo' : isLocal ? `NASA_FIRMS_${selectedRegion.id}_Local` : 'NASA_FIRMS_Detections'}_${dateStamp}.csv`;
    } else {
      content = JSON.stringify({
        type: 'FeatureCollection',
        properties: {
          source: isSynthetic ? 'Synthetic FIRMS-format development demo' : isLocal ? 'NASA FIRMS Egypt download files' : 'NASA FIRMS Area API',
          region: selectedRegion.name,
          coordinateReferenceSystem: 'EPSG:4326',
          note: isSynthetic
            ? 'Synthetic data only; not NASA observations and not suitable for scientific analysis.'
            : 'Active-fire detections are not unique fires; MODIS and VIIRS are not harmonized.'
        },
        features: hotspots.map((spot) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [spot.longitude, spot.latitude]
          },
          properties: {
            id: spot.id,
            satellite: spot.satellite,
            instrument: spot.instrument,
            acqDate: spot.acqDate,
            acqTime: spot.acqTime,
            brightness: spot.brightness,
            scan: spot.scan,
            track: spot.track,
            confidence: spot.confidence,
            version: spot.version,
            quality: spot.quality,
            brightT31: spot.brightT31,
            frp: spot.frp,
            daynight: spot.daynight,
            type: spot.type,
            country: spot.country
          }
        }))
      }, null, 2);
      mimeType = 'application/geo+json;charset=utf-8;';
      filename = `${isSynthetic ? 'Synthetic_FIRMS_Format_Demo' : isLocal ? `NASA_FIRMS_${selectedRegion.id}_Local` : 'NASA_FIRMS_Detections'}_${dateStamp}.geojson`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 4000);
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-xl space-y-5 rounded-2xl border border-cyan-800 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-800 bg-cyan-950 text-cyan-400">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{hotspots.some((spot) => spot.dataOrigin === 'synthetic') ? 'Export FIRMS-format demo records' : hotspots.some((spot) => spot.dataOrigin === 'NASA FIRMS local') ? `Export local ${selectedRegion.name} FIRMS observations` : 'Export NASA FIRMS observations'}</h3>
              <p className="text-[11px] text-slate-400">Records currently loaded on the map</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close export dialog">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5 text-xs">
          <p className="text-slate-300">{hotspots.length.toLocaleString()} {hotspots.some((spot) => spot.dataOrigin === 'synthetic') ? 'synthetic demo records' : 'FIRMS detections'} loaded.</p>
          <button
            type="button"
            onClick={() => setExportFormat('csv')}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
              exportFormat === 'csv' ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-slate-900/60'
            }`}
          >
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
            <span>
              <span className="block font-bold text-slate-200">{hotspots.some((spot) => spot.dataOrigin === 'synthetic') ? 'FIRMS-format demo CSV' : 'CSV observations'}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">Sensor-style values and FIRMS-compatible fields, without generated harmonization fields.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setExportFormat('geojson')}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
              exportFormat === 'geojson' ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-slate-900/60'
            }`}
          >
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <span>
              <span className="block font-bold text-slate-200">{hotspots.some((spot) => spot.dataOrigin === 'synthetic') ? 'FIRMS-format demo GeoJSON' : 'GeoJSON observations'}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">Point features with FIRMS-compatible properties.</span>
            </span>
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          {hotspots.some((spot) => spot.dataOrigin === 'synthetic')
            ? 'This file contains entirely fake demo records. It is not NASA data and must not be used as evidence or for scientific conclusions.'
            : 'Detections are not necessarily unique fires. MODIS and VIIRS observations in this export are not harmonized.'}
        </p>

        {downloadSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/80 p-2.5 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Download created.
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
          <button onClick={onClose} className="px-4 py-2 text-xs text-slate-400 hover:text-white">Cancel</button>
          <button
            onClick={handleDownload}
            disabled={hotspots.length === 0}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download data
          </button>
        </div>
      </div>
    </div>
  );
};
