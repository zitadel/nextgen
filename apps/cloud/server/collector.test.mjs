import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { collectorHandler } from "./collector.mjs";

// Above gzip's own overhead, so a small gzip export fits.
const maxBytes = 64;

// A collector on a loopback port, taking /v1/traces into `taken` and failing
// every /v1/metrics export.
async function start(t) {
  const taken = [];
  const collectors = new Map([
    ["/v1/traces", (body) => taken.push(body.toString())],
    [
      "/v1/metrics",
      () => {
        throw new Error("does not decode");
      },
    ],
  ]);
  const logged = t.mock.method(console, "error", () => {});
  const server = http.createServer(collectorHandler(collectors, { maxBytes }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, taken, logged };
}

function send(port, { path = "/v1/traces", method = "POST", body = "", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, agent: false, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("takes an export at its path and answers 200", async (t) => {
  const { port, taken } = await start(t);
  const res = await send(port, { body: "spans" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/x-protobuf");
  assert.deepEqual(taken, ["spans"]);
});

test("inflates a gzip export", async (t) => {
  const { port, taken } = await start(t);
  const res = await send(port, {
    body: gzipSync("spans"),
    headers: { "content-encoding": "gzip" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(taken, ["spans"]);
});

test("answers 404 for what no collector takes", async (t) => {
  const { port, taken } = await start(t);
  for (const path of ["/v1/logs", "/v1/traces/", "/constructor"]) {
    assert.equal((await send(port, { path, body: "x" })).statusCode, 404, path);
  }
  assert.equal((await send(port, { method: "GET" })).statusCode, 404, "GET");
  assert.deepEqual(taken, []);
});

test("answers 413 for an export over maxBytes and keeps none of it", async (t) => {
  const { port, taken, logged } = await start(t);
  const res = await send(port, { body: "x".repeat(maxBytes + 1) });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(taken, []);
  assert.deepEqual(logged.mock.calls[0].arguments, [
    "server wrapper: dropping an export to %s over %d bytes",
    "/v1/traces",
    maxBytes,
  ]);
  // Exactly maxBytes is still taken.
  assert.equal((await send(port, { body: "x".repeat(maxBytes) })).statusCode, 200);
});

test("answers 413 before the exporter has finished sending", async (t) => {
  const { port, taken } = await start(t);
  const res = await new Promise((resolve, reject) => {
    // Chunked, with no length to reject up front; the request is never ended.
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/traces",
      method: "POST",
      agent: false,
    });
    req.on("response", (response) => {
      req.destroy();
      resolve(response);
    });
    req.on("error", reject);
    req.write("x".repeat(maxBytes + 1));
  });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(taken, []);
});

test("answers 400 for an export that does not decode or inflates past maxBytes", async (t) => {
  const { port, taken } = await start(t);
  assert.equal((await send(port, { path: "/v1/metrics", body: "x" })).statusCode, 400);
  const bomb = gzipSync("x".repeat(maxBytes * 64));
  assert.ok(bomb.length <= maxBytes, "small enough to pass the size check");
  const res = await send(port, { body: bomb, headers: { "content-encoding": "gzip" } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(taken, []);
});
