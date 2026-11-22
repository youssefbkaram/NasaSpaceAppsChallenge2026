import React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Pause, Play, Split } from 'lucide-react';
import {
  FIRMS_DATA_END_DATE,
  FIRMS_DATA_START_DATE,
  MAX_FIRMS_QUERY_DAYS
} from '../../data/firmsDataAvailability';

type TimeSpan = '24h' | '3d' | '7d' | 'custom';

interface FIRMSDateControllerProps {
  currentDate: string;
  onDateChange: (newDate: string) => void;
  timeSpan: TimeSpan;
  onTimeSpanChange: (span: TimeSpan) => void;
  customStartDate: string;
  customEndDate: string;
  onCustomRangeChange: (startDate: string, endDate: string) => void;
  isCompareMode: boolean;
  onToggleCompareMode: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  totalDetectionsOnDate: number;
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export const FIRMSDateController: React.FC<FIRMSDateControllerProps> = ({
  currentDate,
  onDateChange,
  timeSpan,
  onTimeSpanChange,
  customStartDate,
  customEndDate,
  onCustomRangeChange,
  isCompareMode,
  onToggleCompareMode,
  isPlaying,
  onTogglePlay,
  totalDetectionsOnDate
}) => {
  const customDays = inclusiveDays(customStartDate, customEndDate);
  const validCustomRange = customDays > 0 &&
    customDays <= MAX_FIRMS_QUERY_DAYS &&
    customStartDate >= FIRMS_DATA_START_DATE &&
    customEndDate <= FIRMS_DATA_END_DATE;

  const changeEndDate = (date: string) => {
    if (!date) return;
    onDateChange(date);
    if (timeSpan === 'custom') onCustomRangeChange(customStartDate, date);
  };

  const stepDay = (offset: number) => {
    const nextDate = addDays(currentDate, offset);
    if (nextDate < FIRMS_DATA_START_DATE || nextDate > FIRMS_DATA_END_DATE) return;
    changeEndDate(nextDate);
  };

  return (
    <div className="relative flex w-full flex-col items-stretch gap-3">
      <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-3 shadow-xl backdrop-blur-md">
        <div className="grid grid-cols-4 items-center rounded-lg border border-slate-800/80 bg-slate-900 p-0.5 text-xs">
          {([
            ['24h', '24h'],
            ['3d', '3 days'],
            ['7d', '7 days'],
            ['custom', 'Custom']
          ] as const).map(([span, label]) => (
            <button
              key={span}
              type="button"
              onClick={() => onTimeSpanChange(span)}
              aria-pressed={timeSpan === span}
              className={`rounded px-1.5 py-1.5 text-[11px] font-medium transition ${
                timeSpan === span ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {timeSpan === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-slate-400">
              From (UTC)
              <input
                type="date"
                aria-label="Custom date from"
                min={FIRMS_DATA_START_DATE}
                max={customEndDate || FIRMS_DATA_END_DATE}
                value={customStartDate}
                onChange={(event) => onCustomRangeChange(event.target.value, customEndDate)}
                className="mt-1 block w-full min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-xs text-white"
              />
            </label>
            <label className="block text-[10px] text-slate-400">
              To (UTC)
              <input
                type="date"
                aria-label="Custom date to"
                min={customStartDate || FIRMS_DATA_START_DATE}
                max={FIRMS_DATA_END_DATE}
                value={customEndDate}
                onChange={(event) => {
                  if (event.target.value) onDateChange(event.target.value);
                  onCustomRangeChange(customStartDate, event.target.value);
                }}
                className="mt-1 block w-full min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-xs text-white"
              />
            </label>
            <p className={`col-span-2 text-[10px] ${validCustomRange ? 'text-slate-500' : 'text-rose-300'}`}>
              {validCustomRange
                ? `${customStartDate} — ${customEndDate} · ${customDays} ${customDays === 1 ? 'day' : 'days'}`
                : `Choose a valid inclusive range of 1–${MAX_FIRMS_QUERY_DAYS} days through ${FIRMS_DATA_END_DATE}.`}
            </p>
          </div>
        )}

        <label className="block text-[10px] text-slate-400">
          {timeSpan === 'custom' ? 'Range end date (UTC)' : 'Observation date (UTC)'}
          <div className="mt-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => stepDay(-1)}
              aria-label="Previous day"
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="relative min-w-0 flex-1">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-orange-400" />
              <input
                type="date"
                aria-label="Observation end date"
                min={FIRMS_DATA_START_DATE}
                max={FIRMS_DATA_END_DATE}
                value={currentDate}
                onChange={(event) => changeEndDate(event.target.value)}
                className="block w-full min-w-0 rounded-lg border border-slate-800 bg-slate-900 py-2 pl-8 pr-2 text-xs font-mono text-slate-200"
              />
            </div>
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-1.5 text-[10px] text-slate-400">
              {totalDetectionsOnDate.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => stepDay(1)}
              aria-label="Next day"
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </label>

        <button
          type="button"
          onClick={onTogglePlay}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
            isPlaying
              ? 'border-rose-800 bg-rose-950 text-rose-300'
              : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
          title="Time-lapse animation"
        >
          {isPlaying ? (
            <>
              <Pause className="h-3.5 w-3.5 fill-current" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current text-emerald-400" />
              Play
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCompareMode}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
            isCompareMode
              ? 'border-transparent bg-orange-600 text-white'
              : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
          title="Compare sensors with swipe"
        >
          <Split className="h-3.5 w-3.5" />
          {isCompareMode ? 'Done' : 'Swipe'}
        </button>
      </div>
    </div>
  );
};
