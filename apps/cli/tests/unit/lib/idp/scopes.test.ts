import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { askScopes, parseScopeToken } from "../../../../src/lib/idp";
import type { Asker } from "../../../../src/lib/input";
import { GoBack, Wizard } from "../../../../src/lib/wizard";

type Question = Parameters<Asker>[0];

/**
 * A wizard whose questions are answered from a script. A text answer goes
 * through the question's own parser, as typing it would; a `"<back>"` answer
 * is the person going back.
 */
function scripted(answers: unknown[]): { wizard: Wizard; asked: Question[]; drawn: () => string } {
  const asked: Question[] = [];
  const sink = new PassThrough();
  let drawn = "";
  sink.on("data", (chunk) => {
    drawn += chunk.toString();
  });
  const ask = (async (question: Question) => {
    asked.push(question);
    const next = answers.shift();
    if (next === "<back>") {
      throw new GoBack();
    }
    if (question.kind === "text") {
      const parsed = question.parse(question.given ?? String(next ?? ""));
      if (!parsed.ok) {
        throw new Error(parsed.problem);
      }
      return parsed.value;
    }
    return next;
  }) as Asker;
  // The wizard adds its own back handling around `ask`; the script stands in
  // for the prompt underneath it.
  return { wizard: new Wizard({ ask, output: sink }), asked, drawn: () => drawn };
}

describe("parseScopeToken", () => {
  it.each(["groups", "employee:read", "https://api.example/scope", "offline_access"])(
    "accepts %s",
    (scope) => {
      expect(parseScopeToken(scope, [])).toEqual({ ok: true, value: scope });
    },
  );

  it("trims what was typed", () => {
    expect(parseScopeToken("  groups ", [])).toEqual({ ok: true, value: "groups" });
  });

  it.each(["", "  "])("asks for a scope when given %j", (scope) => {
    expect(parseScopeToken(scope, [])).toEqual({ ok: false, problem: "Enter a scope." });
  });

  it.each(["two words", 'say"hi"', "back\\slash", "tab\there"])(
    "refuses %j, which is not one word of printable characters",
    (scope) => {
      expect(parseScopeToken(scope, [])).toMatchObject({
        ok: false,
        problem: expect.stringContaining("one word"),
      });
    },
  );

  it("refuses a scope already asked for", () => {
    expect(parseScopeToken("email", ["openid", "email"])).toEqual({
      ok: false,
      problem: '"email" is already asked for.',
    });
  });
});

describe("askScopes", () => {
  it("states the scopes every connection is asked for, instead of offering them", async () => {
    const { wizard, drawn } = scripted([false]);

    await askScopes(wizard, "Acme SSO", undefined);

    expect(drawn()).toContain(
      '"Acme SSO" is always asked for the scopes openid, profile and email.',
    );
  });

  it("asks only whether to add more when the answer is no", async () => {
    const { wizard, asked } = scripted([false]);

    const scopes = await askScopes(wizard, "Acme SSO", undefined);

    expect(scopes).toBe("openid profile email");
    expect(asked.map((one) => one.message)).toEqual([
      "Would you like to ask for any additional scopes?",
    ]);
  });

  it("asks for a scope on yes, then whether there are more", async () => {
    const { wizard, asked } = scripted([true, "groups", false]);

    const scopes = await askScopes(wizard, "Acme SSO", undefined);

    expect(scopes).toBe("openid profile email groups");
    expect(asked.map((one) => one.message)).toEqual([
      "Would you like to ask for any additional scopes?",
      "Which scope should be added?",
      "Would you like to ask for any more additional scopes?",
    ]);
  });

  it("keeps asking until the answer is no, one scope at a time", async () => {
    const { wizard } = scripted([true, "groups", true, "employee", true, "phone", false]);

    expect(await askScopes(wizard, "Acme SSO", undefined)).toBe(
      "openid profile email groups employee phone",
    );
  });

  it("checks each scope as it is typed", async () => {
    const { wizard } = scripted([true, "two words"]);

    await expect(askScopes(wizard, "Acme SSO", undefined)).rejects.toThrow("one word");
  });

  it("will not take a scope it already asks for, by default or typed", async () => {
    const { wizard } = scripted([true, "email"]);

    await expect(askScopes(wizard, "Acme SSO", undefined)).rejects.toThrow(
      '"email" is already asked for.',
    );
  });

  it("goes back from the scope to the question before it", async () => {
    const { wizard, asked } = scripted([true, "<back>", false]);

    const scopes = await askScopes(wizard, "Acme SSO", undefined);

    expect(scopes).toBe("openid profile email");
    expect(asked.map((one) => one.name)).toEqual(["more scopes", "scope", "more scopes"]);
  });

  it("goes back from 'any more?' to the scope just added, shown again", async () => {
    const { wizard, asked } = scripted([true, "groups", "<back>", "employee", false]);

    const scopes = await askScopes(wizard, "Acme SSO", undefined);

    const again = asked[3];
    expect(again?.kind === "text" ? again.initialValue : undefined).toBe("groups");
    expect(scopes).toBe("openid profile email employee");
  });

  it("puts the scope back when going back from its question again", async () => {
    const { wizard } = scripted([true, "groups", "<back>", "<back>", false]);

    expect(await askScopes(wizard, "Acme SSO", undefined)).toBe("openid profile email groups");
  });

  it("leaves the flow when going back from the first question", async () => {
    const { wizard } = scripted(["<back>"]);

    await expect(askScopes(wizard, "Acme SSO", undefined)).rejects.toBeInstanceOf(GoBack);
  });

  it("asks nothing when the scopes were given, and checks them", async () => {
    const { wizard, asked } = scripted([]);

    expect(await askScopes(wizard, "Acme SSO", "openid groups")).toBe("openid groups");
    expect(asked.map((one) => one.kind)).toEqual(["text"]);
  });

  it("refuses given scopes that leave out openid", async () => {
    const { wizard } = scripted([]);

    await expect(askScopes(wizard, "Acme SSO", "profile")).rejects.toThrow("openid");
  });
});
