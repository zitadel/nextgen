import { describe, expect, it } from "vitest";

import { Flow } from "@/lib/zitadel";
import { propertyPath, stepName } from "@/lib/zitadel/names";
import { Step } from "@/lib/zitadel/resources/flows/step";
import type { JsonObject } from "@/lib/zitadel/types";
import { aFile } from "@tests/helpers/config";
import { aFlowBody } from "@tests/helpers/flows";

/**
 * A step that asks for an email and a password, and sends each outcome
 * somewhere the tests can name.
 */
const EMAIL_AND_PASSWORD = {
  name: "identifier",
  fields: ["email", "x-auth-methods#password"],
};

/**
 * A step named `identifier` that routes the transitions given.
 *
 * @param transitions - The transitions the step routes, by outcome.
 * @returns The step body.
 */
function routing(transitions: JsonObject): JsonObject {
  return { name: "identifier", transitions };
}

/**
 * A step read the way the flow contract reads it, so the optional keys it
 * leaves out take the contract's values.
 *
 * @param step - The step's body, as the flow file holds it.
 * @returns The step.
 * @throws {Error} When the flow contract refuses the step, so the test names
 *   the step rather than reading a broken one.
 */
function stepOf(step: JsonObject): Step {
  const reading = Flow.read(aFile("flows", "login.json", aFlowBody({ steps: [step] })));
  if (!(reading instanceof Flow)) {
    throw new Error(`the flow contract refused the step ${JSON.stringify(step)}`);
  }
  const first = reading.steps[0];
  if (first === undefined) {
    throw new Error(`the flow read no step from ${JSON.stringify(step)}`);
  }
  return first;
}

describe("Step.name", () => {
  it("is the name the step is given", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.name).toBe(stepName("identifier"));
  });
});

describe("Step.of", () => {
  it("is the step a flow hands out for each of its steps", () => {
    const step = stepOf({ name: "password" });

    expect(step).toBeInstanceOf(Step);
  });
});

describe("Step.providers", () => {
  it("lists the providers the step offers, in order", () => {
    const step = stepOf({ name: "identifier", sso_providers: ["google", "github"] });

    expect(step.providers).toEqual(["google", "github"]);
  });

  it("is none for a step that lists no provider", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.providers).toEqual([]);
  });
});

describe("Step.fields", () => {
  it("lists the fields the step asks for, in order", () => {
    const step = stepOf(EMAIL_AND_PASSWORD);

    expect(step.fields).toEqual(["email", "x-auth-methods#password"]);
  });

  it("is none for a step that asks for nothing", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.fields).toEqual([]);
  });
});

describe("Step.actions", () => {
  it("lists the actions the step declares", () => {
    const step = stepOf({ name: "identifier", actions: [{ name: "passkey", kind: "passkey" }] });

    expect(step.actions).toEqual([{ name: "passkey", kind: "passkey", primary: false }]);
  });

  it("is none for a step that declares none", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.actions).toEqual([]);
  });
});

describe("Step.hasGates", () => {
  it("is true for a step that declares a gate", () => {
    const step = stepOf({
      name: "identifier",
      gates: { consent: { kind: "captcha", provider: "altcha" } },
    });

    expect(step.hasGates).toBe(true);
  });

  it("is false for a step that declares no gates", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.hasGates).toBe(false);
  });

  it("is false for a step whose gates block is empty", () => {
    const step = stepOf({ name: "identifier", gates: {} });

    expect(step.hasGates).toBe(false);
  });
});

describe("Step.createsUserFromSso", () => {
  it("is true for a step that creates a user from a provider's sign-in", () => {
    const step = stepOf({ name: "register-sso", on_success: "create_user_with_sso" });

    expect(step.createsUserFromSso).toBe(true);
  });

  it("is false for a step that does not", () => {
    const step = stepOf({ name: "identifier", on_success: "create_user" });

    expect(step.createsUserFromSso).toBe(false);
  });

  it("is false for a step that names no success handling", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.createsUserFromSso).toBe(false);
  });
});

describe("Step.transitions", () => {
  it("names the step an outcome goes to", () => {
    const step = stepOf(routing({ submit: { target: "password" } }));

    expect(step.transitions).toEqual([
      { kind: "step", outcome: "submit", target: stepName("password"), purpose: undefined },
    ]);
  });

  it("keeps the purpose a transition to a step re-purposes the attempt to", () => {
    const step = stepOf(routing({ submit: { target: "register", purpose: "register" } }));

    expect(step.transitions).toEqual([
      { kind: "step", outcome: "submit", target: stepName("register"), purpose: "register" },
    ]);
  });

  it("treats a null action and purpose as leaving the transition in this flow", () => {
    const step = stepOf(routing({ submit: { target: "password", action: null, purpose: null } }));

    expect(step.transitions).toEqual([
      { kind: "step", outcome: "submit", target: stepName("password"), purpose: undefined },
    ]);
  });

  it("names the purpose's entry step for a transition that names only a purpose", () => {
    const step = stepOf(routing({ go: { purpose: "register" } }));

    expect(step.transitions).toEqual([{ kind: "purpose", outcome: "go", purpose: "register" }]);
  });

  it("marks a transition with an action as leaving the flow", () => {
    const step = stepOf(routing({ go: { target: "password", action: "switch" } }));

    expect(step.transitions).toEqual([
      {
        kind: "cross-flow",
        outcome: "go",
        action: "switch",
        target: stepName("password"),
      },
    ]);
  });

  it("marks a transition that names neither a step, a purpose nor an action as going nowhere", () => {
    const step = stepOf(routing({ go: {} }));

    expect(step.transitions).toEqual([{ kind: "nowhere", outcome: "go" }]);
  });

  it("lists one transition per outcome, in the order written", () => {
    const step = stepOf(
      routing({ first: { target: "password" }, second: { purpose: "register" } }),
    );

    expect(
      step.transitions.map((transition) => {
        return transition.outcome;
      }),
    ).toEqual(["first", "second"]);
  });

  it("is none for a step that routes no outcome", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.transitions).toEqual([]);
  });
});

describe("Step.routes", () => {
  it("includes an outcome the engine follows", () => {
    const step = stepOf(routing({ submit: { target: "password" } }));

    expect(step.routes.has("submit")).toBe(true);
  });

  it("includes user_already_exists when it leads to a step with no action", () => {
    const step = stepOf(routing({ user_already_exists: { target: "sso-conflict" } }));

    expect(step.routes.has("user_already_exists")).toBe(true);
  });

  it("leaves out user_already_exists when it carries an action the engine does not follow", () => {
    const step = stepOf(routing({ user_already_exists: { target: "password", action: "switch" } }));

    expect(step.routes.has("user_already_exists")).toBe(false);
  });

  it("still includes another outcome that carries an action", () => {
    const step = stepOf(routing({ other: { target: "password", action: "switch" } }));

    expect(step.routes.has("other")).toBe(true);
  });

  it("is empty for a step that routes no outcome", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.routes.size).toBe(0);
  });
});

describe("Step.collisionCarriesAction", () => {
  it("is true when user_already_exists carries an action", () => {
    const step = stepOf(routing({ user_already_exists: { target: "password", action: "switch" } }));

    expect(step.collisionCarriesAction).toBe(true);
  });

  it("is false when user_already_exists carries no action", () => {
    const step = stepOf(routing({ user_already_exists: { target: "sso-conflict" } }));

    expect(step.collisionCarriesAction).toBe(false);
  });

  it("is false when the step writes no user_already_exists transition", () => {
    const step = stepOf(routing({ submit: { target: "password", action: "switch" } }));

    expect(step.collisionCarriesAction).toBe(false);
  });
});

describe("Step.asksFor", () => {
  it.each([
    { named: "the field itself", field: "email", path: "email" },
    { named: "a property inside a field", field: "address", path: "address.street" },
    { named: "the object a field sits in", field: "address.street", path: "address" },
  ])("is true for $named", ({ field, path }) => {
    const step = stepOf({ name: "identifier", fields: [field] });

    expect(step.asksFor(propertyPath(path))).toBe(true);
  });

  it("is false for a property no field covers", () => {
    const step = stepOf(EMAIL_AND_PASSWORD);

    expect(step.asksFor(propertyPath("phone"))).toBe(false);
  });

  it("is false for a property that only shares a prefix with a field", () => {
    const step = stepOf({ name: "identifier", fields: ["email"] });

    expect(step.asksFor(propertyPath("emailAddress"))).toBe(false);
  });

  it("is false for a step that asks for nothing", () => {
    const step = stepOf({ name: "identifier" });

    expect(step.asksFor(propertyPath("email"))).toBe(false);
  });
});
