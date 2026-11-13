import { describe, expect, it } from "vitest";

import { Origins } from "@/lib/backend";

import Deploy, { missingPrimaryOrigin } from "@/commands/deploy/index";
import { parseFlag } from "@tests/helpers/inputs";
import { PREVIEW_PATTERN } from "@tests/helpers/records";

const ISSUER = "http://localhost:3000";
const PREVIEW_ISSUER = Origins.wrap([{ pattern: ISSUER, kind: "preview" }]);

function outcomeFor(input: Partial<Parameters<typeof missingPrimaryOrigin>[0]>) {
  return missingPrimaryOrigin({
    origins: Origins.wrap([]),
    issuer: ISSUER,
    setupProject: true,
    ...input,
  });
}

describe("missingPrimaryOrigin", () => {
  it("suggests doctor --fix for setup's project holding its issuer as a preview origin", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER });

    expect(outcome.next).toEqual([{ id: "doctor", flags: { fix: true } }]);
    expect(outcome.hint).not.toContain("doctor --fix");
  });

  it("says why adding the preview issuer as primary does not work", () => {
    expect(outcomeFor({ origins: PREVIEW_ISSUER }).hint).toContain(
      `holds its issuer ${ISSUER} as a preview origin`,
    );
  });

  it("suggests removing and re-adding the issuer for a project doctor does not repair", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER, setupProject: false });

    expect(outcome.next).toEqual([
      { id: "origin:rm", args: { pattern: ISSUER }, flags: { force: true } },
      { id: "origin:add", args: { pattern: ISSUER }, flags: { kind: "primary" } },
    ]);
    expect(outcome.hint).not.toContain("origin add");
  });

  it("suggests adding the issuer as primary when the project does not hold it", () => {
    const outcome = outcomeFor({
      origins: Origins.wrap([{ pattern: PREVIEW_PATTERN, kind: "preview" }]),
    });

    expect(outcome.next).toEqual([
      { id: "origin:add", args: { pattern: ISSUER }, flags: { kind: "primary" } },
    ]);
  });

  it("adds the issuer as its origin, without a trailing slash", () => {
    expect(outcomeFor({ issuer: `${ISSUER}/` }).next).toEqual([
      { id: "origin:add", args: { pattern: ISSUER }, flags: { kind: "primary" } },
    ]);
  });

  it("asks for the URL the app serves from when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).hint).toContain("the URL the app serves from");
  });

  it("suggests origin list when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).next).toEqual([{ id: "origin:list" }]);
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
