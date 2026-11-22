import React from 'react';
import { AlertTriangle, BookOpen, Database, Satellite, X } from 'lucide-react';

interface HarmonizationExplainerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HarmonizationExplainer: React.FC<HarmonizationExplainerProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-cyan-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 p-5">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-bold text-white">Data and methodology status</h2>
              <p className="text-xs text-slate-400">What this prototype does—and does not—claim</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close methodology dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6 text-sm leading-relaxed text-slate-300">
          <section className="rounded-xl border border-cyan-900/70 bg-slate-900/60 p-4">
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-cyan-300">
              <Database className="h-4 w-4" />
              Observation source
            </h3>
            <p className="text-xs">
              The map requests date- and region-filtered active-fire detections from the NASA FIRMS Area API.
              MODIS starts on 2000-11-01; VIIRS sensors are included only after their product start dates.
              FIRMS processing quality (standard processing or near-real-time) is retained with each observation.
            </p>
            <a
              className="mt-2 inline-block text-xs text-cyan-300 underline"
              href="https://firms.modaps.eosdis.nasa.gov/api/area/"
              target="_blank"
              rel="noreferrer"
            >
              NASA FIRMS Area API documentation
            </a>
          </section>

          <section className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4">
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              Important interpretation limits
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>A hotspot is a satellite fire/thermal-anomaly detection, not necessarily a unique fire.</li>
              <li>MODIS and VIIRS have different spatial resolutions, overpass characteristics, and detection sensitivities. Their raw counts should not be added as if they were directly comparable.</li>
              <li>This prototype displays original FIRMS values. It does not currently apply or validate a cross-sensor harmonization method, anomaly model, or forecast.</li>
              <li>Standard-processing data can lag observations; the map labels NRT versus SP and reports unavailable API responses rather than substituting generated points.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-200">
              <Satellite className="h-4 w-4 text-emerald-400" />
              Harmonization work still required
            </h3>
            <p className="text-xs">
              A defensible comparison needs sensor-specific quality control, preserved source metadata, spatial and temporal matching,
              overlap-period validation, and uncertainty estimates. The calendar and statistical summary views remain disabled until
              they can be calculated from the source observations with a documented method.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
