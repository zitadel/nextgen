import { describe, expect, it } from "vitest";

import { askScopes } from "../../../../src/lib/idp";
import type { Asker } from "../../../../src/lib/input";

type Question = Parameters<Asker>[0];

/** An asker that answers each question from a script and keeps what it was asked. */
function scripted(answers: unknown[]): { ask: Asker; asked: Question[] } {
  const asked: Question[] = [];
  const ask = (async (question: Question) => {
    asked.push(question);
    const next = answers.shift();
    if (question.kind === "text") {
      const parsed = question.parse(question.given ?? String(next ?? ""));
      if (!parsed.ok) {
        throw new Error(parsed.problem);
      }
      return parsed.value;
    }
    return next;
  }) as Asker;
  return { ask, asked };
}

describe("askScopes", () => {
  it("offers the standard scopes with the usual ones ticked", async () => {
    const { ask, asked } = scripted([["openid", "profile", "email"], ""]);

    await askScopes(ask, "Acme SSO", undefined);

    const first = asked[0];
    expect(first?.kind === "multiselect" ? first.initialValues : undefined).toEqual([
      "openid",
      "profile",
      "email",
    ]);
    expect(first?.kind === "multiselect" ? first.options.map((one) => one.value) : []).toEqual([
      "openid",
      "profile",
      "email",
      "phone",
      "address",
      "offline_access",
    ]);
  });

  it("names the provider in the question", async () => {
    const { ask, asked } = scripted([["openid"], ""]);

    await askScopes(ask, "Acme SSO", undefined);

    expect(asked[0]?.message).toBe('Which scopes should "Acme SSO" be asked for?');
  });

  it("then asks for any additional scopes", async () => {
    const { ask, asked } = scripted([["openid", "profile"], "groups employee"]);

    const scopes = await askScopes(ask, "Acme SSO", undefined);

    expect(asked[1]?.message).toBe(
      "Would you like to ask for any additional scopes? Leave blank for none.",
    );
    expect(scopes).toBe("openid profile groups employee");
  });

  it("takes nothing extra when the answer is blank", async () => {
    const { ask } = scripted([["openid", "email"], ""]);

    expect(await askScopes(ask, "Acme SSO", undefined)).toBe("openid email");
  });

  it("always asks for openid, even when it was unticked", async () => {
    const { ask } = scripted([["profile"], ""]);

    expect(await askScopes(ask, "Acme SSO", undefined)).toBe("openid profile");
  });

  it("does not repeat a scope that was ticked and typed", async () => {
    const { ask } = scripted([["openid", "email"], "email groups"]);

    expect(await askScopes(ask, "Acme SSO", undefined)).toBe("openid email groups");
  });

  it("asks nothing when the scopes were given, and checks them", async () => {
    const { ask, asked } = scripted([]);

    expect(await askScopes(ask, "Acme SSO", "openid groups")).toBe("openid groups");
    expect(asked.map((one) => one.kind)).toEqual(["text"]);
  });

  it("refuses given scopes that leave out openid", async () => {
    const { ask } = scripted([]);

    await expect(askScopes(ask, "Acme SSO", "profile")).rejects.toThrow("openid");
  });
});
