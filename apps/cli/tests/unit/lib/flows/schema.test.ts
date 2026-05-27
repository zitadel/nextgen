import { describe, expect, it } from "vitest";

import { flowDefinitionSchema } from "../../../../src/lib/flows";

const VALID = {
  name: "default",
  user_schema: "https://example.com/user.yaml",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      texts: { title_key: "identifier.title" },
      fields: {
        email: { type: "email", text_key: "identifier.field.email", required: true },
      },
      actions: { submit: { text_key: "identifier.action.submit", primary: true } },
    },
  ],
};

describe("flowDefinitionSchema", () => {
  it("accepts a minimal valid flow", () => {
    const parsed = flowDefinitionSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it("rejects names that aren't slug-shaped", () => {
    const bad = { ...VALID, name: "Has Spaces" };
    expect(flowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects array-shaped fields (legacy)", () => {
    const legacy = {
      ...VALID,
      steps: [
        {
          name: "identifier",
          type: "identifier",
          fields: [{ name: "email", type: "email" }],
          actions: [],
        },
      ],
    };
    expect(flowDefinitionSchema.safeParse(legacy).success).toBe(false);
  });

  it("rejects malformed text_key values", () => {
    const bad = {
      ...VALID,
      steps: [
        {
          name: "identifier",
          type: "identifier",
          fields: {
            email: { type: "email", text_key: "BAD-KEY", required: true },
          },
          actions: {},
        },
      ],
    };
    expect(flowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least one purpose and one step", () => {
    expect(flowDefinitionSchema.safeParse({ ...VALID, purposes: [] }).success).toBe(false);
    expect(flowDefinitionSchema.safeParse({ ...VALID, steps: [] }).success).toBe(false);
  });
});
