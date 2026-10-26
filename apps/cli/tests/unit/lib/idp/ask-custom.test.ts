import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { text } from "@clack/prompts";

import { type Asker, input } from "../../../../src/lib/input";
import { askCustomSettings } from "../../../../src/lib/idp";

const ask: Asker = (question) => input(question, { interactive: true, force: false });

describe("askCustomSettings", () => {
  beforeEach(() => {
    vi.mocked(text).mockReset();
  });

  it("asks for nothing when every setting was given", async () => {
    const given = {
      slug: "acme-sso",
      displayName: "Acme SSO",
      issuer: "https://sso.acme.example",
      scopes: "openid",
    };

    expect(await askCustomSettings(given, ask)).toEqual(given);
    expect(text).not.toHaveBeenCalled();
  });

  const EVERYTHING = {
    slug: "acme-sso",
    displayName: "Acme SSO",
    issuer: "https://sso.acme.example",
    scopes: "openid",
  };
  const QUESTIONS = {
    slug: "What would you like to call this connection?",
    displayName: "What name should the sign-in button show?",
    issuer: "What is the issuer URL of the provider?",
    scopes: "Which scopes should we request?",
  };

  it.each([
    [["slug"], ["displayName", "issuer", "scopes"]],
    [
      ["displayName", "scopes"],
      ["slug", "issuer"],
    ],
    [["slug", "displayName", "issuer"], ["scopes"]],
    [[], ["slug", "displayName", "issuer", "scopes"]],
  ] as const)("given %j asks only for %j, in that order", async (givenKeys, askedKeys) => {
    const given = Object.fromEntries(givenKeys.map((key) => [key, EVERYTHING[key]]));
    vi.mocked(text).mockImplementation(
      (async ({ message }: { message: string }) =>
        Object.values(EVERYTHING)[
          Object.values(QUESTIONS).findIndex((question) => message.startsWith(question))
        ]) as never,
    );

    await askCustomSettings(given, ask);

    expect(vi.mocked(text).mock.calls.map(([options]) => options.message)).toEqual(
      askedKeys.map((key) => expect.stringContaining(QUESTIONS[key])),
    );
  });

  it.each([
    ["slug", "Not A Slug"],
    ["issuer", "not a url"],
  ] as const)("refuses a given %s that does not parse, without asking", async (key, value) => {
    await expect(askCustomSettings({ ...EVERYTHING, [key]: value }, ask)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("returns the scopes that were given as one string", async () => {
    const values = await askCustomSettings({ ...EVERYTHING, scopes: "openid  email" }, ask);

    expect(values.scopes).toBe("openid email");
  });

  it("asks only for the settings that were left out", async () => {
    vi.mocked(text).mockResolvedValueOnce("Acme SSO" as never);
    vi.mocked(text).mockResolvedValueOnce("openid groups" as never);

    const values = await askCustomSettings(
      {
        slug: "acme-sso",
        issuer: "https://sso.acme.example",
      },
      ask,
    );

    expect(vi.mocked(text)).toHaveBeenCalledTimes(2);
    expect(values).toEqual({
      slug: "acme-sso",
      displayName: "Acme SSO",
      issuer: "https://sso.acme.example",
      scopes: "openid groups",
    });
  });
});
