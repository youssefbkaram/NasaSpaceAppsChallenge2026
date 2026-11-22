import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CosmoApiError, requestCosmoAnswer } from '../../server/cosmoApiClient.js';

const MAX_REQUEST_BYTES = 24_000;
const MAX_MESSAGE_LENGTH = 20_000;

function parseRequestBody(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    res.status(405).json({ error: 'Only POST requests are supported.' });
    return;
  }

  const apiKey = process.env.COSMO_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'COSMO_API_KEY is not configured in the server environment.' });
    return;
  }

  const requestBody = parseRequestBody(req.body as unknown);
  const serializedBody = JSON.stringify(requestBody);
  const contentLength = Number(req.headers['content-length']);
  if (
    (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) ||
    (serializedBody && Buffer.byteLength(serializedBody, 'utf8') > MAX_REQUEST_BYTES)
  ) {
    res.status(413).json({ error: 'The analysis request is too large.' });
    return;
  }

  const payload = requestBody && typeof requestBody === 'object'
    ? requestBody as Record<string, unknown>
    : undefined;
  const message = payload?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: 'A non-empty analysis message of at most 20,000 characters is required.' });
    return;
  }

  try {
    const answer = await requestCosmoAnswer(apiKey, message);
    res.status(200).json({ answer });
  } catch (error) {
    console.error('COSMO serverless request failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof CosmoApiError) {
      res.status(error.statusCode === 429 ? 429 : 502).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: 'Could not reach COSMO. Check the connection and try again.' });
  }
}
