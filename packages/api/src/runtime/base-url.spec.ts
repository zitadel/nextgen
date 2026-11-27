import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { API_PREFIX, apiBaseUrl } from "./base-url";

// The spec's servers URL is the contract (ADR 077), and API_PREFIX what every
// TypeScript client puts in front of an operation's path; the Go client's
// PathPrefix has the same test. A change to one alone would leave the others
// behind.
test("API_PREFIX is the spec's server URL", () => {
  const spec = readFileSync(
    new URL("../../../../apps/api/api/openapi/openapi-spec.yaml", import.meta.url),
    "utf8",
  );

  expect(spec.match(/^servers:\n(?:\s*#.*\n)*\s*- url: (\S+)/m)?.[1]).toBe(API_PREFIX);
});

test.each([
  ["", API_PREFIX],
  ["/", API_PREFIX],
  ["/__nextgen", "/__nextgen/api/v1"],
  ["http://localhost:8080", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/api/v1", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/api/v1/", "http://localhost:8080/api/v1"],
  ["https://zitadel.example.com/zitadel", "https://zitadel.example.com/zitadel/api/v1"],
  ["https://zitadel.example.com/xapi/v1", "https://zitadel.example.com/xapi/v1/api/v1"],
])("puts the prefix after %j once", (base, expected) => {
  expect(apiBaseUrl(base)).toBe(expected);
});
