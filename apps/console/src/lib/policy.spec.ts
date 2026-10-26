import { describe, expect, it } from "vitest";

import { passwordPolicySettings, policyDisplayName, policyDocument } from "./policy";

describe("policy display", () => {
  it("names the password policy by its operation", () => {
    expect(policyDisplayName("auth.factor.password.set")).toBe("Password policy");
  });

  it("summarises the length rule from whichever bounds are set", () => {
    const length = (config: Parameters<typeof passwordPolicySettings>[0]) =>
      passwordPolicySettings(config).find((row) => row.label === "Length")?.value;
    expect(length({ min_length: 15 })).toBe("At least 15 characters");
    expect(length({ max_length: 32 })).toBe("At most 32 characters");
    expect(length({ min_length: 12, max_length: 32 })).toBe("12 to 32 characters");
    expect(length({})).toBe("Off");
  });

  it("says whether history is checked, not how deep", () => {
    const history = (config: Parameters<typeof passwordPolicySettings>[0]) =>
      passwordPolicySettings(config).find((row) => row.label === "History")?.value;
    expect(history({ history_depth: 4 })).toBe("Enabled");
    expect(history({ min_length: 15 })).toBe("Off");
  });

  it("shows the file the CLI publishes, without the revision's ids", () => {
    expect(
      policyDocument({
        id: "pol_1",
        revision_id: "polrev_1",
        project_id: "proj_1",
        operation: "auth.factor.password.set",
        config: { min_length: 15, history_depth: 4 },
        created_at: "2026-10-20T09:00:00Z",
        updated_at: "2026-10-20T10:30:00Z",
      }),
    ).toEqual({
      operation: "auth.factor.password.set",
      config: { min_length: 15, history_depth: 4 },
    });
  });
});
