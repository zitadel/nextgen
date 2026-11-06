import { describe, expect, it } from "vitest";

import { Origins } from "@/lib/backend";
import Deploy, { missingPrimaryOrigin } from "@/commands/deploy/index";
import { parseFlag } from "@tests/helpers/inputs";

const ISSUER = "http://localhost:3000";
const PREVIEW_ISSUER = Origins.wrap([{ pattern: ISSUER, kind: "preview" }]);

function outcomeFor(input: Partial<Parameters<typeof missingPrimaryOrigin>[0]>) {
  return missingPrimaryOrigin({
    origins: Origins.wrap([]),
    issuer: ISSUER,
    setupProject: true,
    suggest: (command) => `zitadel ${command}` as never,
    ...input,
  });
}

describe("missingPrimaryOrigin", () => {
  it("suggests doctor --fix for setup's project holding its issuer as a preview origin", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER });

    expect(outcome.next).toEqual(["doctor --fix"]);
    expect(outcome.hint).toContain("`zitadel doctor --fix`");
  });

  it("says why adding the preview issuer as primary does not work", () => {
    expect(outcomeFor({ origins: PREVIEW_ISSUER }).hint).toContain(
      `holds its issuer ${ISSUER} as a preview origin`,
    );
  });

  it("suggests removing and re-adding the issuer for a project doctor does not repair", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER, setupProject: false });

    expect(outcome.next).toEqual([
      `origin rm ${ISSUER} --force`,
      `origin add ${ISSUER} --kind primary`,
    ]);
    expect(outcome.hint).toContain(`zitadel origin add ${ISSUER} --kind primary`);
  });

  it("suggests adding the issuer as primary when the project does not hold it", () => {
    const outcome = outcomeFor({
      origins: Origins.wrap([{ pattern: "https://*-acme.vercel.app", kind: "preview" }]),
    });

    expect(outcome.next).toEqual([`origin add ${ISSUER} --kind primary`]);
  });

  it("adds the issuer as its origin, without a trailing slash", () => {
    expect(outcomeFor({ issuer: `${ISSUER}/` }).next).toEqual([
      `origin add ${ISSUER} --kind primary`,
    ]);
  });

  it("names origin add with a URL to fill in when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).hint).toContain("origin add <url> --kind primary");
  });

  it("suggests origin list when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).next).toEqual(["origin list"]);
  });
});

describe("-m", () => {
  it("trims a message", async () => {
    await expect(parseFlag(Deploy.flags.message, "  add company  ", "message")).resolves.toBe(
      "add company",
    );
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(Deploy.flags.message, "   ", "message")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(Deploy.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(
      parseFlag(Deploy.flags.message, "\u{1F600}".repeat(1024), "message"),
    ).resolves.toHaveLength(2048);
  });
});
