import { describe, expect, it } from "vitest";

import { readUrl, urlArg } from "../../../../../src/commands/preview/args/url";

describe("readUrl", () => {
  it("drops a trailing slash, which would match no preview", () => {
    expect(readUrl("https://pr-1.acme.app//", "url")).toBe("https://pr-1.acme.app");
  });

  it("refuses an empty value, naming the argument", () => {
    expect(() => readUrl("", "url")).toThrow("url was given an empty value");
  });
});

describe("urlArg", () => {
  it("is wired to the validator", async () => {
    const defined = urlArg({ name: "url" } as never) as unknown as {
      parse: (input: string, context: never, arg: unknown) => Promise<unknown>;
    };

    expect(await defined.parse("https://a.app/", {} as never, { name: "url" })).toBe(
      "https://a.app",
    );
  });
});
