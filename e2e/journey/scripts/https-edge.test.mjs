import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";

import { test as base } from "./fixtures.mjs";
import {
  REMOTE_HOST,
  installRemoteHostResolution,
  remoteHostEnv,
  startHttpsEdge,
} from "./https-edge.mjs";

/**
 * The fixtures every test here uses.
 *
 * - `upstream` is the local runtime the edge forwards to; `requests` is what it received.
 * - `startEdge` starts an edge in the test's directory; every edge it started is closed when the
 *   test ends.
 * - `edge` is an edge in front of `upstream`, `ca` its certificate and `edgePort` its port.
 */
const test = base.extend({
  upstream: async ({ listen }, use) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(201, {
        "content-type": "text/plain",
        "set-cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/"],
      });
      res.end("created");
    });
    const port = await listen(server);
    await use({ port, requests });
  },
  startEdge: async ({ dir }, use) => {
    const started = [];
    await use(async (options) => {
      const edge = await startHttpsEdge({ port: 0, dir, ...options });
      started.push(edge);
      return edge;
    });
    await Promise.all(started.map((edge) => edge.close()));
  },
  edge: async ({ dir, startEdge, upstream }, use) => {
    await use(await startEdge({ upstreamPort: upstream.port, logPath: join(dir, "edge.log") }));
  },
  ca: async ({ edge }, use) => {
    await use(await readFile(edge.certPath, "utf8"));
  },
  edgePort: async ({ edge }, use) => {
    await use(Number(new URL(edge.url).port));
  },
});

test("the edge answers only to its own name", ({ edge, edgePort }) => {
  assert.equal(edge.url, `https://${REMOTE_HOST}:${edgePort}`);
});

test("refuses a TLS handshake for any other server name", async ({ edgePort, ca }) => {
  await assert.rejects(
    request({ port: edgePort, ca, servername: "localhost", host: "localhost:5173" }),
    (error) => error instanceof Error,
  );
});

test("routes by Host: a request for another host gets 421 and never reaches the runtime", async ({
  upstream,
  edgePort,
  ca,
}) => {
  const reached = upstream.requests.length;

  const response = await request({
    port: edgePort,
    ca,
    servername: REMOTE_HOST,
    host: "localhost:5173",
  });

  assert.equal(response.status, 421);
  assert.equal(upstream.requests.length, reached);
});

test("forwards to the local runtime with its own X-Forwarded-* values, overwriting the client's", async ({
  upstream,
  edgePort,
  ca,
}) => {
  const response = await request({
    port: edgePort,
    ca,
    servername: REMOTE_HOST,
    host: `${REMOTE_HOST}:${edgePort}`,
    method: "POST",
    path: "/sessions/exchange?project_id=p",
    headers: { "x-forwarded-host": "localhost:5173", "x-forwarded-proto": "http" },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body, "created");
  assert.deepEqual(response.headers["set-cookie"], ["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
  const seen = upstream.requests.at(-1);
  assert.equal(seen.method, "POST");
  assert.equal(seen.url, "/sessions/exchange?project_id=p");
  assert.equal(seen.headers["x-forwarded-host"], `${REMOTE_HOST}:${edgePort}`);
  assert.equal(seen.headers["x-forwarded-proto"], "https");
});

test("answers 502 while the local runtime is down", async ({ dir, startEdge }) => {
  const down = await startEdge({
    // Port 1 is privileged and has no listener: the connection is refused.
    upstreamPort: 1,
    logPath: join(dir, "edge-down.log"),
  });
  const port = Number(new URL(down.url).port);
  const response = await request({
    port,
    ca: await readFile(down.certPath, "utf8"),
    servername: REMOTE_HOST,
    host: `${REMOTE_HOST}:${port}`,
  });

  assert.equal(response.status, 502);
});

test("the resolver answers the edge's name with loopback and leaves other names alone", async () => {
  const fakeDns = { lookup: (_hostname, _options, callback) => callback(null, "192.0.2.1", 4) };
  const original = fakeDns.lookup;
  const restore = installRemoteHostResolution(fakeDns);
  const lookup = (hostname, options) =>
    new Promise((resolve, reject) =>
      fakeDns.lookup(hostname, options, (error, address, family) =>
        error ? reject(error) : resolve({ address, family }),
      ),
    );

  try {
    assert.deepEqual(await lookup(REMOTE_HOST, {}), { address: "127.0.0.1", family: 4 });
    assert.deepEqual(await lookup(REMOTE_HOST, { all: true }), {
      address: [{ address: "127.0.0.1", family: 4 }],
      family: undefined,
    });
    assert.deepEqual(await lookup("example.test", {}), { address: "192.0.2.1", family: 4 });
  } finally {
    restore();
  }
  assert.equal(fakeDns.lookup, original);
});

test("a child process given remoteHostEnv reaches the edge by name", async ({ dir, edge }) => {
  // Only PATH and what the lane adds, so the developer's own Node settings
  // (NODE_OPTIONS, NODE_USE_SYSTEM_CA, …) cannot change the result.
  const env = {
    PATH: process.env.PATH,
    ...remoteHostEnv({ certPath: edge.certPath, dir, env: {} }),
  };
  const script = `const r = await fetch(${JSON.stringify(`${edge.url}/healthz`)}); console.log(r.status, await r.text());`;

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    { env },
  );

  assert.equal(stdout.trim(), "201 created");
});

test("remoteHostEnv keeps the caller's NODE_OPTIONS and extra certificates", async ({
  dir,
  edge,
  ca,
}) => {
  const callerCerts = join(dir, "caller-ca.pem");
  await writeFile(callerCerts, "-----BEGIN CERTIFICATE-----\ncaller\n-----END CERTIFICATE-----\n");

  const env = remoteHostEnv({
    certPath: edge.certPath,
    dir,
    env: { NODE_OPTIONS: "--max-old-space-size=512", NODE_EXTRA_CA_CERTS: callerCerts },
  });

  assert.match(
    env.NODE_OPTIONS,
    /^--max-old-space-size=512 --import=file:.*resolve-remote-host\.mjs$/,
  );
  const bundle = await readFile(env.NODE_EXTRA_CA_CERTS, "utf8");
  assert.ok(bundle.includes("caller"));
  assert.ok(bundle.includes(ca.trim()));
});

/** An https request straight to the edge's port, so no name resolution is involved. */
function request({
  port,
  ca: trusted,
  servername,
  host,
  method = "GET",
  path = "/",
  headers = {},
}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        servername,
        ca: trusted,
        method,
        path,
        headers: { host, ...headers },
        agent: false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
