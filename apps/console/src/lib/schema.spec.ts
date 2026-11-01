import { describe, expect, it } from "vitest";

import { schemaFields } from "./schema";

/** The `expects` line of one property, as `schemaFields` derives it. */
function expects(property: Record<string, unknown>): string | undefined {
  return schemaFields({ type: "object", properties: { value: property } })[0]?.expects;
}

describe("what a field expects", () => {
  it("names the type, format and enum a value must have", () => {
    expect(expects({ type: "integer" })).toBe("Expected a whole number.");
    expect(expects({ type: "number" })).toBe("Expected a number.");
    expect(expects({ type: "string", format: "email" })).toBe("Expected an email address.");
    expect(expects({ type: "string", enum: ["red", "green"] })).toBe("Expected one of red, green.");
  });

  it("names lengths and ranges, and only that a pattern applies", () => {
    expect(expects({ type: "string", maxLength: 50 })).toBe("Expected at most 50 characters.");
    expect(expects({ type: "string", minLength: 2, maxLength: 50 })).toBe(
      "Expected between 2 and 50 characters.",
    );
    expect(expects({ type: "integer", minimum: 1 })).toBe("Expected a whole number, at least 1.");
    // A regular expression says nothing to most readers.
    expect(expects({ type: "string", pattern: "^[A-Z]{2}$" })).toBe(
      "Expected in the format the schema requires.",
    );
  });

  it("says nothing for a property with no constraint to describe", () => {
    expect(expects({ type: "string" })).toBeUndefined();
  });
});
