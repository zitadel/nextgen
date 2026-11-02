import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { breakingChanges } from "../../../src/lib/release-notes";

const RELEASES = "https://api.github.com/repos/zitadel/nextgen/releases";

const server = setupServer();

function released(releases: Array<{ tag_name: string; body: string }>): void {
  server.use(http.get(RELEASES, () => HttpResponse.json(releases)));
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe("breakingChanges", () => {
  it("returns the notes of the releases in between, oldest first", async () => {
    released([
      { tag_name: "v0.4.0", body: "  **Breaking:** four" },
      { tag_name: "v0.3.0", body: "- **Breaking:** three" },
      { tag_name: "v0.2.0", body: "**Breaking:** two" },
      { tag_name: "v0.1.0", body: "**Breaking:** one" },
    ]);

    await expect(breakingChanges("0.1.0", "0.3.0")).resolves.toEqual([
      { version: "0.2.0", note: "two" },
      { version: "0.3.0", note: "three" },
    ]);
  });

  it("reads the line endings GitHub stores release bodies with", async () => {
    released([{ tag_name: "v2.0.0", body: "Intro\r\n\r\n  **Breaking:** it broke\r\n\r\nMore" }]);

    await expect(breakingChanges("1.0.0", "2.0.0")).resolves.toEqual([
      { version: "2.0.0", note: "it broke" },
    ]);
  });

  it("lists several notes of one release", async () => {
    released([{ tag_name: "v2.0.0", body: "**Breaking:** a\n**Breaking:** b" }]);

    await expect(breakingChanges("1.0.0", "2.0.0")).resolves.toEqual([
      { version: "2.0.0", note: "a" },
      { version: "2.0.0", note: "b" },
    ]);
  });

  it("skips a tag that is not a version", async () => {
    released([{ tag_name: "nightly", body: "**Breaking:** a" }]);

    await expect(breakingChanges("1.0.0", "2.0.0")).resolves.toEqual([]);
  });

  it("answers nothing when GitHub refuses", async () => {
    server.use(http.get(RELEASES, () => new HttpResponse(null, { status: 403 })));

    await expect(breakingChanges("1.0.0", "2.0.0")).resolves.toEqual([]);
  });

  it("answers nothing when GitHub is out of reach", async () => {
    server.use(http.get(RELEASES, () => HttpResponse.error()));

    await expect(breakingChanges("1.0.0", "2.0.0")).resolves.toEqual([]);
  });
});
