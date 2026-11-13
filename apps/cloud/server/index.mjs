// The cloud's `server` service (repo-root vercel.json): a Node.js function in
// front of the Go server, so the server's telemetry reaches Vercel: its spans
// Vercel Tracing, its metrics Vercel's custom metrics, and its log lines the
// request and level they belong to. Only a Node.js function gets the hooks
// for these: the request context, whose reportSpans adds spans to the
// request's trace and under which console prints a request's log lines, and
// the runtime's sendMetric, which `metric()` of @vercel/functions calls. A Go
// function has none of them.
//
// On an instance's first request the wrapper starts the launcher
// (apps/api/cmd/cloud-launcher, built into ../dist/nextgen-launcher and
// shipped through the service's includeFiles) on a loopback port, as Vercel's
// Go preset starts it behind its own proxy, and then:
//
// - forwards every request to it, streaming both bodies. The host is the one
//   the client asked for (x-forwarded-host), as the Go preset's proxy sets it.
// - relays its output to Vercel's logs a line at a time, each line at its
//   level and under its request (logs.mjs).
//
// While Vercel is the telemetry sink, which it is unless the environment
// names an OTLP backend (sink.mjs), the wrapper also:
//
// - replaces the client's trace context: traceparent comes from Vercel's root
//   span for the request, so the server, which trusts traceparent here
//   (CLOUD_OTLP_COLLECTOR), only ever continues a trace Vercel started.
//   tracestate and baggage are dropped.
// - receives the server's spans and metrics as OTLP/HTTP protobuf on a
//   loopback collector. Spans are sorted by request (spans.mjs) and each
//   request's spans handed to reportSpans once the response is done, in
//   waitUntil. Metrics are aggregated into Vercel data points (metrics.mjs),
//   as a collector would, and sent from a request's waitUntil, because Vercel
//   ties a data point to the invocation reporting it. A request sends them
//   when it is the last one in flight, after the server's next export, so an
//   instance never goes idle holding metrics; while other requests are in
//   flight, only once the oldest has waited metricHoldMs. A busy instance
//   therefore sends a counter once per interval instead of once per request.
//
// With an OTLP backend named, the launcher points the server's spans, metrics
// and logs at it, and the wrapper starts no collector and waits for nothing.
//
// If the launcher exits, so does this process, and Vercel replaces the
// instance.

import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

import { collectorHandler } from "./collector.mjs";
import { LogRelay, vercelRequestId } from "./logs.mjs";
import { MetricQueue } from "./metrics.mjs";
import { decodeMetricsRequest, decodeTraceRequest } from "./otlp.mjs";
import { sendsToVercel } from "./sink.mjs";
import { SpanRouter } from "./spans.mjs";

const launcherPath = fileURLToPath(new URL("../dist/nextgen-launcher", import.meta.url));
const requestContext = Symbol.for("@vercel/request-context");
// What `metric()` of @vercel/functions calls; the package is that one line.
const runtimeIpc = Symbol.for("@vercel/rusty-runtime-ipc");
// Vercel records up to 100 data points per invocation.
const metricsPerRequest = 100;
// How long a busy instance aggregates metrics before a request sends them.
const metricHoldMs = 10_000;
// How long the last request in flight waits for the server's next metric
// export, which carries what that request recorded. The launcher sets the
// server's export interval to 100ms.
const metricWaitMs = 300;
// How long a finished response waits for its server span. The launcher sets
// the server's batch timeout to 100ms.
const spanWaitMs = 1000;
// How long a finished response keeps its request open for the server's last
// log lines about it: they come through a pipe, after the response.
const logGraceMs = 25;
// The largest export the collector takes (collector.mjs).
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

const toVercel = sendsToVercel(process.env);
const router = new SpanRouter();
const metrics = new MetricQueue();
// The context is taken while the module loads, outside every request.
const logs = new LogRelay({ outside: AsyncLocalStorage.snapshot() });
let warnedOfMissingSpans = false;
let metricExports = 0;
let missedMetricExport = false;
let inFlight = 0;
let onMetricExport = [];
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

// The OTLP/HTTP paths the server exports to, and what takes each export. A
// Map, so a path can only name one of these, never an inherited property.
const collectors = new Map([
  ["/v1/traces", (body) => router.ingest(decodeTraceRequest(body))],
  [
    "/v1/metrics",
    (body) => {
      metrics.ingest(decodeMetricsRequest(body));
      metricExports++;
      const waiting = onMetricExport;
      onMetricExport = [];
      for (const resolve of waiting) {
        resolve();
      }
    },
  ],
]);

// Resolves on the server's next metric export, or after metricWaitMs. As for
// spans, once a wait ran out no request waits again until the server's first
// export arrives.
function nextMetricExport() {
  if (missedMetricExport && metricExports === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      missedMetricExport = true;
      resolve();
    }, metricWaitMs);
    onMetricExport.push(() => {
      clearTimeout(timer);
      resolve();
    });
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
    const port = await freePort();
    const env = { ...process.env, PORT: String(port) };
    // The collector's address tells the launcher that Vercel is the sink.
    delete env.CLOUD_OTLP_COLLECTOR;
    if (toVercel) {
      const collector = http.createServer(
        collectorHandler(collectors, { maxBytes: maxExportBytes }),
      );
      // The server's exporters reuse their connections, so the collector
      // never closes an idle one: an instance wakes from a pause with the
      // idle timer long expired, and the export the server then sent on the
      // closed connection failed (EOF, connection reset) and was lost.
      collector.keepAliveTimeout = 0;
      env.CLOUD_OTLP_COLLECTOR = `127.0.0.1:${await listen(collector)}`;
    }
    const child = spawn(launcherPath, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    logs.read(child.stdout);
    logs.read(child.stderr);
    const exited = {};
    const ended = (code, signal) => {
      exited.code = code ?? signal;
      console.error(`server wrapper: the launcher exited (${exited.code}); ending this instance`);
      process.exit(typeof code === "number" && code !== 0 ? code : 1);
    };
    // "close" follows "exit" once the output was read to its end, so the
    // launcher's last words are relayed before this process ends. Should a
    // stream stay open, the exit alone ends the instance a moment later.
    child.once("close", ended);
    child.once("exit", (code, signal) => setTimeout(ended, 1000, code, signal));
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
  // The server's log lines for this request are printed in its context, and
  // the lines of the server starting in the context of the request that
  // started it.
  const requestId = vercelRequestId(req.headers["x-vercel-id"]);
  logs.open(requestId, AsyncLocalStorage.snapshot());
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

  inFlight++;
  const closed = new Promise((resolve) => res.once("close", resolve)).then(() => {
    inFlight--;
  });

  const context = globalThis[requestContext]?.get?.();
  const telemetry = context?.telemetry;
  const root = toVercel ? telemetry?.rootSpanContext : undefined;
  const headers = forwardHeaders(req.headers);
  let entry = null;
  if (root?.traceId && root?.spanId) {
    const traced =
      typeof telemetry.reportSpans === "function" && typeof context.waitUntil === "function";
    headers.traceparent = `00-${root.traceId}-${root.spanId}-${traced ? "01" : "00"}`;
    // Once a traced request got no spans, none waits for them again until
    // the server's first export arrives: a server that does not export costs
    // one wait per instance, not one per request.
    if (traced && !(warnedOfMissingSpans && router.exports === 0)) {
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

  const reported = closed
    .then(() =>
      Promise.all([
        entry ? router.close(entry, spanWaitMs) : null,
        toVercel && inFlight === 0 ? nextMetricExport() : null,
        new Promise((resolve) => setTimeout(resolve, logGraceMs)),
      ]),
    )
    .then(([spans]) => {
      if (spans) {
        telemetry.reportSpans(spans);
      } else if (entry && router.exports === 0 && !warnedOfMissingSpans) {
        // Said once per instance: a wait of spanWaitMs for spans that do not
        // come is paid for, and easy to miss. A path that matches no route
        // gets no span either, but then the server has exported before.
        warnedOfMissingSpans = true;
        console.warn(
          "server wrapper: a traced request got no spans within %dms and the server has exported none yet; no request waits for spans until it does",
          spanWaitMs,
        );
      }
      // Another request may have arrived while this one waited; it sends.
      if (toVercel && (inFlight === 0 || metrics.age >= metricHoldMs)) {
        sendMetrics();
      }
    })
    .catch((error) => console.error("server wrapper: reporting telemetry failed:", error))
    .finally(() => logs.close(requestId));
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(reported);
  }
}

// Called in a request's waitUntil, so Vercel counts the data points to it.
function sendMetrics() {
  const sendMetric = globalThis[runtimeIpc]?.sendMetric;
  if (typeof sendMetric !== "function") {
    return;
  }
  for (const point of metrics.take(metricsPerRequest)) {
    sendMetric.call(globalThis[runtimeIpc], point.name, point.value, point.attributes);
  }
}
