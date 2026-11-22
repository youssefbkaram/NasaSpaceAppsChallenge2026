import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, BrainCircuit, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import type { RegionPreset } from '../../types/fire';
import {
  COSMO_ANALYSIS_ENABLED,
  requestCosmoAnalysis,
  summarizeFireData,
  type CosmoAnalysis,
  type FireDataSummary
} from '../../services/cosmoAnalysisService';
import { fetchNASAObservations } from '../../services/firmsDataService';

interface AIAnalyzerProps {
  selectedRegion: RegionPreset;
  defaultDate: string;
}

const TODAY = new Date().toISOString().slice(0, 10);
const EARLIEST_DATE = '2000-11-01';
const MAX_RANGE_DAYS = 90;

function shiftDate(dateValue: string, offset: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function earliestQuickEndDate(dayCount: number): string {
  return shiftDate(EARLIEST_DATE, dayCount - 1);
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function AnalysisDashboard({
  analysis,
  data,
  aiUnavailableMessage
}: {
  analysis?: CosmoAnalysis;
  data: FireDataSummary;
  aiUnavailableMessage?: string;
}) {
  return (
    <section className="space-y-4" aria-live="polite">
      <div className="rounded-2xl border border-cyan-900/70 bg-gradient-to-br from-slate-950 to-cyan-950/30 p-5">
        <div className="flex items-center gap-2 text-cyan-300">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-medium">
            {analysis ? 'AI interpretation of supplied fire detections' : 'Fire-data summary calculated in your browser'}
          </span>
        </div>
        <h2 className="mt-3 text-xl font-semibold text-white">
          {analysis?.headline ?? 'Observation summary'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {analysis?.summary ??
            'The metrics below summarize the selected NASA FIRMS point detections. They are not a count of unique fires.'}
        </p>
        <p className="mt-3 text-[11px] text-slate-500">
          {data.region} · {data.startDate} to {data.endDate} · {data.observationCount.toLocaleString()} point detections
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          Sources: {Object.entries(data.byDataOrigin).map(([source, count]) => `${source} ${count.toLocaleString()}`).join(' · ')}
          {' · '}Quality: {Object.entries(data.byQuality).map(([quality, count]) => `${quality} ${count.toLocaleString()}`).join(' · ')}
        </p>
      </div>

      {aiUnavailableMessage && (
        <div role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-xs leading-5 text-amber-100">
          <strong className="block font-semibold text-amber-300">AI interpretation unavailable</strong>
          <span>{aiUnavailableMessage}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Point detections" value={data.observationCount.toLocaleString()} detail="Not a count of unique fires" />
        <MetricCard label="MODIS detections" value={(data.byInstrument.MODIS ?? 0).toLocaleString()} detail="Raw sensor-specific count" />
        <MetricCard label="VIIRS detections" value={(data.byInstrument.VIIRS ?? 0).toLocaleString()} detail="Raw sensor-specific count" />
        <MetricCard
          label="Median FRP"
          value={data.frpMw.median === null ? '—' : `${data.frpMw.median.toFixed(1)} MW`}
          detail="Across supplied detections"
        />
      </div>

      {analysis && analysis.findings.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {analysis.findings.map((finding, index) => (
            <article key={`${finding.title}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${
                  finding.level === 'notable' ? 'bg-orange-400' : finding.level === 'caution' ? 'bg-amber-400' : 'bg-cyan-400'
                }`} />
                <h3 className="text-sm font-semibold text-white">{finding.title}</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-300">{finding.detail}</p>
            </article>
          ))}
        </div>
      )}

      {analysis && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Limitations</h3>
            <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-300">
              {analysis.limitations.map((limitation, index) => <li key={`${limitation}-${index}`}>• {limitation}</li>)}
            </ul>
          </div>
          {analysis.recommendations.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Suggested next steps</h3>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-300">
                {analysis.recommendations.map((recommendation, index) => <li key={`${recommendation}-${index}`}>• {recommendation}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AIAnalyzer({ selectedRegion, defaultDate }: AIAnalyzerProps) {
  const [period, setPeriod] = useState<'1' | '3' | '7' | 'custom'>('1');
  const [quickEndDate, setQuickEndDate] = useState(defaultDate);
  const [customStartDate, setCustomStartDate] = useState(defaultDate);
  const [customEndDate, setCustomEndDate] = useState(defaultDate);
  const [userQuestion, setUserQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    analysis?: CosmoAnalysis;
    data: FireDataSummary;
    aiUnavailableMessage?: string;
  } | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const quickDayCount = period === 'custom' ? 1 : Number(period);
  const startDate = period === 'custom' ? customStartDate : shiftDate(quickEndDate, 1 - quickDayCount);
  const endDate = period === 'custom' ? customEndDate : quickEndDate;
  const dayCount = inclusiveDayCount(startDate, endDate);
  const validDateRange = startDate >= EARLIEST_DATE &&
    endDate <= TODAY &&
    dayCount >= 1 &&
    dayCount <= MAX_RANGE_DAYS;

  useEffect(() => () => requestController.current?.abort(), []);

  const selectPeriod = (nextPeriod: '1' | '3' | '7' | 'custom') => {
    if (nextPeriod === 'custom') {
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
    } else if (period === 'custom') {
      setQuickEndDate(customEndDate);
    }
    setPeriod(nextPeriod);
  };

  const runAnalysis = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validDateRange) {
      setError(`Choose a valid date range of 1–${MAX_RANGE_DAYS} days, from ${EARLIEST_DATE} through today.`);
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const observations = await fetchNASAObservations(startDate, selectedRegion, dayCount, controller.signal);
      if (!observations.length) {
        throw new Error('No observations were returned for this region and period. Try another date range.');
      }
      const data = summarizeFireData(selectedRegion, observations, startDate, dayCount);
      if (!COSMO_ANALYSIS_ENABLED) {
        if (!controller.signal.aborted) {
          setResult({
            data,
            aiUnavailableMessage: 'This static deployment does not send data to an AI service. A server-side COSMO backend is required for AI interpretation.'
          });
        }
        return;
      }

      try {
        const analysis = await requestCosmoAnalysis(data, userQuestion, controller.signal);
        if (!controller.signal.aborted) setResult({ analysis, data });
      } catch (caught) {
        if (!controller.signal.aborted) {
          setResult({
            data,
            aiUnavailableMessage: caught instanceof Error
              ? `Your data summary is ready, but COSMO could not interpret it: ${caught.message}`
              : 'Your data summary is ready, but COSMO could not complete the interpretation.'
          });
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'The analysis could not be completed.');
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Fire Data AI Analyzer</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              Select a region in the header, then choose a quick period or a custom date range (up to 90 days). Dashboard metrics are calculated from the retrieved data; a configured server-side COSMO backend can provide an additional interpretation.
            </p>
          </div>
        </div>

        <form onSubmit={runAnalysis} className="mt-5 space-y-4">
          <div>
            <span className="text-xs text-slate-300">Analysis period (UTC)</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {([
                ['1', '24 hours'],
                ['3', '3 days'],
                ['7', '7 days'],
                ['custom', 'Custom range']
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectPeriod(value)}
                  aria-pressed={period === value}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    period === value
                      ? 'border-cyan-500 bg-cyan-950/60 text-cyan-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {period === 'custom' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                From
                <input
                  type="date"
                  required
                  min={EARLIEST_DATE}
                  max={customEndDate}
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs text-slate-300">
                To
                <input
                  type="date"
                  required
                  min={customStartDate}
                  max={TODAY}
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
              <p className={`text-xs sm:col-span-2 ${validDateRange ? 'text-slate-500' : 'text-amber-300'}`}>
                {validDateRange
                  ? `${dayCount} ${dayCount === 1 ? 'day' : 'days'} selected`
                  : `Choose a range of 1–${MAX_RANGE_DAYS} days, ending no later than today.`}
              </p>
            </div>
          ) : (
            <label className="block text-xs text-slate-300">
              End date (UTC)
              <input
                type="date"
                required
                min={earliestQuickEndDate(quickDayCount)}
                max={TODAY}
                value={quickEndDate}
                onChange={(event) => setQuickEndDate(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
              <span className="mt-1 block text-[10px] text-slate-500">
                Covers {startDate} through {endDate} ({dayCount} {dayCount === 1 ? 'day' : 'days'})
              </span>
            </label>
          )}

          <label className="block text-xs text-slate-300">
            Optional question or focus
            <textarea
              value={userQuestion}
              onChange={(event) => setUserQuestion(event.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              placeholder="For example: Compare the daily patterns, while accounting for the sensor differences."
              className="mt-1 block w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <span className="mt-1 block text-right text-[10px] text-slate-500">{userQuestion.length}/500</span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-[11px] leading-4 text-slate-500">
              {COSMO_ANALYSIS_ENABLED
                ? 'COSMO receives aggregate metrics, up to 20 highest-FRP example points, and your optional question—not the full observation file. Its AI-generated interpretation may be imperfect.'
                : 'Metrics are calculated locally in your browser. AI interpretation is disabled here; no API key or observation data is sent to an AI service.'}
            </p>
            <button
              type="submit"
              disabled={isLoading || !validDateRange}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isLoading ? 'Analyzing…' : COSMO_ANALYSIS_ENABLED ? 'Analyze fire data' : 'Summarize fire data'}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-900/70 bg-rose-950/30 p-3 text-xs text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {result && (
        <AnalysisDashboard
          analysis={result.analysis}
          data={result.data}
          aiUnavailableMessage={result.aiUnavailableMessage}
        />
      )}
    </div>
  );
}
