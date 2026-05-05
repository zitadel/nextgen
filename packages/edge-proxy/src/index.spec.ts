import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EdgeProxyConfigError, handleProxy, resolveConfig } from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UPSTREAM = 'http://api.example.com';

function makeConfig(
  overrides: Parameters<typeof resolveConfig>[0] = { apiUrl: UPSTREAM },
) {
  return resolveConfig(overrides);
}

/**
 * Creates a mock Response with the given body, status, plain headers, and
 * individual Set-Cookie values. Because we run in Node 24, the native
 * Response/Headers constructors are available and getSetCookie() works.
 */
function mockResponse(
  body = '{}',
  {
    status = 200,
    headers = {} as Record<string, string>,
    cookies = [] as string[],
  } = {},
): Response {
  const h = new Headers(headers);
  for (const c of cookies) {
    h.append('set-cookie', c);
  }
  return new Response(body, { status, headers: h });
}

/**
 * Returns a stub fetch that always resolves to the given Response.
 * Captures all calls so tests can inspect what arguments were passed.
 */
function stubFetch(res: Response) {
  const mock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', mock);
  return mock;
}

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('throws EdgeProxyConfigError for missing apiUrl', () => {
    expect(() => resolveConfig({ apiUrl: '' })).toThrow(EdgeProxyConfigError);
  });

  it('throws EdgeProxyConfigError for invalid URL', () => {
    expect(() => resolveConfig({ apiUrl: 'not-a-url' })).toThrow(
      EdgeProxyConfigError,
    );
  });

  it('throws EdgeProxyConfigError for non-http/s protocol', () => {
    expect(() => resolveConfig({ apiUrl: 'ftp://example.com' })).toThrow(
      EdgeProxyConfigError,
    );
  });

  it('throws EdgeProxyConfigError for pathPrefix without leading slash', () => {
    expect(() =>
      resolveConfig({ apiUrl: UPSTREAM, pathPrefix: 'noslash' }),
    ).toThrow(EdgeProxyConfigError);
  });

  it('applies all defaults', () => {
    const cfg = resolveConfig({ apiUrl: UPSTREAM });
    expect(cfg.pathPrefix).toBe('/__nextgen');
    expect(cfg.stripPrefix).toBe(true);
    expect(cfg.additionalHeaders).toEqual({});
  });

  it('preserves explicit values', () => {
    const cfg = resolveConfig({
      apiUrl: UPSTREAM,
      pathPrefix: '/proxy',
      stripPrefix: false,
      additionalHeaders: { 'X-Custom': 'val' },
    });
    expect(cfg.pathPrefix).toBe('/proxy');
    expect(cfg.stripPrefix).toBe(false);
    expect(cfg.additionalHeaders).toEqual({ 'X-Custom': 'val' });
  });

  it('accepts https apiUrl', () => {
    expect(() =>
      resolveConfig({ apiUrl: 'https://api.example.com' }),
    ).not.toThrow();
  });
});

// ─── handleProxy ──────────────────────────────────────────────────────────────

describe('handleProxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Path matching ────────────────────────────────────────────────────────────

  it('returns null for non-matching path', async () => {
    const cfg = makeConfig();
    const req = new Request('http://edge.local/other/path');
    expect(await handleProxy(req, cfg)).toBeNull();
  });

  it('returns null for path that is a prefix but not the prefix', async () => {
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen_other');
    expect(await handleProxy(req, cfg)).toBeNull();
  });

  it('matches exact pathPrefix', async () => {
    stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request(`http://edge.local/__nextgen`);
    const res = await handleProxy(req, cfg);
    expect(res).not.toBeNull();
  });

  // ── Upstream URL construction ─────────────────────────────────────────────

  it('strips pathPrefix from upstream path by default', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(
      new Request('http://edge.local/__nextgen/auth/token'),
      cfg,
    );
    const [url] = mock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.example.com/auth/token');
  });

  it('uses / when pathPrefix matches exactly (no suffix)', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('http://edge.local/__nextgen'), cfg);
    const [url] = mock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.example.com/');
  });

  it('preserves query string', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(
      new Request('http://edge.local/__nextgen/search?q=hello&page=2'),
      cfg,
    );
    const [url] = mock.mock.calls[0] ?? [];
    expect(url).toContain('?q=hello&page=2');
  });

  it('keeps full path when stripPrefix is false', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = resolveConfig({ apiUrl: UPSTREAM, stripPrefix: false });
    await handleProxy(new Request('http://edge.local/__nextgen/hello'), cfg);
    const [url] = mock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.example.com/__nextgen/hello');
  });

  it('uses upstream host and protocol from apiUrl', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = resolveConfig({ apiUrl: 'https://secure-api.example.com' });
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [url] = mock.mock.calls[0] ?? [];
    expect(url).toMatch(/^https:\/\/secure-api\.example\.com\//);
  });

  // ── Hop-by-hop header stripping ───────────────────────────────────────────

  it('strips all hop-by-hop headers from the upstream request', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/hello', {
      headers: {
        connection: 'keep-alive',
        host: 'edge.local',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        te: 'trailers',
        trailer: 'Expires',
        upgrade: 'websocket',
        'proxy-authorization': 'Basic abc',
        'proxy-authenticate': 'Basic realm=x',
        'x-custom': 'kept',
      },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    const forwarded = init!.headers as Headers;
    expect(forwarded.has('connection')).toBe(false);
    // host is stripped so the upstream fetch sets the correct Host header
    // from the target URL rather than forwarding the client's hostname.
    expect(forwarded.has('host')).toBe(false);
    expect(forwarded.has('keep-alive')).toBe(false);
    expect(forwarded.has('transfer-encoding')).toBe(false);
    expect(forwarded.has('te')).toBe(false);
    expect(forwarded.has('trailer')).toBe(false);
    expect(forwarded.has('upgrade')).toBe(false);
    expect(forwarded.has('proxy-authorization')).toBe(false);
    expect(forwarded.has('proxy-authenticate')).toBe(false);
    expect(forwarded.get('x-custom')).toBe('kept');
  });

  // ── X-Forwarded-* injection ───────────────────────────────────────────────

  it('injects x-forwarded-host when absent', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-host')).toBe(
      'edge.local',
    );
  });

  it('injects x-forwarded-proto when absent', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('https://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-proto')).toBe('https');
  });

  it('preserves x-forwarded-host when already present', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/ping', {
      headers: { 'x-forwarded-host': 'cdn.example.com' },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-host')).toBe(
      'cdn.example.com',
    );
  });

  it('preserves x-forwarded-proto when already present', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/ping', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-proto')).toBe('https');
  });

  it('preserves x-forwarded-for when already present', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/ping', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-for')).toBe('1.2.3.4');
  });

  it('sets x-forwarded-for from cf-connecting-ip when absent', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/ping', {
      headers: { 'cf-connecting-ip': '5.6.7.8' },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-for')).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip for x-forwarded-for when cf-connecting-ip absent', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const req = new Request('http://edge.local/__nextgen/ping', {
      headers: { 'x-real-ip': '9.10.11.12' },
    });
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-for')).toBe(
      '9.10.11.12',
    );
  });

  it('omits x-forwarded-for when no IP source is available', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).has('x-forwarded-for')).toBe(false);
  });

  // ── additionalHeaders ─────────────────────────────────────────────────────

  it('injects additionalHeaders into every upstream request', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = resolveConfig({
      apiUrl: UPSTREAM,
      additionalHeaders: { 'X-Tenant-Id': 'acme', 'X-Version': '2' },
    });
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    const h = init!.headers as Headers;
    expect(h.get('x-tenant-id')).toBe('acme');
    expect(h.get('x-version')).toBe('2');
  });

  it('additionalHeaders can override a forwarded header', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = resolveConfig({
      apiUrl: UPSTREAM,
      additionalHeaders: { 'x-forwarded-proto': 'https' },
    });
    const req = new Request('http://edge.local/__nextgen/ping');
    await handleProxy(req, cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init!.headers as Headers).get('x-forwarded-proto')).toBe('https');
  });

  // ── Request body ──────────────────────────────────────────────────────────

  it('does not attach body for GET', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect(init?.body).toBeUndefined();
  });

  it('does not attach body for HEAD', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(
      new Request('http://edge.local/__nextgen/ping', { method: 'HEAD' }),
      cfg,
    );
    const [, init] = mock.mock.calls[0] ?? [];
    expect(init?.body).toBeUndefined();
  });

  it('attaches body for POST and sets method', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    const body = JSON.stringify({ key: 'val' });
    await handleProxy(
      new Request('http://edge.local/__nextgen/endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      cfg,
    );
    const [, init] = mock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeDefined();
  });

  it('uses redirect: manual so 3xx is passed through', async () => {
    const mock = stubFetch(
      mockResponse('', {
        status: 302,
        headers: { Location: 'https://example.com' },
      }),
    );
    const cfg = makeConfig();
    const res = await handleProxy(
      new Request('http://edge.local/__nextgen/redir'),
      cfg,
    );
    expect(res?.status).toBe(302);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init as Record<string, unknown>)['redirect']).toBe('manual');
  });

  it('sets duplex: half for POST requests', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(
      new Request('http://edge.local/__nextgen/endpoint', {
        method: 'POST',
        body: 'data',
      }),
      cfg,
    );
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init as Record<string, unknown>)['duplex']).toBe('half');
  });

  it('does not set duplex for GET requests', async () => {
    const mock = stubFetch(mockResponse());
    const cfg = makeConfig();
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = mock.mock.calls[0] ?? [];
    expect((init as Record<string, unknown>)['duplex']).toBeUndefined();
  });

  // ── Response handling ─────────────────────────────────────────────────────

  it('streams upstream response body', async () => {
    stubFetch(
      mockResponse('{"hello":"world"}', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const cfg = makeConfig();
    const res = await handleProxy(
      new Request('http://edge.local/__nextgen/ping'),
      cfg,
    );
    expect(await res?.text()).toBe('{"hello":"world"}');
  });

  it('preserves upstream status code', async () => {
    stubFetch(mockResponse('Not Found', { status: 404 }));
    const cfg = makeConfig();
    const res = await handleProxy(
      new Request('http://edge.local/__nextgen/missing'),
      cfg,
    );
    expect(res?.status).toBe(404);
  });

  it('strips hop-by-hop headers from upstream response', async () => {
    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'x-custom': 'kept',
    });
    stubFetch(new Response('{}', { status: 200, headers: upstreamHeaders }));
    const cfg = makeConfig();
    const res = await handleProxy(
      new Request('http://edge.local/__nextgen/ping'),
      cfg,
    );
    expect(res?.headers.has('connection')).toBe(false);
    expect(res?.headers.has('transfer-encoding')).toBe(false);
    expect(res?.headers.get('x-custom')).toBe('kept');
    expect(res?.headers.get('content-type')).toBe('application/json');
  });

  it('preserves multiple Set-Cookie headers individually', async () => {
    stubFetch(
      mockResponse('{}', {
        cookies: ['session=abc; HttpOnly', 'theme=dark; Path=/'],
      }),
    );
    const cfg = makeConfig();
    const res = await handleProxy(
      new Request('http://edge.local/__nextgen/ping'),
      cfg,
    );
    const cookies = res?.headers.getSetCookie() ?? [];
    expect(cookies).toHaveLength(2);
    expect(cookies).toContain('session=abc; HttpOnly');
    expect(cookies).toContain('theme=dark; Path=/');
  });
});

// ─── Integration: resolveConfig + handleProxy ─────────────────────────────────

describe('resolveConfig + handleProxy integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses custom pathPrefix', async () => {
    const mock = vi.mocked(fetch);
    const cfg = resolveConfig({ apiUrl: UPSTREAM, pathPrefix: '/api' });
    await handleProxy(new Request('http://edge.local/api/users'), cfg);
    const [url] = (mock.mock.calls[0] as [string]) ?? [];
    expect(url).toBe('http://api.example.com/users');
  });

  it('apiUrl base path is preserved', async () => {
    const mock = vi.mocked(fetch);
    const cfg = resolveConfig({ apiUrl: 'http://api.example.com/v2' });
    await handleProxy(new Request('http://edge.local/__nextgen/users'), cfg);
    const [url] = (mock.mock.calls[0] as [string]) ?? [];
    expect(url).toBe('http://api.example.com/v2/users');
  });

  it('defaults proxyTimeoutMs to 5000', () => {
    const cfg = resolveConfig({ apiUrl: UPSTREAM });
    expect(cfg.proxyTimeoutMs).toBe(5000);
  });

  it('respects custom proxyTimeoutMs', () => {
    const cfg = resolveConfig({ apiUrl: UPSTREAM, proxyTimeoutMs: 10000 });
    expect(cfg.proxyTimeoutMs).toBe(10000);
  });

  it('passes AbortSignal.timeout to fetch', async () => {
    const mock = vi.mocked(fetch);
    const cfg = resolveConfig({ apiUrl: UPSTREAM, proxyTimeoutMs: 3000 });
    await handleProxy(new Request('http://edge.local/__nextgen/ping'), cfg);
    const [, init] = (mock.mock.calls[0] as [string, RequestInit]) ?? [];
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });
});
