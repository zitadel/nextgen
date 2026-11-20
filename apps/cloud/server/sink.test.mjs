import assert from "node:assert/strict";
import { test } from "node:test";

import { sendsToVercel } from "./sink.mjs";

test("Vercel is the sink unless an OTLP backend is named", () => {
  assert.equal(sendsToVercel({}), true);
  assert.equal(sendsToVercel({ OTEL_EXPORTER_OTLP_ENDPOINT: "" }), true);
  assert.equal(
    sendsToVercel({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example.com/otlp" }),
    false,
  );
});
