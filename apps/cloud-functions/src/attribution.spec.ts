import { describe, expect, it } from "vitest";

import { SIGNUP_WINDOW_MS, signedUpJustNow, signupAttribution } from "./attribution";
import type { Team } from "./ports";

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

describe("someone signing up just now", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const team = (personal: boolean, joinedMsAgo: number): Team => ({
    id: personal ? "team_personal" : "team_shared",
    name: "Team",
    personal,
    joined_at: new Date(now - joinedMsAgo).toISOString(),
  });

  it.each([
    ["younger than the window", 30_000],
    ["a few seconds ahead of the functions' clock", -5_000],
  ])("is a person whose personal team is %s", (_, joinedMsAgo) => {
    expect(signedUpJustNow([team(true, joinedMsAgo)], now)).toBe(true);
  });

  it.each([
    ["whose personal team is as old as the window", [team(true, SIGNUP_WINDOW_MS)]],
    ["whose personal team joins in the future", [team(true, -2 * 60_000)]],
    ["whose personal team has no readable join time", [{ ...team(true, 0), joined_at: "soon" }]],
    ["with no personal team", []],
    [
      "who only just joined a team that is not their own",
      [team(false, 30_000), team(true, 86_400_000)],
    ],
  ])("is not a person %s", (_, teams) => {
    expect(signedUpJustNow(teams, now)).toBe(false);
  });
});
