import { describe, expect, it } from "vitest";

import { fieldPreset } from "../../../../src/lib/user-schema/presets";

describe("fieldPreset", () => {
  it("returns the built-in body for a known field", () => {
    expect(fieldPreset("email")).toMatchObject({
      type: "string",
      format: "email",
      "x-identifier": true,
      "x-unique": "project",
    });
  });

  it("falls back to a generic editable string for unknown fields", () => {
    expect(fieldPreset("nickname")).toEqual({
      type: "string",
      title: "Nickname",
      "x-editable": true,
    });
  });

  it("titleizes snake-cased unknown field names", () => {
    expect(fieldPreset("date_of_birth").title).toBe("Date Of Birth");
  });

  it("returns a freshly allocated object callers may mutate safely", () => {
    const a = fieldPreset("email");
    const b = fieldPreset("email");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
