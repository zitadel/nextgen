import assert from "node:assert/strict";
import { test } from "node:test";

import { MetricQueue } from "./metrics.mjs";

const DELTA = 1;
const CUMULATIVE = 2;
const attr = (key, stringValue) => ({ key, value: { stringValue } });
const exportOf = (...metrics) => ({ resourceMetrics: [{ scopeMetrics: [{ metrics }] }] });
const counter = (name, value, temporality = DELTA, attributes = []) => ({
  name,
  sum: {
    dataPoints: [{ attributes, value }],
    aggregationTemporality: temporality,
    isMonotonic: true,
  },
});
const level = (name, value) => ({
  name,
  sum: { dataPoints: [{ attributes: [], value }], aggregationTemporality: CUMULATIVE },
});
const histogram = (name, point, temporality = DELTA) => ({
  name,
  histogram: { dataPoints: [{ attributes: [], ...point }], aggregationTemporality: temporality },
});

test("a delta counter is one data point with its increase", () => {
  const queue = new MetricQueue();
  queue.ingest(
    exportOf(
      counter("events", 3, DELTA, [attr("type", "session.created")]),
      counter("idle", 0),
    ),
  );
  assert.deepEqual(queue.take(100), [
    { name: "events", value: 3, attributes: { type: "session.created" } },
  ]);
});

test("a cumulative counter is turned into its increase, also after a restart", () => {
  const queue = new MetricQueue();
  for (const value of [5, 5, 8, 2]) {
    queue.ingest(exportOf(counter("events", value, CUMULATIVE)));
  }
  assert.deepEqual(
    queue.take(100).map((point) => point.value),
    [5, 3, 2],
  );
});

test("a level is sent when it changes and repeated after a while", () => {
  let now = 0;
  const queue = new MetricQueue({ levelRepeatMs: 1000, now: () => now });
  const gauge = (value) => ({ name: "entries", gauge: { dataPoints: [{ attributes: [], value }] } });
  queue.ingest(exportOf(level("connections", 2), gauge(7)));
  queue.ingest(exportOf(level("connections", 2), gauge(7)));
  now = 500;
  queue.ingest(exportOf(level("connections", 3), gauge(7)));
  now = 1200;
  queue.ingest(exportOf(level("connections", 3), gauge(7)));
  assert.deepEqual(
    queue.take(100).map((point) => [point.name, point.value]),
    [
      ["connections", 2],
      ["entries", 7],
      ["connections", 3],
      ["entries", 7],
    ],
  );
});

test("a histogram is one data point per recorded value", () => {
  const queue = new MetricQueue();
  queue.ingest(
    exportOf(
      // Values in one bucket are replayed as their mean: the sum stays exact.
      histogram("one-bucket", {
        count: 2,
        sum: 0.03,
        bucketCounts: [0, 2, 0],
        explicitBounds: [0.01, 0.1],
        min: 0.012,
        max: 0.018,
      }),
      // Values across buckets, as the middle of each within min and max:
      // (0.004, 0.01], (0.01, 0.1] and (0.1, 0.5].
      histogram("spread", {
        count: 4,
        sum: 0.5,
        bucketCounts: [1, 2, 1],
        explicitBounds: [0.01, 0.1],
        min: 0.004,
        max: 0.5,
      }),
    ),
  );
  const points = queue.take(100);
  assert.deepEqual(
    points.filter((point) => point.name === "one-bucket").map((point) => point.value),
    [0.015, 0.015],
  );
  const spread = points.filter((point) => point.name === "spread").map((point) => point.value);
  assert.equal(spread.length, 4);
  assert.ok(Math.abs(spread[0] - 0.007) < 1e-12);
  assert.ok(Math.abs(spread[1] - 0.055) < 1e-12 && spread[1] === spread[2]);
  assert.ok(Math.abs(spread[3] - 0.3) < 1e-12);
});

test("what Vercel already has another way is not sent", () => {
  const queue = new MetricQueue();
  queue.ingest(
    exportOf(
      histogram("db.client.operation.duration", {
        count: 1,
        sum: 0.01,
        bucketCounts: [1],
        explicitBounds: [],
      }),
      counter("ogen.server.request_count", 4),
      counter("ogen.server.errors_count", 1),
      level("db.client.connection.count", 2),
      counter("zitadel.audit.events.written", 1),
    ),
  );
  assert.deepEqual(
    queue.take(100).map((point) => point.name),
    ["db.client.connection.count", "zitadel.audit.events.written"],
  );
  assert.equal(queue.unsupported, 0);
});

test("what has no replay is counted, not sent", () => {
  const queue = new MetricQueue();
  queue.ingest(
    exportOf(
      histogram("cumulative", { count: 1, sum: 1, bucketCounts: [1], explicitBounds: [] }, CUMULATIVE),
      { name: "exponential", exponentialHistogram: {} },
      { name: "summary", summary: {} },
    ),
  );
  assert.equal(queue.unsupported, 3);
  assert.equal(queue.queued, 0);
});

test("attributes are strings Vercel accepts", () => {
  const queue = new MetricQueue();
  queue.ingest(
    exportOf({
      name: "n".repeat(80),
      sum: {
        dataPoints: [
          {
            attributes: [
              attr("long", `${"x".repeat(62)}é`),
              attr("empty", ""),
              { key: "status", value: { intValue: 200 } },
              { key: "root", value: { boolValue: true } },
              { key: "list", value: { arrayValue: { values: [] } } },
            ],
            value: 1,
          },
        ],
        aggregationTemporality: DELTA,
        isMonotonic: true,
      },
    }),
  );
  assert.deepEqual(queue.take(1), [
    {
      name: "n".repeat(63),
      value: 1,
      attributes: { long: "x".repeat(62), status: "200", root: "true" },
    },
  ]);
});

test("take hands out at most what an invocation may send, and the queue is bounded", () => {
  const queue = new MetricQueue({ maxQueued: 5 });
  for (let i = 1; i <= 8; i++) {
    queue.ingest(exportOf(counter("events", i)));
  }
  assert.equal(queue.dropped, 3);
  assert.deepEqual(
    queue.take(2).map((point) => point.value),
    [4, 5],
  );
  assert.equal(queue.queued, 3);
});
