import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import { importsUnder } from "@tests/helpers/source-imports";

const LAYER = posix.join("lib", "backend");

describe("the backend's dependencies", () => {
  it("reach nothing under lib/ outside the backend", async () => {
    // Resolved rather than read off the specifier, because a service in a
    // subdirectory reaches the backend's own modules as `../client`, which
    // leaves its directory without leaving the backend, and any module can be
    // written through the `@/` alias.
    const reached = (await importsUnder(LAYER))
      .filter((found) => {
        return found.target !== LAYER && !found.target.startsWith(`${LAYER}/`);
      })
      .map((found) => {
        return `${found.file} imports ${found.specifier}`;
      });

    expect(reached).toEqual([]);
  });
});
