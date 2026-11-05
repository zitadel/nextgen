import { describe, expect, it } from "vitest";

import Preview, {
  previewVerdict,
  readPreviewUrls,
  refusePrimaryOrigins,
} from "@/commands/preview/index";
import { parseFlag } from "@tests/helpers/inputs";

function clientWith(primaries: readonly string[]) {
  return {
    getProject: async () => {
      return {
        origins: primaries.map((pattern) => {
          return {
            kind: "primary",
            pattern,
          };
        }),
      };
    },
  } as never;
}

describe("the preview URLs a run deploys to", () => {
  it("sends a URL given twice once", () => {
    expect(readPreviewUrls(["https://a.app", "https://a.app"], {})).toEqual(["https://a.app"]);
  });

  it("falls back to the URL the platform's own build names", () => {
    expect(readPreviewUrls([], { VERCEL_URL: "b.app" })).toEqual(["https://b.app"]);
  });

  it("names the variables it looked for when there are none", () => {
    expect(() => {
      readPreviewUrls([], {});
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "No preview URLs to deploy to",
        hint: expect.stringContaining("VERCEL_URL"),
      }),
    );
  });
});

describe("the preview URLs, checked against the project's primary origins", () => {
  it("passes URLs that are no primary origin", async () => {
    await expect(
      refusePrimaryOrigins(["https://pr-1.a.app"], clientWith(["https://a.app"]), "prj_1"),
    ).resolves.toBeUndefined();
  });

  it("refuses a URL that is a primary origin, naming it", async () => {
    await expect(
      refusePrimaryOrigins(
        ["https://a.app", "https://pr-1.a.app"],
        clientWith(["https://a.app"]),
        "prj_1",
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "https://a.app is a primary origin",
    });
  });

  it("passes them when the project has no primary origin to compare against", async () => {
    await expect(
      refusePrimaryOrigins(["https://a.app"], clientWith([]), "prj_1"),
    ).resolves.toBeUndefined();
  });
});

describe("--ttl", () => {
  it.each([
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["60s", 60 * 1000],
    ["12h", 12 * 60 * 60 * 1000],
    ["365d", 365 * 24 * 60 * 60 * 1000],
  ])("accepts %s", async (value, ms) => {
    await expect(parseFlag(Preview.flags.ttl, value, "ttl")).resolves.toMatchObject({ ms });
  });

  it.each(["59s", "366d"])("refuses %s as outside the allowed range", async (value) => {
    await expect(parseFlag(Preview.flags.ttl, value, "ttl")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${value} is outside the allowed range`,
    });
  });

  it("refuses what is not a duration", async () => {
    await expect(parseFlag(Preview.flags.ttl, "soon", "ttl")).rejects.toMatchObject({
      message: "soon is not a valid ttl",
    });
  });
});

describe("--origin", () => {
  it("drops trailing slashes, so one preview is one spelling", async () => {
    await expect(
      parseFlag(Preview.flags.origin, "https://pr-1.acme.app//", "origin"),
    ).resolves.toBe("https://pr-1.acme.app");
  });

  it.each(["primary", "primary//"])("refuses the primary keyword %j", async (value) => {
    await expect(parseFlag(Preview.flags.origin, value, "origin")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "A preview cannot target the primary origins",
    });
  });

  it("refuses a blank value, naming the flag", async () => {
    await expect(parseFlag(Preview.flags.origin, "  ", "origin")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("--origin"),
    });
  });

  it("says a blank value is empty, in the words every blank value is refused with", async () => {
    await expect(parseFlag(Preview.flags.origin, "", "origin")).rejects.toMatchObject({
      message: "it was given an empty value",
    });
  });
});

describe("-m", () => {
  it("trims a message", async () => {
    await expect(parseFlag(Preview.flags.message, "  add company  ", "message")).resolves.toBe(
      "add company",
    );
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(Preview.flags.message, "   ", "message")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(Preview.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(
      parseFlag(Preview.flags.message, "\u{1F600}".repeat(1024), "message"),
    ).resolves.toHaveLength(2048);
  });
});

describe("previewVerdict", () => {
  const READY = {
    environment: "preview",
    fromDefault: false,
    ci: false,
    credentialSet: true,
    strict: false,
  };

  it("deploys a preview build that has its credential", () => {
    expect(previewVerdict(READY)).toBe("preview");
  });

  it("deploys a development build on a developer's machine", () => {
    expect(previewVerdict({ ...READY, environment: "development", fromDefault: true })).toBe(
      "preview",
    );
  });

  it("skips a production build, which `deploy` publishes after merge", () => {
    expect(previewVerdict({ ...READY, environment: "production" })).toBe("production-build");
  });

  it("skips a CI build that names no environment, which may be production", () => {
    expect(
      previewVerdict({ ...READY, environment: "development", fromDefault: true, ci: true }),
    ).toBe("unnamed-ci-build");
  });

  it("skips a build without the credential, as a fork pull request has none", () => {
    expect(previewVerdict({ ...READY, credentialSet: false })).toBe("no-credential");
  });

  it("refuses a build without the credential under --strict", () => {
    expect(previewVerdict({ ...READY, credentialSet: false, strict: true })).toBe(
      "credential-required",
    );
  });
});
