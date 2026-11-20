import { describe, expect, it } from "vitest";

import { regularPlural } from "@/lib/plural";

describe("regularPlural", () => {
  it.each([
    ["user", "users"],
    ["idp", "idps"],
    ["flow-definition", "flow-definitions"],
    ["identity provider connection", "identity provider connections"],
    ["policy", "policies"],
    ["key", "keys"],
    ["status", "statuses"],
    ["address", "addresses"],
    ["box", "boxes"],
    ["branch", "branches"],
    ["wish", "wishes"],
  ])("forms %j as %j", (noun, expected) => {
    expect(regularPlural(noun)).toBe(expected);
  });
});
