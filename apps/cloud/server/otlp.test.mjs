import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeMetricsRequest, decodeTraceRequest } from "./otlp.mjs";

// A minimal protobuf writer, enough to build the messages the Go SDK sends.
const varint = (value) => {
  let v = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
};
const tag = (field, wire) => varint((field << 3) | wire);
const bytes = (field, payload) => [...tag(field, 2), ...varint(payload.length), ...payload];
const str = (field, value) => bytes(field, [...Buffer.from(value, "utf8")]);
const uint = (field, value) => [...tag(field, 0), ...varint(value)];
const fixed64 = (field, value) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return [...tag(field, 1), ...b];
};
const double = (field, value) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value);
  return [...tag(field, 1), ...b];
};
const fixed32 = (field, value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return [...tag(field, 5), ...b];
};
const hexBytes = (field, value) => bytes(field, [...Buffer.from(value, "hex")]);
const kv = (key, anyValue) => [...str(1, key), ...bytes(2, anyValue)];

test("decodes a span export into the OTLP JSON Vercel takes", () => {
  const traceId = "5eda2733b02768fe85e11e0219452947";
  const attributes = [
    ...bytes(9, kv("http.route", str(1, "/api/v1/users"))),
    ...bytes(9, kv("http.status_code", uint(3, 200))),
    ...bytes(9, kv("delta", uint(3, -5))),
    ...bytes(9, kv("ratio", double(4, 0.25))),
    ...bytes(9, kv("cached", uint(2, 1))),
    ...bytes(9, kv("tags", bytes(5, [...bytes(1, str(1, "a")), ...bytes(1, uint(3, 7))]))),
    ...bytes(9, kv("nested", bytes(6, bytes(1, kv("k", str(1, "v")))))),
    ...bytes(9, kv("raw", bytes(7, [1, 2, 3]))),
  ];
  const serverSpan = [
    ...hexBytes(1, traceId),
    ...hexBytes(2, "0d1ddef4796eb1a4"),
    ...hexBytes(4, "c4fef8ac1825e14b"),
    ...str(5, "GET /api/v1/users"),
    ...uint(6, 2),
    ...fixed64(7, "1794009925260000000"),
    ...fixed64(8, "1794009925290366659"),
    ...attributes,
    ...bytes(11, [
      ...fixed64(1, "1794009925270000000"),
      ...str(2, "exception"),
      ...bytes(3, kv("exception.message", str(1, "boom"))),
    ]),
    ...bytes(13, [...hexBytes(1, traceId), ...hexBytes(2, "aced6a14155b707e"), ...fixed32(6, 257)]),
    ...bytes(15, [...str(2, "failed"), ...uint(3, 2)]),
    ...fixed32(16, 769),
    // An unknown field, as a newer SDK might send: skipped.
    ...uint(99, 1),
  ];
  const rootSpan = [
    ...hexBytes(1, traceId),
    ...hexBytes(2, "aced6a14155b707e"),
    ...str(5, "job"),
    ...uint(6, 1),
  ];
  const scopeSpans = [
    ...bytes(1, [...str(1, "github.com/zitadel/nextgen"), ...str(2, "1.0.0")]),
    ...bytes(2, serverSpan),
    ...bytes(2, rootSpan),
  ];
  const resource = bytes(1, kv("service.name", str(1, "zitadel")));
  const request = bytes(1, [
    ...bytes(1, resource),
    ...bytes(2, scopeSpans),
    ...str(3, "https://opentelemetry.io/schemas/1.26.0"),
  ]);

  const decoded = decodeTraceRequest(new Uint8Array(request));

  assert.equal(decoded.resourceSpans.length, 1);
  const rs = decoded.resourceSpans[0];
  assert.deepEqual(rs.resource.attributes, [
    { key: "service.name", value: { stringValue: "zitadel" } },
  ]);
  assert.equal(rs.schemaUrl, "https://opentelemetry.io/schemas/1.26.0");
  const [ss] = rs.scopeSpans;
  assert.deepEqual(ss.scope, {
    name: "github.com/zitadel/nextgen",
    version: "1.0.0",
    attributes: [],
    droppedAttributesCount: 0,
  });

  const [server, root] = ss.spans;
  assert.equal(server.traceId, traceId);
  assert.equal(server.spanId, "0d1ddef4796eb1a4");
  assert.equal(server.parentSpanId, "c4fef8ac1825e14b");
  assert.equal(server.name, "GET /api/v1/users");
  assert.equal(server.kind, 2);
  assert.equal(server.startTimeUnixNano, "1794009925260000000");
  assert.equal(server.endTimeUnixNano, "1794009925290366659");
  assert.equal(server.flags, 769);
  assert.deepEqual(server.status, { code: 2, message: "failed" });
  assert.deepEqual(server.attributes, [
    { key: "http.route", value: { stringValue: "/api/v1/users" } },
    { key: "http.status_code", value: { intValue: 200 } },
    { key: "delta", value: { intValue: -5 } },
    { key: "ratio", value: { doubleValue: 0.25 } },
    { key: "cached", value: { boolValue: true } },
    { key: "tags", value: { arrayValue: { values: [{ stringValue: "a" }, { intValue: 7 }] } } },
    {
      key: "nested",
      value: { kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] } },
    },
    { key: "raw", value: { bytesValue: "AQID" } },
  ]);
  assert.deepEqual(server.events, [
    {
      timeUnixNano: "1794009925270000000",
      name: "exception",
      attributes: [{ key: "exception.message", value: { stringValue: "boom" } }],
      droppedAttributesCount: 0,
    },
  ]);
  assert.deepEqual(server.links, [
    { traceId, spanId: "aced6a14155b707e", attributes: [], droppedAttributesCount: 0, flags: 257 },
  ]);

  assert.equal(root.parentSpanId, undefined, "a root span has no parent");
  assert.equal(root.kind, 1);
  assert.deepEqual(root.status, { code: 0 });
});

test("rejects a truncated export", () => {
  const request = bytes(1, bytes(2, bytes(2, hexBytes(1, "5eda2733b02768fe85e11e0219452947"))));
  assert.throws(
    () => decodeTraceRequest(new Uint8Array(request.slice(0, request.length - 3))),
    /truncated/,
  );
});

const packedFixed64 = (field, values) => {
  const b = Buffer.alloc(8 * values.length);
  values.forEach((value, i) => b.writeBigUInt64LE(BigInt(value), 8 * i));
  return bytes(field, [...b]);
};
const packedDouble = (field, values) => {
  const b = Buffer.alloc(8 * values.length);
  values.forEach((value, i) => b.writeDoubleLE(value, 8 * i));
  return bytes(field, [...b]);
};
const sfixed64 = (field, value) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return [...tag(field, 1), ...b];
};

test("decodes a metrics export", () => {
  const counter = [
    ...str(1, "zitadel.audit.events.written"),
    ...str(3, "{event}"),
    ...bytes(7, [
      ...bytes(1, [
        ...fixed64(3, "1794009925290366659"),
        ...sfixed64(6, 3),
        ...bytes(7, kv("type", str(1, "session.created"))),
      ]),
      ...uint(2, 1),
      ...uint(3, 1),
    ]),
  ];
  const level = [
    ...str(1, "db.client.connection.count"),
    ...bytes(7, [...bytes(1, [...sfixed64(6, -2)]), ...uint(2, 2)]),
  ];
  const gauge = [...str(1, "cache.entries"), ...bytes(5, bytes(1, double(4, 12.5)))];
  const histogram = [
    ...str(1, "db.client.operation.duration"),
    ...str(3, "s"),
    ...bytes(9, [
      ...bytes(1, [
        ...fixed64(3, "1794009925290366659"),
        ...fixed64(4, 3),
        ...double(5, 0.035),
        ...packedFixed64(6, [1, 2, 0]),
        ...packedDouble(7, [0.01, 0.1]),
        ...bytes(9, kv("db.query.summary", str(1, "SELECT users"))),
        ...double(11, 0.005),
        ...double(12, 0.02),
        // An exemplar, which nothing reads: skipped.
        ...bytes(8, double(3, 0.02)),
      ]),
      ...uint(2, 1),
    ]),
  ];
  const exponential = [...str(1, "exp"), ...bytes(10, uint(2, 1))];
  const request = bytes(1, [
    ...bytes(1, bytes(1, kv("service.name", str(1, "zitadel")))),
    ...bytes(2, [
      ...bytes(1, str(1, "github.com/zitadel/nextgen")),
      ...bytes(2, counter),
      ...bytes(2, level),
      ...bytes(2, gauge),
      ...bytes(2, histogram),
      ...bytes(2, exponential),
    ]),
  ]);

  const decoded = decodeMetricsRequest(new Uint8Array(request));

  const [rm] = decoded.resourceMetrics;
  assert.deepEqual(rm.resource.attributes, [
    { key: "service.name", value: { stringValue: "zitadel" } },
  ]);
  const [sm] = rm.scopeMetrics;
  assert.equal(sm.scope.name, "github.com/zitadel/nextgen");
  assert.deepEqual(sm.metrics, [
    {
      name: "zitadel.audit.events.written",
      unit: "{event}",
      sum: {
        dataPoints: [
          {
            attributes: [{ key: "type", value: { stringValue: "session.created" } }],
            timeUnixNano: "1794009925290366659",
            value: 3,
          },
        ],
        aggregationTemporality: 1,
        isMonotonic: true,
      },
    },
    {
      name: "db.client.connection.count",
      sum: {
        dataPoints: [{ attributes: [], timeUnixNano: "0", value: -2 }],
        aggregationTemporality: 2,
      },
    },
    {
      name: "cache.entries",
      gauge: { dataPoints: [{ attributes: [], timeUnixNano: "0", value: 12.5 }] },
    },
    {
      name: "db.client.operation.duration",
      unit: "s",
      histogram: {
        dataPoints: [
          {
            attributes: [{ key: "db.query.summary", value: { stringValue: "SELECT users" } }],
            timeUnixNano: "1794009925290366659",
            count: 3,
            sum: 0.035,
            bucketCounts: [1, 2, 0],
            explicitBounds: [0.01, 0.1],
            min: 0.005,
            max: 0.02,
          },
        ],
        aggregationTemporality: 1,
      },
    },
    { name: "exp", exponentialHistogram: {} },
  ]);
});
