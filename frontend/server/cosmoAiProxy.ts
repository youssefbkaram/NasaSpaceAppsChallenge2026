import type { Connect, Plugin } from 'vite';
import { CosmoApiError, requestCosmoAnswer } from './cosmoApiClient.js';

const MAX_REQUEST_BYTES = 24_000;
const MAX_MESSAGE_LENGTH = 20_000;

function cosmoAiProxy(apiKey: string): Plugin {
  const attachMiddleware = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use('/api/ai/analyze', (request, response, next) => {
      if (request.method !== 'POST') {
        next();
        return;
      }

      response.setHeader('content-type', 'application/json; charset=utf-8');
      if (!apiKey) {
        response.statusCode = 503;
        response.end(JSON.stringify({
          error: 'COSMO_API_KEY is not configured. Add it to frontend/.env.local, then restart Vite.'
        }));
        return;
      }

      let body = '';
      let bodySize = 0;
      let tooLarge = false;
      request.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        bodySize += Buffer.byteLength(text);
        if (bodySize > MAX_REQUEST_BYTES) {
          tooLarge = true;
          return;
        }
        body += text;
      });

      request.on('end', () => {
        if (tooLarge) {
          response.statusCode = 413;
          response.end(JSON.stringify({ error: 'The analysis request is too large.' }));
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'The analysis request must contain valid JSON.' }));
          return;
        }

        const message = payload && typeof payload === 'object'
          ? (payload as { message?: unknown }).message
          : undefined;
        if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'A non-empty analysis message of at most 20,000 characters is required.' }));
          return;
        }

        void (async () => {
          try {
            const answer = await requestCosmoAnswer(apiKey, message);
            response.statusCode = 200;
            response.end(JSON.stringify({ answer }));
          } catch (error) {
            console.error('COSMO analysis request failed:', error instanceof Error ? error.message : 'Unknown error');
            response.statusCode = error instanceof CosmoApiError && error.statusCode === 429 ? 429 : 502;
            response.end(JSON.stringify({
              error: error instanceof CosmoApiError
                ? error.message
                : 'Could not reach COSMO. Check the connection and try again.'
            }));
          }
        })();
      });
    });
  };

  return {
    name: 'cosmo-ai-proxy',
    configureServer: (server) => attachMiddleware(server),
    configurePreviewServer: (server) => attachMiddleware(server)
  };
}

export { cosmoAiProxy };
