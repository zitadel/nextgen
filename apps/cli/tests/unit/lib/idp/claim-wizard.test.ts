import { describe, expect, it } from "vitest";

import { askClaims, attributesOf, seedMapping } from "../../../../src/lib/idp";
import type { Asker } from "../../../../src/lib/input";

const SCHEMA = {
  required: ["email"],
  properties: {
    email: { type: "string", "x-unique": "project" },
    givenName: { type: "string" },
    staffNumber: { type: "integer", "x-unique": "project" },
    badge: { type: "string" },
    score: { type: "number" },
  },
};

const attributes = attributesOf(SCHEMA);

function state(scopes = ["openid", "profile", "email"]) {
  return seedMapping(
    {
      claim_mapping: { email: "email", givenName: "given_name" },
      oidc: { scopes },
    },
    attributes,
  );
}

type Question = Parameters<Asker>[0];

/**
 * An asker that answers from a script, in order, and keeps what it was asked.
 * A parse that refuses the scripted text fails the test, as the prompt would
 * refuse it as it is typed.
 */
function scripted(answers: readonly unknown[]): { ask: Asker; asked: Question[] } {
  const queue = [...answers];
  const asked: Question[] = [];
  const ask = (async (question: Question) => {
    asked.push(question);
    if (queue.length === 0) {
      throw new Error(`unexpected question: ${question.message}`);
    }
    const next = queue.shift();
    if (question.kind === "text") {
      const parsed = question.parse(String(next));
      if (!parsed.ok) {
        throw new Error(`refused ${JSON.stringify(next)}: ${parsed.problem}`);
      }
      return parsed.value;
    }
    return next;
  }) as Asker;
  return { ask, asked };
}

const names = (asked: Question[]) => asked.map((question) => question.name);

describe("askClaims", () => {
  it("asks nothing further when the person continues", async () => {
    const { ask, asked } = scripted([false]);

    const request = await askClaims(state(), ask);

    expect(request).toEqual({ entries: [], verified: [], scopes: [] });
    expect(names(asked)).toEqual(["whether to map another claim"]);
  });

  it("still offers to replace a default when every property has one", async () => {
    const full = seedMapping(
      { claim_mapping: { email: "email" }, oidc: { scopes: ["openid"] } },
      attributesOf({ properties: { email: { type: "string" } } }),
    );
    const { ask, asked } = scripted([false]);

    await askClaims(full, ask);

    expect(names(asked)).toEqual(["whether to map another claim"]);
  });

  it("replaces a default with the claim the person names, and says it is replaced", async () => {
    const { ask, asked } = scripted([true, "mail", "string", "email", "", "none", false]);

    const request = await askClaims(state(), ask);

    const property = asked.find((question) => question.name === "property");
    const hints = property?.kind === "select" ? property.options.map((option) => option.hint) : [];
    expect(request.entries).toEqual([{ attribute: "email", claim: "mail" }]);
    expect(hints).toContain("string, required, unique, replaces email");
  });

  it("hands the mapping to the caller's own renderer when it has one", async () => {
    const { ask } = scripted([false]);
    const shown: (readonly string[])[] = [];

    await askClaims(state(), ask, (lines) => shown.push(lines));

    expect(shown[0]).toEqual([
      "Claims mapped to the user schema:",
      "email ← email (verified by email_verified)",
      "givenName ← given_name",
    ]);
  });

  it("maps a claim the person names to a property they choose", async () => {
    const { ask } = scripted([true, "badge_number", "string", "badge", "", false]);

    const request = await askClaims(state(), ask);

    expect(request.entries).toEqual([{ attribute: "badge", claim: "badge_number" }]);
  });

  it("asks the type of a claim the standard does not define, and carries it into the entry", async () => {
    const { ask, asked } = scripted([true, "points", "integer", "score", "", false]);

    const request = await askClaims(state(), ask);

    expect(names(asked)).toContain("claim type");
    expect(request.entries).toEqual([{ attribute: "score", claim: "points", type: "integer" }]);
  });

  it("does not ask the type of a standard claim", async () => {
    const { ask, asked } = scripted([true, "nickname", "badge", "", false]);

    await askClaims(state(), ask);

    expect(names(asked)).not.toContain("claim type");
  });

  it("offers only empty properties whose type holds the claim", async () => {
    const { ask, asked } = scripted([
      true,
      "employee_id",
      "integer",
      "staffNumber",
      "",
      "none",
      false,
    ]);

    await askClaims(state(), ask);

    const property = asked.find((question) => question.name === "property");
    const offered =
      property?.kind === "select" ? property.options.map((option) => option.value) : [];
    expect(offered).toEqual(["staffNumber", "score"]);
  });

  it("refuses, as it is typed, a claim that already fills a property", async () => {
    const { ask } = scripted([true, "given_name"]);

    await expect(askClaims(state(), ask)).rejects.toThrow(
      "given_name already fills givenName: a claim fills one property.",
    );
  });

  it("says so, and asks again, when no empty property can hold the claim", async () => {
    const small = seedMapping(
      { claim_mapping: { email: "email" }, oidc: { scopes: ["openid", "email"] } },
      attributesOf({
        properties: { email: { type: "string" }, count: { type: "string" } },
      }),
    );
    const { ask, asked } = scripted([true, "points", "boolean", false]);

    const request = await askClaims(small, ask);

    expect(request.entries).toEqual([]);
    expect(names(asked)).toEqual([
      "whether to map another claim",
      "claim",
      "claim type",
      "whether to map another claim",
    ]);
  });

  it("suggests the scope a standard claim needs when it is not requested yet", async () => {
    const { ask, asked } = scripted([true, "phone_number", "badge", "phone", false]);

    const request = await askClaims(state(), ask);

    const scope = asked.find((question) => question.name === "scope");
    expect(scope?.kind === "text" ? scope.initialValue : undefined).toBe("phone");
    expect(request.scopes).toEqual(["phone"]);
  });

  it("does not suggest a scope the connection already requests", async () => {
    const { ask, asked } = scripted([true, "nickname", "badge", "", false]);

    await askClaims(state(), ask);

    const scope = asked.find((question) => question.name === "scope");
    expect(scope?.kind === "text" ? scope.initialValue : undefined).toBe("");
  });

  it("asks how a unique property is verified and records trusting the provider", async () => {
    const { ask } = scripted([true, "employee_id", "integer", "staffNumber", "", "trust", false]);

    const request = await askClaims(state(), ask);

    expect(request.verified).toEqual([{ attribute: "staffNumber", source: true }]);
  });

  it("records the boolean claim that verifies a unique property", async () => {
    const { ask } = scripted([
      true,
      "employee_id",
      "integer",
      "staffNumber",
      "",
      "claim",
      "employee_confirmed",
      false,
    ]);

    const request = await askClaims(state(), ask);

    expect(request.verified).toEqual([{ attribute: "staffNumber", source: "employee_confirmed" }]);
  });

  it("does not ask about verification for a property that is not unique", async () => {
    const { ask, asked } = scripted([true, "badge_number", "string", "badge", "", false]);

    await askClaims(state(), ask);

    expect(names(asked)).not.toContain("verification");
  });

  it("keeps asking until the person continues, and gathers every mapping", async () => {
    const { ask } = scripted([
      true,
      "badge_number",
      "string",
      "badge",
      "",
      true,
      "points",
      "number",
      "score",
      "points",
      false,
    ]);

    const request = await askClaims(state(), ask);

    expect(request.entries.map((entry) => entry.attribute)).toEqual(["badge", "score"]);
    expect(request.scopes).toEqual(["points"]);
  });

  it("stops offering once every property has been mapped by the person", async () => {
    const { ask, asked } = scripted([true, "badge_number", "string", "badge", ""]);
    const only = seedMapping(
      { claim_mapping: {}, oidc: { scopes: ["openid"] } },
      attributesOf({ properties: { badge: { type: "string" } } }),
    );

    const request = await askClaims(only, ask);

    expect(request.entries).toEqual([{ attribute: "badge", claim: "badge_number" }]);
    expect(names(asked).filter((name) => name === "whether to map another claim")).toHaveLength(1);
  });
});
