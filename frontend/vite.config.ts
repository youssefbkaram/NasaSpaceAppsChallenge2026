import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { localFirmsDataPlugin } from './server/localFirmsData.js';
import { cosmoAiProxy } from './server/cosmoAiProxy.js';

const allowedSources = new Set([
  'MODIS_NRT',
  'MODIS_SP',
  'VIIRS_SNPP_NRT',
  'VIIRS_SNPP_SP',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA20_SP',
  'VIIRS_NOAA21_NRT',
  'VIIRS_NOAA21_SP'
]);

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function firmsAreaProxy(mapKey: string): Plugin {
  const attachMiddleware = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use('/api/firms/area', (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }

      void (async () => {
        response.setHeader('content-type', 'application/json; charset=utf-8');
        if (!mapKey) {
          response.statusCode = 503;
          response.end(JSON.stringify({
            error: 'NASA_FIRMS_MAP_KEY is not configured. Add a replacement key to frontend/.env.local, then restart Vite.'
          }));
          return;
        }

        const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
        const source = params.get('source') ?? '';
        const date = params.get('date') ?? '';
        const days = Number(params.get('days'));
        const bboxValues = (params.get('bbox') ?? '').split(',').map(Number);
        const [west, south, east, north] = bboxValues;
        const validBounds = bboxValues.length === 4 &&
          bboxValues.every(Number.isFinite) &&
          west >= -180 && east <= 180 && west < east &&
          south >= -90 && north <= 90 && south < north;

        if (
          !allowedSources.has(source) ||
          !isValidDate(date) ||
          !Number.isInteger(days) || days < 1 || days > 5 ||
          !validBounds
        ) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'Invalid NASA FIRMS source, date, day range, or bounding box.' }));
          return;
        }

        try {
          const nasaUrl = new URL(
            `/api/area/csv/${encodeURIComponent(mapKey)}/${source}/${bboxValues.join(',')}/${days}/${date}`,
            'https://firms.modaps.eosdis.nasa.gov'
          );
          const upstream = await fetch(nasaUrl, { signal: AbortSignal.timeout(45_000) });
          const body = await upstream.text();
          response.statusCode = upstream.status;
          response.setHeader('content-type', 'text/csv; charset=utf-8');
          response.end(body);
        } catch (error) {
          console.error('NASA FIRMS proxy request failed:', error instanceof Error ? error.message : error);
          response.statusCode = 502;
          response.setHeader('content-type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: 'Could not reach NASA FIRMS. Check the connection and try again.' }));
        }
      })();
    });
  };

  return {
    name: 'firms-area-proxy',
    configureServer: (server) => attachMiddleware(server),
    configurePreviewServer: (server) => attachMiddleware(server)
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      tailwindcss(),
      localFirmsDataPlugin(),
      firmsAreaProxy(env.NASA_FIRMS_MAP_KEY ?? ''),
      cosmoAiProxy(env.COSMO_API_KEY ?? '')
    ],
    server: {
      host: true,
      port: 5173
    }
  };
});
