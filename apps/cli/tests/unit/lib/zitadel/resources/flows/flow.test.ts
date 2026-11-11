import { describe, expect, it } from "vitest";

import { Flow, RefusedEditError } from "@/lib/zitadel";
import { stepName } from "@/lib/zitadel/names";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import type { JsonObject } from "@/lib/zitadel/types";
import { withoutKey } from "@/lib/zitadel/utils/json";
import { aFile, aLoginFlow } from "@tests/helpers/config";
import {
  aFlow,
  aPasskeyFirstFlow,
  aPasskeyFlow,
  aPasswordFlow,
  FLOW_PATH,
  PASSWORD_ONLY,
  withStep,
} from "@tests/helpers/flows";
import { slug } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The provider the tests enable.
 */
const GOOGLE = slug("google");

/**
 * The editor's pointer at the flow meta-schema.
 */
const POINTER = "../meta/flow-definition.json";

/**
 * A flow that only registers, collecting a password on the way.
 */
const REGISTER_ONLY = {
  status: "active",
  purposes: { register: "register" },
  steps: [{ name: "register", fields: ["email", "x-auth-methods#password"] }],
};

/**
 * A flow whose login offers a passkey only, and collects a password on the
 * register side, which the login hands over to with a purpose flip.
 */
const SIGNS_IN_AND_REGISTERS = {
  status: "active",
  purposes: { login: "start", register: "register" },
  steps: [
    {
      name: "start",
      actions: [{ name: "passkey", kind: "passkey" }],
      transitions: { register: { target: "register", purpose: "register" } },
    },
    { name: "register", fields: ["x-auth-methods#password"] },
  ],
};

/**
 * A flow whose login reaches its password step by a local transition that
 * spells out a null action and purpose.
 */
const NULL_ACTION_AND_PURPOSE = {
  status: "active",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      transitions: { submit: { target: "password", action: null, purpose: null } },
    },
    { name: "password", fields: ["x-auth-methods#password"] },
  ],
};

/**
 * A flow whose login leaves by a `switch` to a step of another flow that
 * shares its name with a local password step.
 */
const SWITCHING_TO_ANOTHER_FLOW = {
  status: "active",
  purposes: { login: "identifier" },
  steps: [
    { name: "identifier", transitions: { other: { target: "password", action: "switch" } } },
    { name: "password", fields: ["x-auth-methods#password"] },
  ],
};

/**
 * The shipped shape: `user_not_found` routes to the register step with no
 * purpose, which switches the login to registration on its own.
 */
const SWITCHING_TO_REGISTRATION = {
  status: "active",
  purposes: { login: "identifier", register: "register" },
  steps: [
    {
      name: "identifier",
      actions: [{ name: "passkey", kind: "passkey" }],
      transitions: { user_not_found: { target: "register" } },
    },
    { name: "register", fields: ["x-auth-methods#password"] },
  ],
};

/**
 * A flow whose login entry only enrols a passkey.
 */
const ENROLS_PASSKEYS = {
  status: "active",
  purposes: { login: "register" },
  steps: [{ name: "register", actions: [{ name: "enrol", kind: "passkey_register" }] }],
};

/**
 * A served flow whose login entry offers these providers.
 *
 * @param providers - The providers the entry step lists.
 * @returns The flow document.
 */
function offering(...providers: string[]): JsonObject {
  return {
    status: "active",
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", sso_providers: providers }],
  };
}

/**
 * A login that starts on `start`, which collects nothing, and leaves it by
 * one transition to a step collecting `email`.
 *
 * @param outcome - The transition's outcome.
 * @param transition - The transition, without its target.
 * @returns The flow, as read.
 */
function leavingStartBy(outcome: string, transition: JsonObject): Flow {
  return aFlow({
    purposes: { login: "start", register: "register" },
    steps: [
      {
        name: "start",
        fields: [],
        transitions: { [outcome]: { target: "register", ...transition } },
      },
      { name: "register", fields: ["email"] },
    ],
  });
}

/**
 * The scaffolded login flow with Google enabled for a password-only schema.
 *
 * @returns The edited flow.
 */
function offeringGoogle(): Flow {
  return aFlow(aLoginFlow()).withProvider(GOOGLE, PASSWORD_ONLY).document;
}

describe("Flow.of", () => {
  it("takes the file as read", () => {
    const flow = Flow.of(aFile("flows", "login.json", aLoginFlow()));

    expect(flow.status).toBe("read");
  });
});

describe("Flow.read", () => {
  it("takes a file the flow contract takes as a flow", () => {
    const reading = Flow.read(aFile("flows", "login.json", aLoginFlow()));

    expect(reading).toBeInstanceOf(Flow);
  });

  it("takes a flow with no name as a broken file", () => {
    const nameless = withoutKey(aLoginFlow(), "name");

    const reading = Flow.read(aFile("flows", "login.json", nameless));

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("reports what the flow contract refuses, under contract/flow", () => {
    const reading = Flow.read(aFile("flows", "login.json", { ...aLoginFlow(), steps: "none" }));

    expect(reading).toMatchObject({
      issues: [expect.objectContaining({ rule: "contract/flow", file: FLOW_PATH })],
    });
  });
});

describe("Flow.create", () => {
  it("takes the file as new", () => {
    const flow = Flow.create(aFile("flows", "login.json", aLoginFlow()));

    expect(flow.status).toBe("created");
  });
});

describe("Flow.handle", () => {
  it("is the name a release pins the flow by, not its file name", () => {
    const flow = aFlow({ name: "default-login" });

    const handle = flow.handle;

    expect(handle).toBe("default-login");
  });
});

describe("Flow.steps", () => {
  it("builds the steps once, however often they are asked for", () => {
    const flow = aFlow(aLoginFlow());

    const first = flow.steps;
    const second = flow.steps;

    expect(second).toBe(first);
  });

  it("is the step findStep answers with, so the lookup holds the same steps", () => {
    const flow = aFlow(aLoginFlow());

    const found = flow.steps.map((step) => {
      return flow.findStep(step.name);
    });

    expect(found).toEqual(flow.steps);
    expect(found[0]).toBe(flow.steps[0]);
  });
});

describe("Flow.check", () => {
  it("finds nothing wrong with the scaffolded flow", () => {
    const flow = aFlow(aLoginFlow());

    const issues = flow.check({});

    expect(issues).toEqual([]);
  });
});

describe("Flow.toWireBody", () => {
  it("sends the flow without its $schema pointer", () => {
    const flow = aFlow({ ...aLoginFlow(), $schema: POINTER });

    const body = flow.toWireBody(new MemoryStore());

    expect(body).toEqual(withoutKey(aLoginFlow(), "$schema"));
  });
});

describe("Flow.findOfferedMethods", () => {
  it.each([
    { method: "password", reaching: "a step that collects it", flow: aPasswordFlow() },
    { method: "passkey", reaching: "a step that offers the action", flow: aPasskeyFlow() },
  ])("sees $method on $reaching", ({ method, flow }) => {
    const login = aFlow(flow);

    const offered = login.findOfferedMethods([]);

    expect(offered).toEqual([method]);
  });

  it("follows a local transition with null action and purpose", () => {
    const flow = aFlow(NULL_ACTION_AND_PURPOSE);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual(["password"]);
  });

  it("ignores a flow that is not active", () => {
    const flow = aFlow(aPasskeyFlow({ status: "draft" }));

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual([]);
  });

  it("does not count a register-only flow that collects a password", () => {
    const flow = aFlow(REGISTER_ONLY);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual([]);
  });

  it("does not count register steps of a flow that also signs in", () => {
    const flow = aFlow(SIGNS_IN_AND_REGISTERS);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual(["passkey"]);
  });

  it("does not follow a transition into another flow", () => {
    const flow = aFlow(SWITCHING_TO_ANOTHER_FLOW);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual([]);
  });

  it("stops at an outcome that switches to registration on its own", () => {
    const flow = aFlow(SWITCHING_TO_REGISTRATION);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual(["passkey"]);
  });

  it("does not count a flow that only registers passkeys", () => {
    const flow = aFlow(ENROLS_PASSKEYS);

    const offered = flow.findOfferedMethods([]);

    expect(offered).toEqual([]);
  });

  it("does not count SSO for a provider it was not given", () => {
    const flow = aFlow(offering("github"));

    const offered = flow.findOfferedMethods(["google"]);

    expect(offered).toEqual([]);
  });

  it("counts SSO on a step that names a provider it was given", () => {
    const flow = aFlow(offering("google"));

    const offered = flow.findOfferedMethods(["google"]);

    expect(offered).toEqual(["sso"]);
  });
});

describe("Flow.findMethodUses", () => {
  it("says what a step keeps without a password and which transitions lead to it", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const uses = flow.findMethodUses("password", ["passkey"]);

    expect(uses).toEqual([
      {
        step: "password",
        uses: "collects password",
        keeps: ['passkey action "passkey"'],
        entryFor: [],
        targetedBy: [{ step: "identifier", transition: "submit" }],
      },
      {
        step: "sso-conflict",
        uses: "collects password",
        keeps: [],
        entryFor: [],
        targetedBy: [],
      },
    ]);
  });

  it("flags an entry step left with nothing, and the transitions that reach it through its purpose", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const [entry] = flow.findMethodUses("passkey", ["password"]);

    expect(entry).toEqual({
      step: "passkey-first",
      uses: 'offers passkey (action "passkey")',
      keeps: [],
      entryFor: ["login"],
      targetedBy: [
        { step: "register", transition: "sign_in", purpose: "login" },
        { step: "sso-conflict", transition: "sign_in" },
      ],
    });
  });

  it("lists every step that offers a passkey, with what each keeps", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const uses = flow.findMethodUses("passkey", ["password"]);

    expect(uses).toMatchObject([
      { step: "passkey-first", keeps: [] },
      { step: "identifier", keeps: ['field "email"'] },
      { step: "password", keeps: ['field "x-auth-methods#password"'] },
    ]);
  });

  it("counts sso_providers and gates as what a step keeps", () => {
    const flow = aFlow({
      purposes: { login: "password" },
      steps: [
        {
          name: "password",
          fields: ["x-auth-methods#password"],
          sso_providers: ["google"],
          gates: { consent: { kind: "captcha", provider: "altcha" } },
        },
      ],
    });

    const [use] = flow.findMethodUses("password", ["sso"]);

    expect(use?.keeps).toEqual(["sso_providers", "gates"]);
  });

  it("does not count a transition into another flow as targeting a step", () => {
    const flow = aFlow({
      purposes: { login: "password" },
      steps: [
        { name: "start", transitions: { go: { target: "password", action: "switch" } } },
        { name: "password", fields: ["x-auth-methods#password"] },
      ],
    });

    const [use] = flow.findMethodUses("password", []);

    expect(use?.targetedBy).toEqual([]);
  });

  it("does not count what a method the schema no longer enables offers", () => {
    const flow = aFlow({
      purposes: { login: "password" },
      steps: [
        {
          name: "password",
          fields: ["x-auth-methods#password"],
          actions: [{ name: "passkey", kind: "passkey" }],
          sso_providers: ["google"],
        },
      ],
    });

    const [use] = flow.findMethodUses("password", []);

    expect(use?.keeps).toEqual([]);
  });
});

describe("Flow.loginJourney", () => {
  it("follows the transitions that stay in the login purpose", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const journey = flow.loginJourney;

    expect(
      journey.map((step) => {
        return step.name;
      }),
    ).toEqual(["passkey-first", "identifier", "password", "done"]);
  });

  it("is empty for a flow with no login entry", () => {
    const flow = aFlow(aPasskeyFirstFlow({ purposes: {} }));

    const journey = flow.loginJourney;

    expect(journey).toEqual([]);
  });
});

describe("Flow.loginFields", () => {
  it("collects the fields of every step reached from the login entry", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const fields = flow.loginFields;

    expect([...fields]).toEqual(["email", "x-auth-methods#password"]);
  });

  it("follows a plain transition, even to a step that is also the sign-up entry", () => {
    const flow = leavingStartBy("go", {});

    const fields = flow.loginFields;

    expect([...fields]).toEqual(["email"]);
  });

  it.each([
    ["names another purpose", "go", { purpose: "register" }],
    ["goes to another flow", "go", { action: "switch" }],
    ["switches the login to registration (user_not_found)", "user_not_found", {}],
    ["switches the login to registration (sso_user_not_found)", "sso_user_not_found", {}],
  ])("does not follow a transition that %s", (_case, outcome, transition) => {
    const flow = leavingStartBy(outcome, transition);

    const fields = flow.loginFields;

    expect([...fields]).toEqual([]);
  });

  it("is empty for a flow with no login entry", () => {
    const flow = aFlow(aPasskeyFirstFlow({ purposes: {} }));

    const fields = flow.loginFields;

    expect([...fields]).toEqual([]);
  });
});

describe("Flow.namesSchemaById", () => {
  it.each([
    { named: "a platform id", reference: "sch_01J000000000000000000000", expected: true },
    { named: "a $id URL", reference: "https://schemas.zitadel.com/human-user/v1", expected: true },
    { named: "an objectType", reference: "human-user", expected: false },
    { named: "nothing", reference: "", expected: false },
  ])("is $expected for $named", ({ reference, expected }) => {
    const flow = aFlow({ user_schema: reference });

    const byId = flow.namesSchemaById;

    expect(byId).toBe(expected);
  });
});

describe("Flow.findTransitionsInto", () => {
  it("names each transition to a step, and the purpose one follows to it", () => {
    const flow = aFlow(aPasskeyFirstFlow());

    const transitions = flow.findTransitionsInto(stepName("passkey-first"));

    expect(transitions).toEqual([
      { step: "register", transition: "sign_in", purpose: "login" },
      { step: "sso-conflict", transition: "sign_in" },
    ]);
  });
});

describe("Flow.withProvider", () => {
  it("offers the provider", () => {
    const flow = aFlow(aLoginFlow());

    const { document } = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(document.offers("google")).toBe(true);
  });

  it("marks the flow as edited", () => {
    const flow = aFlow(aLoginFlow());

    const { document } = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(document.status).toBe("edited");
  });

  it("says it changed the flow", () => {
    const flow = aFlow(aLoginFlow());

    const { changed } = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(changed).toBe(true);
  });

  it("leaves nothing alone in the scaffolded flow", () => {
    const flow = aFlow(aLoginFlow());

    const { skipped } = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(skipped).toEqual([]);
  });

  it("returns the same flow the second time", () => {
    const flow = offeringGoogle();

    const edit = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(edit).toEqual({ document: flow, changed: false, skipped: [] });
  });

  it("names a generated step that was edited by hand", () => {
    const flow = aFlow(
      withStep(offeringGoogle().body, "register-sso", (step) => {
        return { ...step, title: "Hand-written" };
      }),
    );

    const { skipped } = flow.withProvider(GOOGLE, PASSWORD_ONLY);

    expect(skipped).toEqual([
      { step: "register-sso", region: "steps.register-sso", reason: "hand-edited" },
    ]);
  });
});

describe("Flow.offers", () => {
  it("is false for any provider on a flow no step of which offers one", () => {
    const flow = aFlow(aLoginFlow());

    const offers = flow.offersSso;

    expect(offers).toBe(false);
  });

  it.each([
    { provider: "google", expected: true },
    { provider: "github", expected: false },
  ])(
    "is $expected for $provider on a flow a step of which lists google",
    ({ provider, expected }) => {
      const flow = aFlow({ steps: [{ name: "identifier", sso_providers: ["google"] }] });

      const offers = flow.offers(provider);

      expect(offers).toBe(expected);
    },
  );
});

describe("Flow.generatedSsoSteps", () => {
  it("names none for a flow no provider was enabled on", () => {
    const flow = aFlow(aLoginFlow());

    const steps = flow.generatedSsoSteps;

    expect(steps).toEqual([]);
  });

  it("names the steps enabling a provider added", () => {
    const flow = offeringGoogle();

    const steps = flow.generatedSsoSteps;

    expect(steps).toEqual(["register-sso", "sso-conflict"]);
  });
});

describe("Flow.assertProviderEditable", () => {
  it("accepts the scaffolded flow", () => {
    const flow = aFlow(aLoginFlow());

    const error = thrownBy(() => {
      flow.assertProviderEditable();
    });

    expect(error).toBeUndefined();
  });

  it("refuses a flow with no step that marks where a sign-in ends", () => {
    const flow = aFlow({ purposes: { login: "identifier" }, steps: [{ name: "identifier" }] });

    const error = thrownBy(() => {
      flow.assertProviderEditable();
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${FLOW_PATH}: no step marks where a completed sign-in ends`,
    });
  });
});

describe("Flow.withoutProvider", () => {
  it("takes the provider off every step", () => {
    const flow = offeringGoogle();

    const { document } = flow.withoutProvider("google");

    expect(document.offers("google")).toBe(false);
  });

  it("says it changed the flow", () => {
    const flow = offeringGoogle();

    const { changed } = flow.withoutProvider("google");

    expect(changed).toBe(true);
  });

  it("returns the same flow for a provider no step offers", () => {
    const flow = aFlow(aLoginFlow());

    const edit = flow.withoutProvider("google");

    expect(edit).toEqual({ document: flow, changed: false, skipped: [] });
  });
});

describe("Flow.isPasskeyActionKind", () => {
  it.each([
    ["passkey", true],
    ["passkey_register", true],
    ["password", false],
    ["", false],
  ])("answers %j with %s", (kind, expected) => {
    expect(Flow.isPasskeyActionKind(kind)).toBe(expected);
  });
});
