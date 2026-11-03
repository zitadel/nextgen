import { describe, expect, it } from "vitest";

import {
  previewOriginFlag,
  previewTtlFlag,
  previewUrlArg,
} from "../../../../../src/lib/oclif/inputs/preview";

const context = {} as never;

async function parseFlag(flag: unknown, name: string, input: string) {
  const defined = (flag as (options: never) => unknown)({ name } as never) as {
    parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
  };
  return defined.parse(input, context, { name });
}

describe("--origin", () => {
  it("drops a trailing slash, so one preview is one spelling", async () => {
    expect(await parseFlag(previewOriginFlag, "origin", "https://pr-1.acme.app/")).toBe(
      "https://pr-1.acme.app",
    );
  });

  it("refuses the primary keyword, which would reach production", async () => {
    await expect(parseFlag(previewOriginFlag, "origin", "primary")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "A preview cannot target the primary origins",
      hint: expect.stringContaining("zitadel deploy"),
    });
  });

  it("refuses the primary keyword however many slashes follow it", async () => {
    await expect(parseFlag(previewOriginFlag, "origin", "primary//")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("refuses an empty value", async () => {
    await expect(parseFlag(previewOriginFlag, "origin", "  ")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});

describe("--ttl", () => {
  it("parses a duration inside the range", async () => {
    expect(await parseFlag(previewTtlFlag, "ttl", "7d")).toMatchObject({
      canonical: "7d",
      iso: "P7D",
    });
  });

  it("accepts the limits", async () => {
    expect(await parseFlag(previewTtlFlag, "ttl", "60s")).toMatchObject({
      ms: 60_000,
    });
    expect(await parseFlag(previewTtlFlag, "ttl", "365d")).toMatchObject({
      canonical: "365d",
    });
  });

  it("refuses less than a minute, naming the value and the range", async () => {
    await expect(parseFlag(previewTtlFlag, "ttl", "59s")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "59s is outside the allowed range",
      hint: "A preview lives between 60s and 365d.",
    });
  });

  it("refuses more than 365 days", async () => {
    await expect(parseFlag(previewTtlFlag, "ttl", "366d")).rejects.toMatchObject({
      message: "366d is outside the allowed range",
    });
  });

  it("refuses what is not a duration", async () => {
    await expect(parseFlag(previewTtlFlag, "ttl", "soon")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "soon is not a valid ttl",
    });
  });
});

describe("the preview URL argument", () => {
  const parseArgument = async (input: string) => {
    const defined = previewUrlArg({ name: "url" } as never) as unknown as {
      parse: (input: string, context: never, arg: unknown) => Promise<unknown>;
    };
    return defined.parse(input, context, { name: "url" });
  };

  it("drops a trailing slash, which would match no preview", async () => {
    expect(await parseArgument("https://pr-1.acme.app//")).toBe("https://pr-1.acme.app");
  });

  it("refuses an empty value, naming the argument", async () => {
    await expect(parseArgument("")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "url was given an empty value",
    });
  });
});
