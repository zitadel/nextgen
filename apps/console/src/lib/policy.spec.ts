import { describe, expect, it } from "vitest";

import {
  passwordPolicySettings,
  policyDisplayName,
  policyDocument,
  policySettings,
} from "./policy";

const revision = {
  id: "pol_1",
  revision_id: "polrev_1",
  project_id: "proj_1",
  operation: "auth.factor.password.set" as const,
  config: { min_length: 15, history_depth: 4 },
  created_at: "2026-10-20T09:00:00Z",
  updated_at: "2026-10-20T10:30:00Z",
};

describe("policy display", () => {
  it("names the password policy by its operation", () => {
    expect(policyDisplayName("auth.factor.password.set")).toBe("Password policy");
  });

  it("names an operation it does not know by the operation as written, with no rows", () => {
    expect(policyDisplayName("auth.factor.passkey.set")).toBe("auth.factor.passkey.set");
    expect(policySettings({ ...revision, operation: "auth.factor.passkey.set" as never })).toEqual(
      [],
    );
  });

  it("summarises the length rule from whichever bounds are set", () => {
    const length = (config: Parameters<typeof passwordPolicySettings>[0]) =>
      passwordPolicySettings(config).find((row) => row.label === "Length")?.value;
    expect(length({ min_length: 15 })).toBe("At least 15 characters");
    expect(length({ max_length: 32 })).toBe("At most 32 characters");
    expect(length({ min_length: 12, max_length: 32 })).toBe("12 to 32 characters");
    expect(length({ min_length: 16, max_length: 16 })).toBe("Exactly 16 characters");
  });

  it("says whether history is checked, not how deep", () => {
    const history = (config: Parameters<typeof passwordPolicySettings>[0]) =>
      passwordPolicySettings(config).find((row) => row.label === "History")?.value;
    expect(history({ history_depth: 4 })).toBe("Enabled");
  });

  it("gives a rule the config leaves out no row, so an empty config has none", () => {
    expect(passwordPolicySettings({ history_depth: 4 }).map((row) => row.label)).toEqual([
      "History",
    ]);
    expect(passwordPolicySettings({ min_length: 15 }).map((row) => row.label)).toEqual(["Length"]);
    expect(passwordPolicySettings({})).toEqual([]);
  });

  it("shows the publish body, without the revision's ids", () => {
    expect(policyDocument(revision)).toEqual({
      operation: "auth.factor.password.set",
      config: { min_length: 15, history_depth: 4 },
    });
  });
});
