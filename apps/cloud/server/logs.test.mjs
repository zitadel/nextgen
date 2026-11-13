import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { LogRelay, vercelRequestId } from "./logs.mjs";

// Stands in for Vercel's request context: what a console call sees is the
// request Vercel files the line under.
const request = new AsyncLocalStorage();

function relayWithRecorder() {
  const printed = [];
  const record = (method) => (text) => printed.push([method, request.getStore() ?? null, text]);
  const relay = new LogRelay({
    outside: AsyncLocalStorage.snapshot(),
    console: {
      log: record("log"),
      debug: record("debug"),
      warn: record("warn"),
      error: record("error"),
    },
  });
  return { relay, printed };
}

const served = (requestId, level = "INFO") =>
  JSON.stringify({ level, msg: "request served", request_id: requestId });

test("a line is printed in the context of the request it names", () => {
  const { relay, printed } = relayWithRecorder();
  request.run("first", () => relay.open("req-1", AsyncLocalStorage.snapshot()));
  request.run("second", () => relay.open("req-2", AsyncLocalStorage.snapshot()));

  // Whatever request happens to be running when the line arrives.
  request.run("second", () => {
    relay.line(served("req-1"));
    relay.line(served("req-2"));
  });

  assert.deepEqual(
    printed.map(([, context]) => context),
    ["first", "second"],
  );
  assert.equal(printed[0][2], served("req-1"), "unchanged");
});

test("a line that names no open request is printed under the newest in flight", () => {
  const { relay, printed } = relayWithRecorder();
  const background = JSON.stringify({ level: "ERROR", msg: "flushing audit events failed" });

  // The server starts during the request that started the instance.
  request.run("first", () => relay.open("req-1", AsyncLocalStorage.snapshot()));
  relay.line(JSON.stringify({ level: "WARN", msg: "the Go memory limit could not be set" }));
  request.run("second", () => relay.open("req-2", AsyncLocalStorage.snapshot()));
  relay.line(background);
  relay.line(served("req-closed-long-ago"));
  relay.close("req-2");
  relay.line(background);
  relay.close("req-1");
  // Nothing in flight: outside any request.
  request.run("third", () => relay.line(background));

  assert.deepEqual(
    printed.map(([method, context]) => [method, context]),
    [
      ["warn", "first"],
      ["error", "second"],
      ["log", "second"],
      ["error", "first"],
      ["error", null],
    ],
  );
  assert.equal(relay.openCount, 0);
});

test("a line is printed at the level it names", () => {
  const { relay, printed } = relayWithRecorder();
  for (const level of ["DEBUG", "DEBUG-2", "INFO", "WARN", "WARN+1", "ERROR", "ERROR+4"]) {
    relay.line(JSON.stringify({ level, msg: "m" }));
  }
  relay.line("launcher: serving the production database");
  relay.line('{"level": 7}');
  relay.line("{not json");
  relay.line("");
  assert.deepEqual(
    printed.map(([method]) => method),
    ["debug", "debug", "log", "warn", "warn", "error", "error", "log", "log", "log"],
  );
});

test("the output is read a line at a time, however it is chunked", async () => {
  const { relay, printed } = relayWithRecorder();
  const output = new PassThrough();
  relay.read(output);
  const first = served("req-1", "WARN");
  output.write(first.slice(0, 10));
  output.write(`${first.slice(10)}\nplain line\n{"level":"ERR`);
  output.end('OR","msg":"last, without a newline"}');
  await once(output, "close");
  // readline delivers the last line after the stream ends.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    printed.map(([method, , text]) => [method, text]),
    [
      ["warn", first],
      ["log", "plain line"],
      ["error", '{"level":"ERROR","msg":"last, without a newline"}'],
    ],
  );
});

test("the request ID is the last part of x-vercel-id", () => {
  assert.equal(
    vercelRequestId("sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630"),
    "2vxlh-1792820352212-3ce3eb4ad630",
  );
  assert.equal(
    vercelRequestId("2vxlh-1792820352212-3ce3eb4ad630"),
    "2vxlh-1792820352212-3ce3eb4ad630",
  );
  assert.equal(vercelRequestId(undefined), "");
  assert.equal(vercelRequestId(["a", "b"]), "");
});
