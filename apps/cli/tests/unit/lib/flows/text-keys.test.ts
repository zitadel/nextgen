import { describe, expect, it } from "vitest";

import { collectTextKeys, type FlowDefinition } from "../../../../src/lib/flows";

function flow(steps: FlowDefinition["steps"]): FlowDefinition {
  return {
    name: "test",
    user_schema: "https://example.com/user.yaml",
    purposes: ["login"],
    initial_steps: { login: steps[0].name },
    steps,
  };
}

describe("collectTextKeys", () => {
  it("returns sorted, deduplicated keys from texts, fields, and actions", () => {
    const result = collectTextKeys(
      flow([
        {
          name: "identifier",
          type: "identifier",
          texts: { title_key: "identifier.title", description_key: "identifier.subtitle" },
          fields: {
            email: { type: "email", text_key: "identifier.field.email", required: true },
          },
          actions: {
            submit: { text_key: "identifier.action.submit", primary: true },
            register: { text_key: "identifier.action.register", primary: false },
          },
          gates: {},
        },
      ]),
    );
    expect(result).toEqual([
      "identifier.action.register",
      "identifier.action.submit",
      "identifier.field.email",
      "identifier.subtitle",
      "identifier.title",
    ]);
  });

  it("returns an empty array for a step with no texts, fields, or actions", () => {
    const result = collectTextKeys(
      flow([{ name: "leaf", type: "complete", fields: {}, actions: {}, gates: {} }]),
    );
    expect(result).toEqual([]);
  });

  it("dedupes the same key referenced from multiple steps", () => {
    const result = collectTextKeys(
      flow([
        {
          name: "a",
          type: "identifier",
          texts: { title_key: "shared.title" },
          fields: {},
          actions: { submit: { text_key: "shared.action.submit", primary: true } },
          gates: {},
        },
        {
          name: "b",
          type: "form",
          texts: { title_key: "shared.title" },
          fields: {},
          actions: { submit: { text_key: "shared.action.submit", primary: true } },
          gates: {},
        },
      ]),
    );
    expect(result).toEqual(["shared.action.submit", "shared.title"]);
  });
});
