import assert from "node:assert/strict";
import { test } from "node:test";

import { deploymentAttributes, MetricQueue } from "./metrics.mjs";

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
// The queue with every instrument sent, to test what happens to each kind.
const queueOfAll = (options = {}) => new MetricQueue({ isReported: () => true, ...options });
const histogram = (name, point, temporality = DELTA) => ({
  name,
  histogram: { dataPoints: [{ attributes: [], ...point }], aggregationTemporality: temporality },
});

test("a counter's increases are added up per series until they are taken", () => {
  const queue = queueOfAll();
  for (const increase of [3, 2]) {
    queue.ingest(
      exportOf(
        counter("events", increase, DELTA, [attr("type", "session.created")]),
        counter("events", 1, DELTA, [attr("type", "user.created")]),
        counter("idle", 0),
      ),
    );
  }
  assert.deepEqual(queue.take(100), [
    { name: "events", value: 5, attributes: { type: "session.created" } },
    { name: "events", value: 2, attributes: { type: "user.created" } },
  ]);
  queue.ingest(exportOf(counter("events", 4, DELTA, [attr("type", "session.created")])));
  assert.deepEqual(queue.take(100), [
    { name: "events", value: 4, attributes: { type: "session.created" } },
  ]);
});

test("a cumulative counter is turned into its increase, also after a restart", () => {
  const queue = queueOfAll();
  const increases = [];
  for (const value of [5, 5, 8, 2]) {
    queue.ingest(exportOf(counter("events", value, CUMULATIVE)));
    increases.push(queue.take(100).map((point) => point.value));
  }
  assert.deepEqual(increases, [[5], [], [3], [2]]);
  // Untaken, the increases are one data point.
  queue.ingest(exportOf(counter("events", 6, CUMULATIVE)));
  queue.ingest(exportOf(counter("events", 9, CUMULATIVE)));
  assert.deepEqual(
    queue.take(100).map((point) => point.value),
    [7],
  );
});

test("a level is sent when it rises and repeated after a while", () => {
  let now = 0;
  const queue = queueOfAll({ levelRepeatMs: 1000, now: () => now });
  const gauge = (value) => ({
    name: "entries",
    gauge: { dataPoints: [{ attributes: [], value }] },
  });
  const levels = () => queue.take(100).map((point) => [point.name, point.value]);

  queue.ingest(exportOf(level("connections", 2), gauge(7)));
  assert.deepEqual(levels(), [
    ["connections", 2],
    ["entries", 7],
  ]);
  queue.ingest(exportOf(level("connections", 2), gauge(7)));
  assert.deepEqual(levels(), [], "unchanged");
  now = 500;
  queue.ingest(exportOf(level("connections", 3), gauge(7)));
  assert.deepEqual(levels(), [["connections", 3]], "a rise is sent at once");
  now = 1200;
  queue.ingest(exportOf(level("connections", 3), gauge(7)));
  assert.deepEqual(levels(), [["entries", 7]], "repeated after levelRepeatMs");
});

test("a level is sent as the highest it reached, and a fall only after a while", () => {
  let now = 0;
  const queue = queueOfAll({ levelRepeatMs: 1000, now: () => now });
  const values = () => queue.take(100).map((point) => point.value);

  // A request takes a connection and gives it back between two sends.
  for (const value of [0, 1, 0]) {
    queue.ingest(exportOf(level("connections", value)));
  }
  assert.deepEqual(values(), [1], "the peak, not the latest");

  // The same again: nothing new to say, however many requests do it.
  for (const value of [0, 1, 0, 1, 0]) {
    queue.ingest(exportOf(level("connections", value)));
  }
  assert.equal(queue.queued, 0);
  assert.equal(queue.age, 0, "a level that did not rise does not wait to be sent");
  assert.deepEqual(values(), []);

  // A higher peak is sent at once.
  queue.ingest(exportOf(level("connections", 4)));
  queue.ingest(exportOf(level("connections", 0)));
  assert.equal(queue.queued, 1);
  assert.deepEqual(values(), [4]);

  // The fall is sent once levelRepeatMs passed, as the highest since.
  now = 600;
  queue.ingest(exportOf(level("connections", 0)));
  queue.ingest(exportOf(level("connections", 1)));
  assert.deepEqual(values(), []);
  now = 1100;
  queue.ingest(exportOf(level("connections", 0)));
  assert.deepEqual(values(), [1]);
});

test("age is how long the oldest waiting data point has waited", () => {
  let now = 1000;
  const queue = queueOfAll({ now: () => now });
  assert.equal(queue.age, 0);
  queue.ingest(exportOf(counter("events", 1)));
  now = 1400;
  queue.ingest(exportOf(counter("events", 1), level("connections", 2)));
  now = 1900;
  assert.equal(queue.age, 900);
  queue.take(1);
  assert.equal(queue.age, 900, "what is left has waited as long");
  queue.take(100);
  assert.equal(queue.age, 0);
  now = 2500;
  queue.ingest(exportOf(counter("events", 1)));
  now = 2600;
  assert.equal(queue.age, 100);
});

test("a histogram is one data point per recorded value", () => {
  const queue = queueOfAll();
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

test("only the instruments named for Vercel are sent", () => {
  const queue = new MetricQueue();
  const duration = (name) =>
    histogram(name, { count: 1, sum: 0.01, bucketCounts: [1], explicitBounds: [] });
  queue.ingest(
    exportOf(
      // A data point per value or per request, and the spans tell the same.
      duration("db.client.operation.duration"),
      duration("zitadel.audit.insert.duration"),
      duration("zitadel.auth.credential.validation.duration"),
      duration("ogen.server.duration"),
      counter("ogen.server.request_count", 4),
      counter("zitadel.audit.events.written", 1),
      counter("zitadel.auth.token.revocation_checks", 1),
      counter("zitadel.cache.lookups", 1),
      // Not named yet: an instrument the server adds is not sent by itself.
      counter("zitadel.something.new", 1),
      // What only a metric says.
      counter("zitadel.auth.attempt.outcomes", 1),
      counter("zitadel.flow.step.transitions", 2),
      counter("zitadel.password_hashing.rejected", 1),
      counter("zitadel.cache.evictions", 1),
      level("db.client.connection.count", 2),
      level("zitadel.password_hashing.in_flight", 1),
      level("zitadel.password_hashing.waiting", 3),
    ),
  );
  assert.deepEqual(
    queue
      .take(100)
      .map((point) => point.name)
      .sort(),
    [
      "db.client.connection.count",
      "zitadel.auth.attempt.outcomes",
      "zitadel.cache.evictions",
      "zitadel.flow.step.transitions",
      "zitadel.password_hashing.in_flight",
      "zitadel.password_hashing.rejected",
      "zitadel.password_hashing.waiting",
    ],
  );
  assert.equal(queue.unsupported, 0);
});

test("what has no replay is counted, not sent", () => {
  const queue = queueOfAll();
  queue.ingest(
    exportOf(
      histogram(
        "cumulative",
        { count: 1, sum: 1, bucketCounts: [1], explicitBounds: [] },
        CUMULATIVE,
      ),
      { name: "exponential", exponentialHistogram: {} },
      { name: "summary", summary: {} },
    ),
  );
  assert.equal(queue.unsupported, 3);
  assert.equal(queue.queued, 0);
});

test("attributes are strings Vercel accepts", () => {
  const queue = queueOfAll();
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

test("every data point carries the deployment's attributes", () => {
  const queue = queueOfAll({ attributes: { environment: "preview" } });
  queue.ingest(
    exportOf(
      counter("events", 2, DELTA, [
        attr("type", "session.created"),
        // The deployment's replaces a data point's own.
        attr("environment", "theirs"),
      ]),
      level("connections", 3),
      histogram("duration", { count: 1, sum: 4, bucketCounts: [1], explicitBounds: [] }),
    ),
  );
  assert.deepEqual(queue.take(100), [
    { name: "events", value: 2, attributes: { type: "session.created", environment: "preview" } },
    { name: "connections", value: 3, attributes: { environment: "preview" } },
    { name: "duration", value: 4, attributes: { environment: "preview" } },
  ]);

  // They count toward the 50 attributes Vercel takes.
  const many = Array.from({ length: 60 }, (_, n) => attr(`a${n}`, "v"));
  queue.ingest(exportOf(counter("wide", 1, DELTA, many)));
  const [{ attributes }] = queue.take(100);
  assert.equal(Object.keys(attributes).length, 50);
  assert.equal(attributes.environment, "preview");
  assert.equal(attributes.a48, "v");
  assert.equal(attributes.a49, undefined);
});

test("the environment is the deployment's, and absent outside one", () => {
  assert.deepEqual(deploymentAttributes({ VERCEL_ENV: "production" }), {
    environment: "production",
  });
  assert.deepEqual(deploymentAttributes({ VERCEL_ENV: "preview" }), { environment: "preview" });
  assert.deepEqual(deploymentAttributes({ VERCEL_ENV: "" }), {});
  assert.deepEqual(deploymentAttributes({}), {});
});

test("take hands out at most what an invocation may send, counters and levels first", () => {
  const queue = queueOfAll({ maxQueued: 5 });
  const one = (value) =>
    histogram("duration", { count: 1, sum: value, bucketCounts: [1], explicitBounds: [] });
  for (let i = 1; i <= 8; i++) {
    queue.ingest(exportOf(one(i), counter("events", 1)));
  }
  assert.equal(queue.dropped, 3, "histogram values past maxQueued, oldest first");
  assert.deepEqual(
    queue.take(3).map((point) => [point.name, point.value]),
    [
      ["events", 8],
      ["duration", 4],
      ["duration", 5],
    ],
  );
  assert.equal(queue.queued, 3);
});
