// The cloud's `server` service (repo-root vercel.json): a Node.js function in
// front of the Go server, so the server's spans reach Vercel Tracing. Only a
// Node.js function gets Vercel's request context, whose reportSpans adds spans
// to the request's trace; a Go function has no way to send them.
//
// On an instance's first request the wrapper starts the launcher
// (apps/api/cmd/cloud-launcher, built into ../dist/nextgen-launcher and
// shipped through the service's includeFiles) on a loopback port, as Vercel's
// Go preset starts it behind its own proxy, and then:
//
// - forwards every request to it, streaming both bodies. The host is the one
//   the client asked for (x-forwarded-host), as the Go preset's proxy sets it.
// - replaces the client's trace context: traceparent comes from Vercel's root
//   span for the request, so the server, which trusts traceparent here
//   (CLOUD_TRACE_COLLECTOR), only ever continues a trace Vercel started.
//   tracestate and baggage are dropped.
// - receives the server's spans as OTLP/HTTP protobuf on a loopback collector,
//   sorts them by request (spans.mjs), and hands each request's spans to
//   reportSpans once the response is done, in waitUntil.
//
// Logs pass straight through: the launcher writes to this process's stdout
// and stderr, as it does under the Go preset. If the launcher exits, so does
// this process, and Vercel replaces the instance.

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { decodeTraceRequest } from "./otlp.mjs";
import { SpanRouter } from "./spans.mjs";

const launcherPath = fileURLToPath(new URL("../dist/nextgen-launcher", import.meta.url));
const requestContext = Symbol.for("@vercel/request-context");
// How long a finished response waits for its server span. The launcher sets
// the server's batch timeout to 100ms.
const spanWaitMs = 1000;
const maxExportBytes = 16 << 20;
// Hop-by-hop headers are the connection's, not the message's (RFC 9110 7.6.1).
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);
const clientTraceContext = new Set(["traceparent", "tracestate", "baggage"]);

const router = new SpanRouter();
let started;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function freePort() {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function collectorHandler(req, res) {
  if (req.method !== "POST" || req.url !== "/v1/traces") {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxExportBytes) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    try {
      let body = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") {
        body = gunzipSync(body);
      }
      router.ingest(decodeTraceRequest(body));
      // An empty ExportTraceServiceResponse: everything was accepted.
      res.writeHead(200, { "content-type": "application/x-protobuf" }).end();
    } catch (error) {
      console.error("server wrapper: dropping a span export:", error);
      res.writeHead(400).end();
    }
  });
}

async function waitForServer(port, exited) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited.code !== undefined) {
      throw new Error(`the launcher exited during startup (${exited.code})`);
    }
    const ready = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the launcher did not listen within 30s");
}

function start() {
  started ??= (async () => {
    const collectorPort = await listen(http.createServer(collectorHandler));
    const port = await freePort();
    const child = spawn(launcherPath, [], {
      env: {
        ...process.env,
        PORT: String(port),
        CLOUD_TRACE_COLLECTOR: `127.0.0.1:${collectorPort}`,
      },
      stdio: "inherit",
    });
    const exited = {};
    child.once("exit", (code, signal) => {
      exited.code = code ?? signal;
      console.error(`server wrapper: the launcher exited (${exited.code}); ending this instance`);
      process.exit(typeof code === "number" && code !== 0 ? code : 1);
    });
    process.once("SIGTERM", () => child.kill("SIGTERM"));
    // Never leave the launcher behind, as an aborted `vercel dev` would.
    process.once("exit", () => child.kill("SIGKILL"));
    await waitForServer(port, exited);
    return port;
  })();
  return started;
}

function forwardHeaders(incoming) {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (!hopByHop.has(name) && !clientTraceContext.has(name)) {
      headers[name] = value;
    }
  }
  const host = incoming["x-forwarded-host"];
  if (typeof host === "string" && host !== "") {
    headers.host = host;
  }
  return headers;
}

function responseHeaders(rawHeaders) {
  const kept = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!hopByHop.has(rawHeaders[i].toLowerCase())) {
      kept.push(rawHeaders[i], rawHeaders[i + 1]);
    }
  }
  return kept;
}

export default async function handler(req, res) {
  let port;
  try {
    port = await start();
  } catch (error) {
    console.error("server wrapper:", error);
    // Exit once the answer is out, so Vercel starts a fresh instance.
    res
      .writeHead(503, { "content-type": "text/plain" })
      .end("server unavailable\n", () => process.exit(1));
    return;
  }

  const context = globalThis[requestContext]?.get?.();
  const telemetry = context?.telemetry;
  const root = telemetry?.rootSpanContext;
  const headers = forwardHeaders(req.headers);
  let entry = null;
  if (root?.traceId && root?.spanId) {
    const traced =
      typeof telemetry.reportSpans === "function" && typeof context.waitUntil === "function";
    headers.traceparent = `00-${root.traceId}-${root.spanId}-${traced ? "01" : "00"}`;
    if (traced) {
      entry = router.open(root.traceId, root.spanId);
    }
  }

  const upstream = http.request({
    host: "127.0.0.1",
    port,
    method: req.method,
    path: req.url,
    headers,
  });
  upstream.once("response", (response) => {
    res.writeHead(
      response.statusCode ?? 502,
      response.statusMessage,
      responseHeaders(response.rawHeaders),
    );
    response.pipe(res);
  });
  upstream.once("error", (error) => {
    console.error("server wrapper: forwarding failed:", error);
    if (res.headersSent) {
      res.destroy(error);
    } else {
      res.writeHead(502, { "content-type": "text/plain" }).end("bad gateway\n");
    }
  });
  req.pipe(upstream);

  if (entry) {
    context.waitUntil(
      new Promise((resolve) => res.once("close", resolve))
        .then(() => router.close(entry, spanWaitMs))
        .then((spans) => {
          if (spans) {
            telemetry.reportSpans(spans);
          }
        })
        .catch((error) => console.error("server wrapper: reporting spans failed:", error)),
    );
  }
}
