const PROXYABLE_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finance.yahoo.com',
  'guce.yahoo.com',
  'consent.yahoo.com',
  'cdn.cboe.com',
  'fred.stlouisfed.org',
]);

function getYahooProxyUrl(): string | undefined {
  const configured = process.env.YAHOO_PROXY_URL?.trim();
  if (!configured) return undefined;

  // Deployment variables are sometimes entered as a bare hostname. Treat those
  // as HTTPS origins so a missing scheme or copied whitespace cannot create an
  // invalid fetch URL such as " option-yahoo.example/proxy/...".
  const withScheme = /^https?:\/\//i.test(configured)
    ? configured
    : `https://${configured.replace(/^\/\//, '')}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid YAHOO_PROXY_URL; expected an HTTP(S) URL or hostname');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid YAHOO_PROXY_URL; expected an HTTP(S) URL or hostname');
  }
  return parsed.toString().replace(/\/+$/, '');
}

/** Routes yahoo-finance2 requests through the optional server-side Worker. */
export function createYahooProxyFetch(): typeof fetch | undefined {
  const proxyUrl = getYahooProxyUrl();
  const token = process.env.YAHOO_PROXY_TOKEN;
  if (!proxyUrl || !token) return undefined;

  return async (input, init) => {
    const original = new URL(input instanceof Request ? input.url : input.toString());
    if (!PROXYABLE_HOSTS.has(original.hostname)) return fetch(input, init);

    const target = `${proxyUrl}/proxy/${original.hostname}${original.pathname}${original.search}`;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set('authorization', `Bearer ${token}`);
    return fetch(target, {
      ...init,
      headers,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      redirect: 'manual',
    });
  };
}

/** Uses the shared Worker for allowed server-side market data requests. */
export function marketDataProxyUrl(upstreamUrl: string): string {
  const proxyUrl = getYahooProxyUrl();
  if (!proxyUrl || !process.env.YAHOO_PROXY_TOKEN) return upstreamUrl;
  const original = new URL(upstreamUrl);
  if (!PROXYABLE_HOSTS.has(original.hostname)) return upstreamUrl;
  return `${proxyUrl}/proxy/${original.hostname}${original.pathname}${original.search}`;
}

export function marketDataProxyHeaders(requestUrl: string): Record<string, string> | undefined {
  const proxyUrl = getYahooProxyUrl();
  const token = process.env.YAHOO_PROXY_TOKEN;
  return proxyUrl && token && requestUrl.startsWith(`${proxyUrl}/proxy/`)
    ? { authorization: `Bearer ${token}` }
    : undefined;
}

export const yahooProxyUrl = marketDataProxyUrl;
export const yahooProxyHeaders = marketDataProxyHeaders;
