import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

const PORT = Number(process.env.PORT ?? 4000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KEY_ID = 'mock-key-1';
const jwk = {
  ...(publicKey.export({ format: 'jwk' }) as JsonWebKey),
  kid: KEY_ID,
  use: 'sig',
  alg: 'RS256',
};

console.log('Generated RSA key pair for JWT signing');

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildJwt(sub: string, privateKey: KeyObject): string {
  const header = base64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub,
      email: sub,
      iat: now,
      exp: now + 3600,
      iss: `http://localhost:${PORT}`,
    }),
  );
  const signing = `${header}.${payload}`;
  const sig = createSign('SHA256').update(signing).sign(privateKey);
  return `${signing}.${base64url(sig)}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/**
 * Returns CORS headers appropriate for the incoming request's Origin.
 *
 * When an Origin header is present, it is reflected back so that credentialed
 * requests (cookies) work correctly — browsers reject responses that combine
 * `credentials: 'include'` with `Access-Control-Allow-Origin: *`.
 * When no Origin is present (server-to-server), a wildcard is returned.
 */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  return { 'Access-Control-Allow-Origin': '*' };
}

function json(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  body: unknown,
) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    ...corsHeaders(req),
  });
  res.end(data);
}

const JWKS_PATHS = new Set(['/.well-known/jwks.json', '/oauth/v2/keys']);

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-CSRF-Token, Nextgen-Proxy-Url, Nextgen-Secret-Key',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  console.log(`  --> ${req.method} ${url.pathname}`);

  if (JWKS_PATHS.has(url.pathname)) {
    return json(res, req, 200, { keys: [jwk] });
  }

  if (url.pathname === '/v1/logout') {
    if (req.method !== 'POST') {
      return json(res, req, 405, { error: 'method_not_allowed' });
    }
    console.log(`  <-- 200 logout`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `__nextgen_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      ],
      ...corsHeaders(req),
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname !== '/v1/flow') {
    return json(res, req, 404, { error: 'not_found' });
  }

  if (req.method !== 'POST') {
    return json(res, req, 405, { error: 'method_not_allowed' });
  }

  let body: { action?: string; email?: string; password?: string } = {};
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    body = {};
  }

  if (body.action === 'init' || !body.action) {
    console.log(`  <-- 200 login state`);
    return json(res, req, 200, {
      name: 'login',
      status: 'pending',
      csrf_token: 'mock-csrf-' + Date.now(),
    });
  }

  if (body.action === 'submit') {
    const email = body.email ?? 'user@example.com';
    const token = buildJwt(email, privateKey);
    const displayName = email.split('@')[0];
    const displayCookie = Buffer.from(
      JSON.stringify({ name: displayName, email }),
    ).toString('base64');
    console.log(`  <-- 200 success  email=${email}`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `__nextgen_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
        `__nextgen_display=${displayCookie}; Path=/; SameSite=Lax`,
      ],
      ...corsHeaders(req),
    });
    res.end(
      JSON.stringify({
        name: 'success',
        status: 'complete',
        message: 'Signed in.',
      }),
    );
    return;
  }

  console.log(`  <-- 400 unknown action: ${body.action}`);
  return json(res, req, 400, { error: 'unknown_action' });
});

server.listen(PORT, () => {
  console.log(`nextgen mock server listening on http://localhost:${PORT}`);
});
