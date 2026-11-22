# NASA Space Apps Challenge 2026 — PSR B0531+21

An interactive platform for exploring NASA FIRMS MODIS and VIIRS active-fire detections. The map displays raw observations; it does **not** claim that sensor differences have been scientifically harmonized.

## Current features

- **Interactive map:** Leaflet map with country, sensor, and basemap controls. Selecting a hotspot opens its metadata in a popup anchored above the point, including acquisition time, coordinates, confidence, FRP, brightness, and processing quality.
- **Date filters:** Quick 24-hour, 3-day, and 7-day periods plus a custom inclusive start/end range of up to 90 days. All observation queries are limited to 2000-11-01 through 2026-11-13, inclusive.
- **Real FIRMS observations:** Local mode reads the supplied NASA FIRMS downloads and avoids consuming live API request limits. Local product coverage varies by country and date. Live NASA API mode remains available but is subject to NASA rate limits.
- **Separate sensor views:** MODIS and VIIRS detections remain identifiable; their combined display is a raw overlay, not a harmonized count.
- **AI analysis:** Select a region and period, optionally ask a question, and review a structured analysis based on computed summary metrics. AI output is interpretive, not a validated scientific conclusion.
- **Data export:** Export filtered point observations as CSV or GeoJSON.

Scientific harmonization, validated forecasts, and validated anomaly products are not currently provided by this explorer. Some legacy analytics are illustrative and are not evidence of real satellite-derived results; see the data notes below before using them.

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Mapping**: Leaflet
- **Styling**: Tailwind CSS, PostCSS, Custom Space Theme Design System
- **Build Tool**: Vite

---

## 💻 Running the Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173) in your browser.

### FIRMS data source and date coverage

The supported observation interval is **2000-11-01 through 2026-11-13,
inclusive**. The map, AI Analyzer, and data services reject ranges outside
that interval, regardless of the configured FIRMS source.

With `VITE_FIRMS_DATA_MODE=local` and
`VITE_FIRMS_PARQUET_BASE_URL` set, the browser queries the public Parquet
dataset using DuckDB-Wasm. This is the mode used by the hosted site and does
not require the original country downloads to be present in the project.
For local development, set the URL in `frontend/.env.local`:

```env
VITE_FIRMS_DATA_MODE=local
VITE_FIRMS_PARQUET_BASE_URL=https://huggingface.co/datasets/youssefbkaram/nasa-firms-parquet/resolve/main
```

If the Parquet URL is blank, the local Vite development/preview server falls
back to country files under `../data` (Egypt shapefiles and FIRMS CSV
downloads). Moving those files therefore requires configuring the Parquet URL
to use the online dataset instead. After changing Vite environment variables,
restart the development server; for `vite preview`, rebuild first.

To query NASA FIRMS directly, set `VITE_FIRMS_DATA_MODE=real` and a valid
`NASA_FIRMS_MAP_KEY` in `frontend/.env.local`. The key is read by the
development server, not browser code, and requests are still capped at
2026-11-13. Use `VITE_FIRMS_DATA_MODE=synthetic` only for clearly labeled fake
development data.

The basemap does not use a FIRMS key: the default map uses OpenStreetMap tiles with attribution, styled dark in the app. A FIRMS MAP_KEY authenticates hotspot-data requests only; it is not a map-tile provider key.

The map opens with Egypt selected and 2026-11-13 as the end date. The date
controls offer 24-hour, 3-day, and 7-day presets or an inclusive custom range
of up to 90 days. No query can extend beyond 2026-11-13.

In API mode, VIIRS products are queried only from their respective start dates; science-quality (`SP`) products are used for dates at least 150 days old and newer dates request near-real-time (`NRT`) products. FIRMS may have product-specific missing dates. NASA FIRMS rate-limits API keys; use local mode for the supplied archive instead of repeatedly retrying a rate-limited live request. The local Vite data endpoint is for development/preview only; a deployed site must provide an equivalent server-side data source and keep the MAP_KEY secret.

The calendar, statistical analytics, and any unconnected forecasting/anomaly examples are not sourced from the live query. Do not treat generated demo values in those components as real NASA observations or scientific results.

### AI fire-data analyzer

The AI Analyzer uses the selected region and quick 1-, 3-, or 7-day UTC
periods, or a custom inclusive start/end date range of up to 90 days, to
retrieve FIRMS detections. It computes the displayed counts and FRP statistics
locally. A COSMO interpretation sends aggregate metrics, up to 20
highest-FRP example points, and the optional question (up to 500 characters),
not the full observation dataset. Raw MODIS and VIIRS detections are not
directly comparable and are never combined into a harmonized count here.

The static GitHub Pages deployment has no COSMO backend, so it displays the
metrics without an AI interpretation. To enable COSMO on Vercel:

1. Import the repository into Vercel and set the project root directory to
   `frontend`.
2. Add `COSMO_API_KEY` as a server-only environment variable. Do not prefix it
   with `VITE_` or commit it.
3. Set `VITE_COSMO_ENABLED=true`, `VITE_FIRMS_DATA_MODE=local`, and
   `VITE_FIRMS_PARQUET_BASE_URL` to the public Parquet dataset base URL.
4. Redeploy. The `/api/ai/analyze` Vercel function proxies to COSMO without
   exposing the key to browser code.

For local Vite development, set `COSMO_API_KEY` in `frontend/.env.local`; the
local proxy keeps it out of browser code. The Vercel API endpoint is public;
anyone can call it and consume COSMO API quota. Confirm COSMO's usage terms and
add authentication or a durable rate limit before broadly sharing the endpoint.
Vercel function quotas apply separately.
