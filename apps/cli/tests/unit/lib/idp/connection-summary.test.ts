import { describe, expect, it } from "vitest";

import {
  mappingData,
  mappingLines,
  stateLine,
  stepLines,
  stillToConfigure,
  unmappedLines,
  usedByLines,
} from "@/lib/idp/connection-summary";
import { type ConnectionSummary, propertyName } from "@/lib/zitadel";

/**
 * The file every summary here describes.
 */
const FILE = ".zitadel/idps/acme.json";

/**
 * A connection that maps email, verified by a claim, and asks for two scopes.
 */
const SUMMARY: ConnectionSummary = {
  mappings: [{ property: propertyName("email"), claim: "email" }],
  verifications: [{ property: propertyName("email"), claim: "email_verified" }],
  scopes: ["openid", "email"],
  unmapped: [],
  usedBy: ["customers"],
};

describe("mappingLines", () => {
  it("says which claim fills each property, and what verifies it, in one sentence", () => {
    expect(mappingLines(SUMMARY, FILE)).toContain(
      "- email comes from the email claim, verified when email_verified is true.",
    );
  });

  it("says a property verified outright is always trusted", () => {
    const trusted = {
      ...SUMMARY,
      verifications: [{ property: propertyName("email"), claim: true }],
    };

    expect(mappingLines(trusted, FILE)).toContain(
      "- email comes from the email claim, and is always trusted.",
    );
  });

  it("says nothing of trust for a property nothing verifies", () => {
    expect(mappingLines({ ...SUMMARY, verifications: [] }, FILE)).toContain(
      "- email comes from the email claim.",
    );
  });

  it("names the scopes it asks for", () => {
    expect(mappingLines(SUMMARY, FILE)).toContain(
      "It asks your provider for the openid and email scopes.",
    );
  });

  it("names no scopes when the file asks for none", () => {
    expect(mappingLines({ ...SUMMARY, scopes: [] }, FILE).join("\n")).not.toContain("scope");
  });

  it("says where to add a mapping when there is none", () => {
    expect(mappingLines({ ...SUMMARY, mappings: [] }, FILE)).toContain(
      `No attribute is filled from a claim yet. Add attribute: claim pairs to claim_mapping in ${FILE}.`,
    );
  });
});

describe("unmappedLines", () => {
  it("says a required property has to be collected at sign-up", () => {
    expect(unmappedLines([{ property: propertyName("companyName"), required: true }])).toContain(
      "- companyName (required) - not filled by this connection, so sign-up has to collect it.",
    );
  });

  it("says an optional property is fine to leave", () => {
    expect(unmappedLines([{ property: propertyName("nickname"), required: false }])).toContain(
      "- nickname (optional) - fine to leave empty.",
    );
  });

  it("says nothing when every property is mapped", () => {
    expect(unmappedLines([])).toEqual([]);
  });
});

describe("usedByLines", () => {
  it.each([
    [["customers"], "customers signs in through this connection, so changes here affect it."],
    [
      ["customers", "staff", "partners"],
      "customers, staff and partners sign in through this connection, so changes here affect them.",
    ],
    [
      [],
      "No user schema signs in through this connection yet, so changing it affects nothing today.",
    ],
  ])("names %j", (schemas, line) => {
    expect(usedByLines(schemas)).toContain(line);
  });
});

describe("stateLine", () => {
  it.each([
    ["saved", "Saved in your project. Not applied, not tested."],
    ["applied", "Saved and applied. Not tested with a sign-in."],
    [
      "present",
      "In your project. `zitadel deploy --dry-run` shows whether it is deployed. Not tested.",
    ],
  ] as const)("words %s", (state, line) => {
    expect(stateLine(state)).toBe(line);
  });
});

describe("stillToConfigure", () => {
  it("asks for a deploy of a connection only saved", () => {
    const steps = stillToConfigure({ state: "saved", file: FILE, provider: "Acme" });

    expect(steps).toContainEqual({
      text: "Run `zitadel deploy`, so Acme sign-in reaches your app.",
    });
  });

  it("asks for no deploy of a connection already applied", () => {
    const steps = stillToConfigure({ state: "applied", file: FILE, provider: "Acme" });

    expect(steps.map((step) => step.text).join("\n")).not.toContain("deploy");
  });

  it("puts the deploy commands under the deploy step", () => {
    const steps = stillToConfigure({
      state: "saved",
      file: FILE,
      provider: "Acme",
      deployCommands: ["zitadel deploy --dry-run"],
    });

    expect(steps).toContainEqual({
      text: "Deploy, so Acme sign-in reaches your app:",
      commands: ["zitadel deploy --dry-run"],
    });
  });

  it("asks to publish credentials that did not reach the project", () => {
    const steps = stillToConfigure({
      state: "saved",
      file: FILE,
      provider: "Acme",
      republish: ["zitadel variable set ACME_CLIENT_SECRET --secret"],
    });

    expect(steps).toContainEqual({
      text: "Publish the credentials that did not reach your Project:",
      commands: ["zitadel variable set ACME_CLIENT_SECRET --secret"],
    });
  });

  it("ends with a sign-in, the only test of the mapping", () => {
    const steps = stillToConfigure({ state: "applied", file: FILE, provider: "Acme" });

    expect(steps.at(-1)).toEqual({
      text: "Sign in once with Acme: until then the mapping is untested.",
    });
  });
});

describe("stepLines", () => {
  it("numbers each step and puts each command on its own line under it", () => {
    expect(
      stepLines([{ text: "Deploy:", commands: ["zitadel deploy"] }, { text: "Sign in." }]),
    ).toEqual(["1. Deploy:", "   `zitadel deploy`", "2. Sign in."]);
  });
});

describe("mappingData", () => {
  it("gives the mapping, what verifies it and the scopes as the file holds them", () => {
    expect(mappingData(SUMMARY)).toEqual({
      claim_mapping: { email: "email" },
      verified_claims: { email: "email_verified" },
      scopes: ["openid", "email"],
    });
  });
});
