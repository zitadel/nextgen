import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import { importsUnder } from "@tests/helpers/source-imports";

const BACKEND = posix.join("lib", "backend");

describe("the identity-provider module's dependencies", () => {
  it("never reach the backend", async () => {
    const reached = (await importsUnder(posix.join("lib", "idp")))
      .filter((found) => {
        return found.target === BACKEND || found.target.startsWith(`${BACKEND}/`);
      })
      .map((found) => {
        return `${found.file} imports ${found.specifier}`;
      });

    expect(reached).toEqual([]);
  });
});
