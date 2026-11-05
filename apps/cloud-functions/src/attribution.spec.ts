import { describe, expect, it } from "vitest";

import { signupAttribution } from "./attribution";

describe("a sign-up's source, as the browser sends it", () => {
  it("keeps the entry and the campaign parameters", () => {
    expect(
      signupAttribution({
        attribution: {
          via: "cli",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "launch",
        },
      }),
    ).toEqual({
      via: "cli",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "launch",
    });
  });

  it.each([
    ["an email", "ada@example.com"],
    ["more than 100 characters", "x".repeat(101)],
    ["a control character", "news\nletter"],
    ["nothing but spaces", "   "],
    ["no string", 42],
  ])("leaves out a parameter holding %s", (_, value) => {
    expect(signupAttribution({ attribution: { via: "console", utm_source: value } })).toEqual({
      via: "console",
    });
  });

  it.each([
    ["no body", undefined],
    ["no attribution", {}],
    ["an entry it does not know", { attribution: { via: "fax", utm_source: "newsletter" } }],
    ["an attribution that is no object", { attribution: "cli" }],
  ])("is none for %s", (_, body) => {
    expect(signupAttribution(body)).toBeUndefined();
  });
});
