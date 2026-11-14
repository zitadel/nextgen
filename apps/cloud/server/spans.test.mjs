import assert from "node:assert/strict";
import { test } from "node:test";

import { SpanRouter } from "./spans.mjs";

const resource = {
  attributes: [{ key: "service.name", value: { stringValue: "zitadel" } }],
  droppedAttributesCount: 0,
};
const scope = { name: "nextgen", attributes: [], droppedAttributesCount: 0 };
const span = (traceId, spanId, parentSpanId) => ({ traceId, spanId, parentSpanId, name: spanId });
const exportOf = (...spans) => ({ resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] });

test("splits one export between concurrent requests", async () => {
  const router = new SpanRouter();
  const a = router.open("aaaa", "a0");
  const b = router.open("bbbb", "b0");
  assert.equal(router.exports, 0, "the server has not exported yet");

  router.ingest(
    exportOf(
      span("aaaa", "a2", "a1"),
      span("bbbb", "b1", "b0"),
      span("aaaa", "a1", "a0"),
      span("cccc", "c1", "c0"),
    ),
  );

  assert.equal(router.exports, 1);
  const spansA = await router.close(a, 1000);
  const spansB = await router.close(b, 1000);
  assert.deepEqual(
    spansA.resourceSpans.flatMap((rs) =>
      rs.scopeSpans.flatMap((ss) => ss.spans.map((s) => s.spanId)),
    ),
    ["a2", "a1"],
  );
  assert.deepEqual(
    spansB.resourceSpans[0].scopeSpans[0].spans.map((s) => s.spanId),
    ["b1"],
  );
  assert.equal(spansA.resourceSpans[0].resource, resource, "the resource travels with the spans");
  assert.equal(router.unmatched, 1, "a trace nobody opened");
  assert.equal(router.openCount, 0);
});

test("waits for the server span across exports", async () => {
  const router = new SpanRouter();
  const entry = router.open("aaaa", "a0");
  router.ingest(exportOf(span("aaaa", "a2", "a1")));

  const closing = router.close(entry, 5000);
  setTimeout(() => router.ingest(exportOf(span("aaaa", "a1", "a0"))), 20);
  const started = Date.now();
  const spans = await closing;

  assert.ok(Date.now() - started < 1000, "closed when the server span arrived, not at the timeout");
  assert.equal(spans.resourceSpans.length, 2);
});

test("gives up after the wait and reports what arrived", async () => {
  const router = new SpanRouter();
  const entry = router.open("aaaa", "a0");
  router.ingest(exportOf(span("aaaa", "a2", "a1")));

  const spans = await router.close(entry, 30);

  assert.equal(spans.resourceSpans[0].scopeSpans[0].spans.length, 1);
  router.ingest(exportOf(span("aaaa", "a1", "a0")));
  assert.equal(router.unmatched, 1, "a span after the entry closed has nowhere to go");
});

test("reports nothing for a request without spans", async () => {
  const router = new SpanRouter();
  assert.equal(await router.close(router.open("aaaa", "a0"), 10), null);
});

test("leaves a second request with the same trace ID unopened", () => {
  const router = new SpanRouter();
  assert.ok(router.open("aaaa", "a0"));
  assert.equal(router.open("aaaa", "x0"), null);
});
