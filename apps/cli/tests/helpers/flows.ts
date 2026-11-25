import { getDefaultLoginFlow } from "@zitadel/config/defaults";

import { Flow } from "@/lib/zitadel";
import type { EnabledMethods } from "@/lib/zitadel/resources/schemas/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, listAt, objectAt, toJsonObject } from "@/lib/zitadel/utils/json";
import { aFile } from "@tests/helpers/config";

/**
 * Where {@link aFlow} puts a flow unless told otherwise.
 */
export const FLOW_PATH = ".zitadel/flows/login.json";

/**
 * What the flow contract requires at the top of a flow, as {@link aFlowBody}
 * fills it in: a `login` flow on a schema no test defines, whose one step is
 * its login entry.
 */
const REQUIRED_FLOW_KEYS: JsonObject = {
  name: "login",
  user_schema: "unnamed-user",
  purposes: { login: "identifier" },
  steps: [{ name: "identifier" }],
};

/**
 * A flow document the flow contract takes: the body as given, with each
 * top-level key the contract requires and the body leaves out added after
 * the rest, so a test states only what it is about.
 *
 * @param body - The keys the test is about.
 * @returns The flow document; the body itself when it leaves nothing out.
 */
export function aFlowBody(body: JsonObject = {}): JsonObject {
  const missing = Object.entries(REQUIRED_FLOW_KEYS).filter((entry) => {
    return !(entry[0] in body);
  });
  return { ...body, ...Object.fromEntries(missing) };
}

/**
 * A flow read from `.zitadel/flows/login.json`, completed by
 * {@link aFlowBody}.
 *
 * @param body - What the file holds, besides what the contract requires.
 * @returns The flow, as read.
 */
export function aFlow(body: JsonObject): Flow {
  return Flow.of(aFile("flows", "login.json", aFlowBody(body)));
}

/**
 * The login flow `@zitadel/config` ships, as a JSON body.
 *
 * @param options - The use case and preset to ship it for.
 * @returns The flow.
 */
export function aShippedLoginFlow(options?: Parameters<typeof getDefaultLoginFlow>[0]): JsonObject {
  return toJsonObject(getDefaultLoginFlow(options), "the shipped login flow");
}

/**
 * The methods a schema enables when it enables both password and passkey.
 */
export const BOTH_METHODS: EnabledMethods = { password: true, passkey: true };

/**
 * The methods a password-only schema enables.
 */
export const PASSWORD_ONLY: EnabledMethods = { password: true, passkey: false };

/**
 * The methods a passkey-only schema enables.
 */
export const PASSKEY_ONLY: EnabledMethods = { password: false, passkey: true };

/**
 * The shipped password flow, cut to the steps the validator needs: an
 * identifier step, then a password step, then `done`.
 *
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The flow document.
 */
export function aPasswordFlow(overrides: JsonObject = {}): JsonObject {
  return {
    name: "default-login",
    user_schema: "https://schemas.test.invalid/default-human-user.json",
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "password" } },
      },
      {
        name: "password",
        fields: ["x-auth-methods#password"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
    ...overrides,
  };
}

/**
 * A flow whose login entry, `passkey-first`, offers a passkey and nothing else.
 *
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The flow document.
 */
export function aPasskeyFlow(overrides: JsonObject = {}): JsonObject {
  return aPasswordFlow({
    purposes: { login: "passkey-first" },
    steps: [
      {
        name: "passkey-first",
        fields: [],
        actions: [{ name: "passkey", kind: "passkey", primary: true }],
        transitions: { passkey: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
    ...overrides,
  });
}

/**
 * The passkey-first preset, cut to the steps and transitions the method rules
 * read: a passkey entry with an email fallback, a password step that also
 * offers a passkey, a register step and a conflict step that both lead back to
 * the login.
 *
 * @param overrides - Top-level keys to set in place of the defaults.
 * @returns The flow document.
 */
export function aPasskeyFirstFlow(overrides: JsonObject = {}): JsonObject {
  return {
    purposes: { login: "passkey-first", register: "register" },
    steps: [
      {
        name: "passkey-first",
        fields: [],
        actions: [
          { name: "passkey", kind: "passkey" },
          { name: "email_fallback", kind: "navigate" },
        ],
        transitions: { passkey: { target: "done" }, email_fallback: { target: "identifier" } },
      },
      {
        name: "identifier",
        fields: ["email"],
        actions: [
          { name: "submit", kind: "submit" },
          { name: "passkey", kind: "passkey" },
        ],
        transitions: { submit: { target: "password" }, passkey: { target: "done" } },
      },
      {
        name: "password",
        fields: ["x-auth-methods#password"],
        actions: [
          { name: "submit", kind: "submit" },
          { name: "passkey", kind: "passkey" },
        ],
        transitions: { submit: { target: "done" }, passkey: { target: "done" } },
      },
      {
        name: "register",
        fields: ["email"],
        actions: [{ name: "sign_in", kind: "navigate" }],
        transitions: { sign_in: { purpose: "login" } },
      },
      {
        name: "sso-conflict",
        fields: ["x-auth-methods#password"],
        actions: [{ name: "sign_in", kind: "navigate" }],
        transitions: { sign_in: { purpose: "login", target: "passkey-first" } },
      },
      { name: "done", complete: "show" },
    ],
    ...overrides,
  };
}

/**
 * The steps of a flow that are objects.
 *
 * @param flow - The flow document.
 * @returns Its steps, in order; none when `steps` is not a list.
 */
function stepList(flow: JsonObject): JsonObject[] {
  return listAt(flow, "steps").filter(isJsonObject);
}

/**
 * The flow with one step replaced by what `edit` makes of it; every other
 * step, and the flow given, are left as they are.
 *
 * @param flow - The flow document.
 * @param name - The step's name.
 * @param edit - What the step becomes, given the step as it stands.
 * @returns A new flow document.
 */
export function withStep(
  flow: JsonObject,
  name: string,
  edit: (step: JsonObject) => JsonObject,
): JsonObject {
  return {
    ...flow,
    steps: listAt(flow, "steps").map((step) => {
      if (!isJsonObject(step) || step.name !== name) {
        return step;
      }
      return edit(step);
    }),
  };
}

/**
 * The flow without one of its steps.
 *
 * @param flow - The flow document.
 * @param name - The step's name.
 * @returns A new flow document.
 */
export function withoutStep(flow: JsonObject, name: string): JsonObject {
  return {
    ...flow,
    steps: listAt(flow, "steps").filter((step) => {
      return !isJsonObject(step) || step.name !== name;
    }),
  };
}

/**
 * The names of a flow's steps, in order.
 *
 * @param flow - The flow document.
 * @returns Each step's name.
 */
export function stepNamesIn(flow: JsonObject): readonly unknown[] {
  return stepList(flow).map((step) => {
    return step.name;
  });
}

/**
 * Each step of a flow, by name.
 *
 * @param flow - The flow document.
 * @returns The steps, keyed by their names.
 */
export function stepsIn(flow: JsonObject): Readonly<Record<string, JsonObject>> {
  return Object.fromEntries(
    stepList(flow).map((step) => {
      return [String(step.name), step];
    }),
  );
}

/**
 * The names of each step's actions, by step.
 *
 * @param flow - The flow document.
 * @returns Each step's action names, in order, keyed by the step's name.
 */
export function actionsIn(flow: JsonObject): Readonly<Record<string, readonly unknown[]>> {
  return Object.fromEntries(
    stepList(flow).map((step) => {
      const names = listAt(step, "actions")
        .filter(isJsonObject)
        .map((action) => {
          return action.name;
        });
      return [String(step.name), names];
    }),
  );
}

/**
 * Each step's transitions as plain `outcome -> target step` pairs, by step.
 *
 * @param flow - The flow document.
 * @returns Each step's routes, keyed by the step's name; a transition that
 *   names no target maps to an empty string.
 */
export function routesIn(
  flow: JsonObject,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.fromEntries(
    stepList(flow).map((step) => {
      const routes = Object.entries(objectAt(step, "transitions")).map(([outcome, transition]) => {
        if (isJsonObject(transition) && typeof transition.target === "string") {
          return [outcome, transition.target];
        }
        return [outcome, ""];
      });
      return [String(step.name), Object.fromEntries(routes)];
    }),
  );
}
