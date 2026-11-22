import React from 'react';
import { Flame } from 'lucide-react';
import { FIRMS_DATA_MODE } from '../services/firmsDataService';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-8 border-t border-slate-800/80 bg-slate-950/60 text-slate-400 text-xs py-6 px-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-400">
        
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500 fill-current" />
          <span className="font-medium text-slate-200">NASA Space Apps Challenge 2026</span>
          <span className="text-slate-600">•</span>
          <span>Harmonization of MODIS &amp; VIIRS Hot Spots</span>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span>
            {FIRMS_DATA_MODE === 'synthetic'
              ? 'Synthetic FIRMS-format development data — not NASA observations'
              : FIRMS_DATA_MODE === 'local'
                ? 'NASA FIRMS MODIS & VIIRS — local country downloads'
              : 'Observations: NASA FIRMS MODIS & VIIRS'}
          </span>
          <span>•</span>
          <span>Open Science Initiative</span>
        </div>

      </div>
    </footer>
  );
};
