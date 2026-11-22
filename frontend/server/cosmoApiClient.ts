const COSMO_API_URL = 'https://collabs.corexai.online/apis/cosmo/v1/chat/completions';

export class CosmoApiError extends Error {
  readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number
  ) {
    super(message);
    this.name = 'CosmoApiError';
    this.statusCode = statusCode;
  }
}

function getAnswer(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Record<string, unknown>;
  if (typeof result.answer === 'string') return result.answer;
  if (!Array.isArray(result.choices)) return undefined;

  const firstChoice: unknown = result.choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') return undefined;
  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : undefined;
}

export async function requestCosmoAnswer(apiKey: string, message: string): Promise<string> {
  const response = await fetch(COSMO_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model: 'cosmo', message }),
    signal: AbortSignal.timeout(60_000)
  });
  const responseText = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new CosmoApiError('COSMO could not complete the analysis. Please try again later.', response.status);
  }

  const answer = getAnswer(body)?.trim();
  if (!answer) {
    throw new CosmoApiError('COSMO returned an empty or unsupported analysis response.', 502);
  }
  return answer;
}
