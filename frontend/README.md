# NASA Space Apps Challenge 2026 — PSR B0531+21

An interactive platform for exploring NASA FIRMS MODIS and VIIRS active-fire detections. The map displays raw observations; it does **not** claim that sensor differences have been scientifically harmonized.

## Current features

- **Interactive map:** Leaflet map with country, sensor, and basemap controls. Selecting a hotspot opens its metadata in a popup anchored above the point, including acquisition time, coordinates, confidence, FRP, brightness, and processing quality.
- **Date filters:** Quick 24-hour, 3-day, and 7-day periods plus a custom inclusive start/end range of up to 90 days. The default map opens on Egypt at 2026-11-13.
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

### Local Egypt data, NASA FIRMS API, and synthetic demo mode

The default data mode is `local`. It reads the supplied country datasets from `../data` through a Vite development/preview endpoint: Egypt from its shapefile extracts, and Algeria, Bolivia, Brazil, Colombia, Ecuador, Guyana, Libya, Mauritania, Morocco, Paraguay, Peru, Suriname, Sudan, Tunisia, and Venezuela from FIRMS CSV extracts. The Peru and Suriname folders contain separate FIRMS products whose sampled coordinates match those countries. The endpoint serves the requested dates from MODIS and VIIRS archive and NRT files. The archive and NRT files remain distinct (`SP` and `NRT` quality); NRT observations are provisional. The site labels these as local NASA FIRMS downloads. Brazil's current folder does not include Suomi-NPP files, so that product is unavailable for Brazil.

Use **All countries** or one of the sixteen supported supplied country regions for local files; the other region presets do not have local data. To query current FIRMS API data instead, set `VITE_FIRMS_DATA_MODE=real` in `frontend/.env.local`, set `NASA_FIRMS_MAP_KEY` to a valid FIRMS MAP_KEY, and restart Vite. The key is read by the development server and is not sent to browser code. Do not use a `VITE_` prefix for the key. Use `VITE_FIRMS_DATA_MODE=synthetic` only for clearly labeled fake development data.

The basemap does not use a FIRMS key: the default map uses OpenStreetMap tiles with attribution, styled dark in the app. A FIRMS MAP_KEY authenticates hotspot-data requests only; it is not a map-tile provider key.

The map opens with Egypt selected and 2026-11-13 as the end date. The date controls offer 24-hour, 3-day, and 7-day presets or an inclusive custom range of up to 90 days. Date ranges end on the selected date and cannot extend beyond today. The supplied Egypt FIRMS extracts cover this default date.

In API mode, VIIRS products are queried only from their respective start dates; science-quality (`SP`) products are used for dates at least 150 days old and newer dates request near-real-time (`NRT`) products. FIRMS may have product-specific missing dates. NASA FIRMS rate-limits API keys; use local mode for the supplied archive instead of repeatedly retrying a rate-limited live request. The local Vite data endpoint is for development/preview only; a deployed site must provide an equivalent server-side data source and keep the MAP_KEY secret.

The calendar, statistical analytics, and any unconnected forecasting/anomaly examples are not sourced from the live query. Do not treat generated demo values in those components as real NASA observations or scientific results.

### AI fire-data analyzer

The AI Analyzer uses the selected region and quick 1-, 3-, or 7-day UTC
periods, or a custom inclusive start/end date range of up to 90 days, to
retrieve FIRMS detections. It computes the displayed counts and FRP statistics
locally, then sends COSMO the aggregates, up to 20 highest-FRP example points,
and an optional question (up to 500 characters). It does not upload the full
observation dataset. COSMO returns structured JSON that the browser validates
and renders as an interpretation dashboard. AI text is not a validated
scientific conclusion; raw MODIS and VIIRS detections are not directly
comparable and are never combined into a harmonized count here.

Set `COSMO_API_KEY` (without a `VITE_` prefix) in `frontend/.env.local` and
restart Vite. The local Vite proxy keeps the key out of browser code and is
available for development/preview only. A deployed site needs an equivalent
server-side endpoint configured with the secret key. Never commit the key.
