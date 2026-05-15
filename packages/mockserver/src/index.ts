import { generateKeyPairSync, createSign, randomUUID, type KeyObject } from 'node:crypto';
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

// ── In-memory stores for CLI platform API ──────────────────────────────────

type Project = {
  id: string;
  projectSecret: string;
  previewSecret: string;
  previewOrigins: string[];
  createdAt: string;
  updatedAt: string;
  configVersion: number;
  configHash?: string;
};

const projects = new Map<string, Project>();
const schemas = new Map<string, object>();
const flowDefinitions = new Map<string, object>();

function now(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-CSRF-Token, Nextgen-Proxy-Url, Nextgen-Secret-Key',
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

  // ── CLI platform API ───────────────────────────────────────────────────────

  // GET /capabilities
  if (url.pathname === '/capabilities' && req.method === 'GET') {
    return json(res, req, 200, {
      mode: 'mock',
      version: now().slice(0, 10),
      features: {
        browser_bootstrap: true,
        preview_secrets: true,
        config_apply: true,
      },
    });
  }

  // POST /projects
  if (url.pathname === '/projects' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}') as {
      previewOrigins?: string[];
    };
    const id = `proj-${shortId()}`;
    const createdAt = now();
    const project: Project = {
      id,
      projectSecret: `sk_proj_${id.replace(/-/g, '')}_full`,
      previewSecret: `sk_proj_${id.replace(/-/g, '')}_preview`,
      previewOrigins: body.previewOrigins ?? [],
      createdAt,
      updatedAt: createdAt,
      configVersion: 0,
    };
    projects.set(id, project);
    console.log(`  <-- 201 project created id=${id}`);
    return json(res, req, 201, {
      id: project.id,
      projectSecret: project.projectSecret,
      previewSecret: project.previewSecret,
      previewOrigins: project.previewOrigins,
      createdAt: project.createdAt,
    });
  }

  // GET /projects/:id
  const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (projectMatch && req.method === 'GET') {
    const project = projects.get(projectMatch[1]!);
    if (!project) return json(res, req, 404, { error: 'not_found' });
    return json(res, req, 200, {
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }

  // PUT /projects/:id/config
  const configMatch = url.pathname.match(/^\/projects\/([^/]+)\/config$/);
  if (configMatch && req.method === 'PUT') {
    const project = projects.get(configMatch[1]!);
    if (!project) return json(res, req, 404, { error: 'not_found' });
    const body = JSON.parse((await readBody(req)) || '{}') as { hash?: string };
    project.configVersion += 1;
    project.configHash = body.hash;
    project.updatedAt = now();
    return json(res, req, 200, {
      config_version: project.configVersion,
      hash: body.hash ?? '',
      applied_at: project.updatedAt,
      server_capabilities: {
        schema_version: '2.0',
        flow_protocol_version: '1.0',
        step_types: ['identifier', 'credential', 'form', 'verification', 'redirect', 'info', 'complete'],
        idp_types: ['oidc'],
        delivery_modes: ['dev_inbox'],
        renderer_modes: ['default'],
        features: ['preview_secrets', 'capability_handshake_v1'],
      },
      warnings: [],
    });
  }

  // GET /projects/:id/config
  if (configMatch && req.method === 'GET') {
    const project = projects.get(configMatch[1]!);
    if (!project) return json(res, req, 404, { error: 'not_found' });
    return json(res, req, 200, { project_id: project.id, source: 'mock' });
  }

  // POST /projects/:id/claim/init
  const claimInitMatch = url.pathname.match(/^\/projects\/([^/]+)\/claim\/init$/);
  if (claimInitMatch && req.method === 'POST') {
    const projectId = claimInitMatch[1]!;
    const challengeId = `chal_${shortId()}`;
    return json(res, req, 200, {
      claim_url: `http://localhost:${PORT}/claim/${projectId}/${challengeId}`,
      challenge_id: challengeId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  }

  // GET /projects/:id/claim/status
  const claimStatusMatch = url.pathname.match(/^\/projects\/([^/]+)\/claim\/status$/);
  if (claimStatusMatch && req.method === 'GET') {
    return json(res, req, 200, { status: 'pending' });
  }

  // POST /schemas
  if (url.pathname === '/schemas' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}') as object;
    const id = `schema_${shortId()}`;
    schemas.set(id, body);
    console.log(`  <-- 201 schema created id=${id}`);
    return json(res, req, 201, { id });
  }

  // GET /schemas/:id
  const schemaMatch = url.pathname.match(/^\/schemas\/([^/]+)$/);
  if (schemaMatch && req.method === 'GET') {
    const schema = schemas.get(schemaMatch[1]!);
    if (!schema) return json(res, req, 404, { error: 'not_found' });
    return json(res, req, 200, schema);
  }

  // DELETE /schemas/:id
  if (schemaMatch && req.method === 'DELETE') {
    schemas.delete(schemaMatch[1]!);
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  // POST /flow_definitions
  if (url.pathname === '/flow_definitions' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}') as object;
    const id = `flow_${shortId()}`;
    flowDefinitions.set(id, body);
    console.log(`  <-- 201 flow_definition created id=${id}`);
    return json(res, req, 201, { id });
  }

  // PATCH /flow_definitions/:id
  const flowMatch = url.pathname.match(/^\/flow_definitions\/([^/]+)$/);
  if (flowMatch && req.method === 'PATCH') {
    if (!flowDefinitions.has(flowMatch[1]!))
      return json(res, req, 404, { error: 'not_found' });
    const body = JSON.parse((await readBody(req)) || '{}') as object;
    flowDefinitions.set(flowMatch[1]!, body);
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  // DELETE /flow_definitions/:id
  if (flowMatch && req.method === 'DELETE') {
    flowDefinitions.delete(flowMatch[1]!);
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  // ── Frontend login flow ────────────────────────────────────────────────────

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
