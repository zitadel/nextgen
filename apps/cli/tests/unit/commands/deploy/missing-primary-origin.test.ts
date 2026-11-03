import { describe, expect, it } from "vitest";

import { missingPrimaryOrigin } from "../../../../src/commands/deploy/missing-primary-origin";

const ISSUER = "http://localhost:3000";
const PREVIEW_ISSUER = [{ pattern: ISSUER, kind: "preview" }];

function outcomeFor(input: Partial<Parameters<typeof missingPrimaryOrigin>[0]>) {
  return missingPrimaryOrigin({
    origins: [],
    issuer: ISSUER,
    setupProject: true,
    suggest: (command) => `zitadel ${command}` as never,
    ...input,
  });
}

describe("missingPrimaryOrigin", () => {
  it("suggests doctor --fix for setup's project holding its issuer as a preview origin", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER });

    expect(outcome.next).toBe("doctor --fix");
    expect(outcome.hint).toContain("`zitadel doctor --fix`");
  });

  it("says why adding the preview issuer as primary does not work", () => {
    expect(outcomeFor({ origins: PREVIEW_ISSUER }).hint).toContain(
      `holds its issuer ${ISSUER} as a preview origin`,
    );
  });

  it("suggests removing and re-adding the issuer for a project doctor does not repair", () => {
    const outcome = outcomeFor({ origins: PREVIEW_ISSUER, setupProject: false });

    expect(outcome.next).toBe(`origin rm ${ISSUER} --force`);
    expect(outcome.hint).toContain(`zitadel origin add ${ISSUER} --kind primary`);
  });

  it("suggests adding the issuer as primary when the project does not hold it", () => {
    const outcome = outcomeFor({
      origins: [{ pattern: "https://*-acme.vercel.app", kind: "preview" }],
    });

    expect(outcome.next).toBe(`origin add ${ISSUER} --kind primary`);
  });

  it("adds the issuer as its origin, without a trailing slash", () => {
    expect(outcomeFor({ issuer: `${ISSUER}/` }).next).toBe(`origin add ${ISSUER} --kind primary`);
  });

  it("names origin add with a URL to fill in when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).hint).toContain("origin add <url> --kind primary");
  });

  it("suggests origin list when no issuer resolves", () => {
    expect(outcomeFor({ issuer: undefined }).next).toBe("origin list");
  });
});
