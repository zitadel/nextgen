import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, test } from "vitest";

import {
  REMOTE_HOST,
  installRemoteHostResolution,
  remoteHostEnv,
  startHttpsEdge,
} from "./https-edge.mjs";

let dir;
let edge;
let ca;
let edgePort;
let upstream;
const upstreamRequests = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-journey-edge-test-"));
  upstream = http.createServer((req, res) => {
    upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(201, {
      "content-type": "text/plain",
      "set-cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/"],
    });
    res.end("created");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  edge = await startHttpsEdge({
    port: 0,
    upstreamPort: upstream.address().port,
    dir,
    logPath: join(dir, "edge.log"),
  });
  edgePort = Number(new URL(edge.url).port);
  ca = await readFile(edge.certPath, "utf8");
});

afterAll(async () => {
  await edge?.close();
  await new Promise((resolve) => (upstream ? upstream.close(() => resolve()) : resolve()));
  await rm(dir, { recursive: true, force: true });
});

test("the edge answers only to its own name", () => {
  assert.equal(edge.url, `https://${REMOTE_HOST}:${edgePort}`);
});

test("refuses a TLS handshake for any other server name", async () => {
  await assert.rejects(
    request({ servername: "localhost", host: "localhost:5173" }),
    (error) => error instanceof Error,
  );
});

test("routes by Host: a request for another host gets 421 and never reaches the runtime", async () => {
  const reached = upstreamRequests.length;

  const response = await request({ servername: REMOTE_HOST, host: "localhost:5173" });

  assert.equal(response.status, 421);
  assert.equal(upstreamRequests.length, reached);
});

test("forwards to the local runtime with its own X-Forwarded-* values, overwriting the client's", async () => {
  const response = await request({
    servername: REMOTE_HOST,
    host: `${REMOTE_HOST}:${edgePort}`,
    method: "POST",
    path: "/sessions/exchange?project_id=p",
    headers: { "x-forwarded-host": "localhost:5173", "x-forwarded-proto": "http" },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body, "created");
  assert.deepEqual(response.headers["set-cookie"], ["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
  const seen = upstreamRequests.at(-1);
  assert.equal(seen.method, "POST");
  assert.equal(seen.url, "/sessions/exchange?project_id=p");
  assert.equal(seen.headers["x-forwarded-host"], `${REMOTE_HOST}:${edgePort}`);
  assert.equal(seen.headers["x-forwarded-proto"], "https");
});

test("answers 502 while the local runtime is down", async () => {
  const down = await startHttpsEdge({
    port: 0,
    // Port 1 is privileged and has no listener: the connection is refused.
    upstreamPort: 1,
    dir,
    logPath: join(dir, "edge-down.log"),
  });
  try {
    const port = Number(new URL(down.url).port);
    const response = await request({
      port,
      ca: await readFile(down.certPath, "utf8"),
      servername: REMOTE_HOST,
      host: `${REMOTE_HOST}:${port}`,
    });

    assert.equal(response.status, 502);
  } finally {
    await down.close();
  }
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

test("a child process given remoteHostEnv reaches the edge by name", async () => {
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

test("remoteHostEnv keeps the caller's NODE_OPTIONS and extra certificates", async () => {
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
  port = edgePort,
  ca: trusted = ca,
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
