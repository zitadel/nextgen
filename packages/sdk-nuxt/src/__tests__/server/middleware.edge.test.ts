import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const NODE_ACCESS = /\.node\b/;

/**
 * h3 1.x events carry a Node shim (`event.node.req`, `event.node.res`) even
 * when Nitro serves a web `Request`, so the canonical middleware tests pass
 * with a middleware that reads it. Edge presets have no such shim, hence the
 * middleware may reach the request only through h3's accessors.
 */
describe("the server middleware in the edge runtime", () => {
  const source = readFileSync(
    new URL("../../runtime/server/middleware.ts", import.meta.url),
    "utf8",
  ).replace(COMMENTS, "");

  it("never reads the request or the response through the event's Node shim", () => {
    expect(source).not.toMatch(NODE_ACCESS);
  });
});
