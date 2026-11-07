// Decodes an OTLP/HTTP protobuf trace export (ExportTraceServiceRequest, as
// the Go SDK's otlptracehttp exporter sends it) into the OTLP JSON object
// Vercel's reportSpans takes, the shape @vercel/otel hands it: hex trace and
// span IDs, nanosecond timestamps and 64-bit integers as decimal strings,
// enums as numbers. Only the trace messages are read; unknown fields are
// skipped, as protobuf requires.
//
// Field numbers: opentelemetry-proto, opentelemetry/proto/trace/v1/trace.proto
// and opentelemetry/proto/common/v1/common.proto.

const VARINT = 0;
const I64 = 1;
const LEN = 2;
const I32 = 5;

const utf8 = new TextDecoder();

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  done() {
    return this.pos >= this.bytes.length;
  }

  need(n) {
    if (this.pos + n > this.bytes.length) {
      throw new Error("otlp: truncated message");
    }
  }

  varint() {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      this.need(1);
      const byte = this.bytes[this.pos++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return BigInt.asUintN(64, value);
      }
    }
    throw new Error("otlp: varint longer than 10 bytes");
  }

  fixed64() {
    this.need(8);
    const value = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return value;
  }

  double() {
    this.need(8);
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  fixed32() {
    this.need(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  chunk() {
    const length = Number(this.varint());
    this.need(length);
    const chunk = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return chunk;
  }

  skip(wire) {
    switch (wire) {
      case VARINT:
        this.varint();
        return;
      case I64:
        this.need(8);
        this.pos += 8;
        return;
      case LEN:
        this.chunk();
        return;
      case I32:
        this.need(4);
        this.pos += 4;
        return;
      default:
        throw new Error(`otlp: unsupported wire type ${wire}`);
    }
  }
}

// Reads one message: fields maps a field number to [wire type, read]. A field
// with another wire type than expected is skipped like an unknown one.
function readMessage(bytes, target, fields) {
  const reader = new Reader(bytes);
  while (!reader.done()) {
    const tag = Number(reader.varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    const known = fields[field];
    if (known && known[0] === wire) {
      known[1](reader, target);
    } else {
      reader.skip(wire);
    }
  }
  return target;
}

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const text = (reader) => utf8.decode(reader.chunk());
const count = (reader) => Number(BigInt.asUintN(32, reader.varint()));

function anyValue(bytes) {
  return readMessage(
    bytes,
    {},
    {
      1: [LEN, (r, v) => (v.stringValue = text(r))],
      2: [VARINT, (r, v) => (v.boolValue = r.varint() !== 0n)],
      3: [VARINT, (r, v) => (v.intValue = BigInt.asIntN(64, r.varint()).toString())],
      4: [I64, (r, v) => (v.doubleValue = r.double())],
      5: [LEN, (r, v) => (v.arrayValue = { values: values(r.chunk(), anyValue) })],
      6: [LEN, (r, v) => (v.kvlistValue = { values: values(r.chunk(), keyValue) })],
      7: [LEN, (r, v) => (v.bytesValue = Buffer.from(r.chunk()).toString("base64"))],
    },
  );
}

// ArrayValue and KeyValueList: field 1, repeated.
function values(bytes, decode) {
  const list = [];
  readMessage(bytes, null, { 1: [LEN, (r) => list.push(decode(r.chunk()))] });
  return list;
}

function keyValue(bytes) {
  return readMessage(
    bytes,
    { key: "", value: {} },
    {
      1: [LEN, (r, kv) => (kv.key = text(r))],
      2: [LEN, (r, kv) => (kv.value = anyValue(r.chunk()))],
    },
  );
}

const attributes = (r, target) => target.attributes.push(keyValue(r.chunk()));

function resource(bytes) {
  return readMessage(
    bytes,
    { attributes: [], droppedAttributesCount: 0 },
    {
      1: [LEN, attributes],
      2: [VARINT, (r, res) => (res.droppedAttributesCount = count(r))],
    },
  );
}

function scope(bytes) {
  return readMessage(
    bytes,
    { name: "", attributes: [], droppedAttributesCount: 0 },
    {
      1: [LEN, (r, s) => (s.name = text(r))],
      2: [LEN, (r, s) => (s.version = text(r))],
      3: [LEN, attributes],
      4: [VARINT, (r, s) => (s.droppedAttributesCount = count(r))],
    },
  );
}

function event(bytes) {
  return readMessage(
    bytes,
    { timeUnixNano: "0", name: "", attributes: [], droppedAttributesCount: 0 },
    {
      1: [I64, (r, e) => (e.timeUnixNano = r.fixed64().toString())],
      2: [LEN, (r, e) => (e.name = text(r))],
      3: [LEN, attributes],
      4: [VARINT, (r, e) => (e.droppedAttributesCount = count(r))],
    },
  );
}

function link(bytes) {
  return readMessage(
    bytes,
    { traceId: "", spanId: "", attributes: [], droppedAttributesCount: 0 },
    {
      1: [LEN, (r, l) => (l.traceId = hex(r.chunk()))],
      2: [LEN, (r, l) => (l.spanId = hex(r.chunk()))],
      3: [LEN, (r, l) => (l.traceState = text(r))],
      4: [LEN, attributes],
      5: [VARINT, (r, l) => (l.droppedAttributesCount = count(r))],
      6: [I32, (r, l) => (l.flags = r.fixed32())],
    },
  );
}

function status(bytes) {
  return readMessage(
    bytes,
    { code: 0 },
    {
      2: [LEN, (r, s) => (s.message = text(r))],
      3: [VARINT, (r, s) => (s.code = count(r))],
    },
  );
}

function span(bytes) {
  const decoded = readMessage(
    bytes,
    {
      traceId: "",
      spanId: "",
      name: "",
      kind: 0,
      startTimeUnixNano: "0",
      endTimeUnixNano: "0",
      attributes: [],
      droppedAttributesCount: 0,
      events: [],
      droppedEventsCount: 0,
      links: [],
      droppedLinksCount: 0,
      status: { code: 0 },
    },
    {
      1: [LEN, (r, s) => (s.traceId = hex(r.chunk()))],
      2: [LEN, (r, s) => (s.spanId = hex(r.chunk()))],
      3: [LEN, (r, s) => (s.traceState = text(r))],
      4: [LEN, (r, s) => (s.parentSpanId = hex(r.chunk()))],
      5: [LEN, (r, s) => (s.name = text(r))],
      6: [VARINT, (r, s) => (s.kind = count(r))],
      7: [I64, (r, s) => (s.startTimeUnixNano = r.fixed64().toString())],
      8: [I64, (r, s) => (s.endTimeUnixNano = r.fixed64().toString())],
      9: [LEN, attributes],
      10: [VARINT, (r, s) => (s.droppedAttributesCount = count(r))],
      11: [LEN, (r, s) => s.events.push(event(r.chunk()))],
      12: [VARINT, (r, s) => (s.droppedEventsCount = count(r))],
      13: [LEN, (r, s) => s.links.push(link(r.chunk()))],
      14: [VARINT, (r, s) => (s.droppedLinksCount = count(r))],
      15: [LEN, (r, s) => (s.status = status(r.chunk()))],
      16: [I32, (r, s) => (s.flags = r.fixed32())],
    },
  );
  // A root span has no parent; the SDK leaves the field empty.
  if (decoded.parentSpanId === "") {
    delete decoded.parentSpanId;
  }
  if (decoded.traceState === "") {
    delete decoded.traceState;
  }
  return decoded;
}

function scopeSpans(bytes) {
  return readMessage(
    bytes,
    { scope: { name: "", attributes: [], droppedAttributesCount: 0 }, spans: [] },
    {
      1: [LEN, (r, ss) => (ss.scope = scope(r.chunk()))],
      2: [LEN, (r, ss) => ss.spans.push(span(r.chunk()))],
      3: [LEN, (r, ss) => (ss.schemaUrl = text(r))],
    },
  );
}

function resourceSpans(bytes) {
  return readMessage(
    bytes,
    { resource: { attributes: [], droppedAttributesCount: 0 }, scopeSpans: [] },
    {
      1: [LEN, (r, rs) => (rs.resource = resource(r.chunk()))],
      2: [LEN, (r, rs) => rs.scopeSpans.push(scopeSpans(r.chunk()))],
      3: [LEN, (r, rs) => (rs.schemaUrl = text(r))],
    },
  );
}

/**
 * Decodes an ExportTraceServiceRequest.
 * @param {Uint8Array} bytes the request body, uncompressed
 * @returns {{ resourceSpans: object[] }} the request as OTLP JSON
 */
export function decodeTraceRequest(bytes) {
  return readMessage(
    bytes,
    { resourceSpans: [] },
    {
      1: [LEN, (r, req) => req.resourceSpans.push(resourceSpans(r.chunk()))],
    },
  );
}
