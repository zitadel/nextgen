import assert from "node:assert/strict";
import { test } from "vitest";

import { errorMessage, parsePort } from "./lib.mjs";

test("parsePort accepts 1-65535 and names the setting otherwise", () => {
  assert.equal(parsePort("1", "JOURNEY_APP_PORT"), 1);
  assert.equal(parsePort("65535", "JOURNEY_APP_PORT"), 65_535);
  for (const value of ["0", "65536", "80.5", "-1", "http"]) {
    assert.throws(
      () => parsePort(value, "JOURNEY_APP_PORT"),
      new RegExp(`^Error: JOURNEY_APP_PORT must be a TCP port, got ${value}$`),
    );
  }
});

test("errorMessage reads an Error's message and stringifies anything else", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage(null), "null");
});
