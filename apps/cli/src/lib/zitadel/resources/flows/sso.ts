/**
 * The edits that enable a provider on a login flow: the steps and routes a
 * provider round trip needs. And the edits that take one away again.
 *
 * Every edit takes a document and returns a new one; the document it was given
 * is never changed. Each is idempotent: running it again on its own output
 * changes nothing. Only the regions below are ever written. Anything a
 * developer has edited by hand is left exactly as it stands and reported back,
 * because silently rewriting it would discard deliberate work.
 *
 * @remarks
 * The flow edit works on a private copy that it changes step by step, because
 * that is how it decides what is hand-edited; the copy never escapes before it
 * is finished.
 */

import { isDeepStrictEqual } from "node:util";

import { getDefaultLoginFlow, SETUP_PRESETS } from "@zitadel/config/defaults";
import type { ConnectionSlug } from "@zitadel/config/idp";

import { RefusedEditError } from "@/lib/zitadel/errors";
import type { Edit, SkippedRegion } from "@/lib/zitadel/resources/document";
import {
  type Draft,
  LEGACY_OUTCOMES,
  PASSWORD_STEP,
  REGISTER_PASSWORD_STEP,
  REGISTER_SSO_STEP,
  SSO_CONFLICT_STEP,
} from "@/lib/zitadel/resources/flows/types";
import type { EnabledMethods } from "@/lib/zitadel/resources/schemas/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, listAt, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/**
 * The edits that offer a provider on one login flow's body, and take it away
 * again, with the refusals that say when a body cannot be edited.
 *
 * @remarks
 * Only {@link Flow} uses it, for `withProvider`, `withoutProvider` and
 * `assertProviderEditable`; it is kept out of the class because it is as long
 * again as the class.
 */
export class SsoGenerator {
  /**
   * The flow's body, which no edit changes.
   */
  private readonly flow: JsonObject;

  /**
   * Hold the body of the flow to edit.
   *
   * @param flow - The flow's body.
   */
  constructor(flow: JsonObject) {
    this.flow = flow;
  }

  /**
   * Add the provider to a login flow.
   *
   * @param slug - The provider to offer.
   * @param enabled - The methods the target schema enables, which decide what
   *   the conflict step may offer.
   * @returns The edit: the flow offering the provider, or the flow it was given
   *   when it already does, and what was left alone.
   * @throws {@link RefusedEditError} When a step the edit writes has an action
   *   named like an outcome it writes there, or renaming a legacy outcome would
   *   drop a route the author wrote.
   */
  withProvider(slug: ConnectionSlug, enabled: EnabledMethods): Edit<JsonObject> {
    const flow = this.flow;
    const document: Draft = structuredClone({ ...flow });
    // Before any rewrite, so a refused flow is never half edited.
    SsoGenerator.refuseOutcomeActionCollision(document);
    const skipped: SkippedRegion[] = [];
    // `flowEditRefusal` has already refused a flow with no terminal to route to,
    // so the caller never reaches here without one.
    const terminal = SsoGenerator.terminalStep(document) ?? "done";
    // First, so a step the previous CLI wrote matches today's template below.
    SsoGenerator.migrateLegacyOutcomes(document);

    const login = SsoGenerator.loginEntry(document);
    const entries = SsoGenerator.providerSteps(document);

    for (const name of entries) {
      const step = SsoGenerator.stepNamed(document, name);
      if (step === undefined) {
        continue;
      }
      step.sso_providers = SsoGenerator.mergedProviders(step, slug);
      step.transitions = SsoGenerator.withProviderRoutes(objectAt(step, "transitions"), terminal);
    }

    // The password step is where someone lands who typed their email rather than
    // clicking a provider. A user who signed up with a provider has no password,
    // so a step with only a password field is a dead end for them. It offers the
    // providers too, unless it has been edited by hand. One edited by hand that
    // already carries the provider and its routes is what the warning would ask
    // for, so there is nothing left to say about it.
    const password = SsoGenerator.stepNamed(document, PASSWORD_STEP);
    if (
      password !== undefined &&
      !entries.includes(PASSWORD_STEP) &&
      !SsoGenerator.offersAlready(password, slug, terminal)
    ) {
      if (SsoGenerator.isShippedPasswordStep(password, terminal)) {
        // Every provider the entry steps carry, not only the one named: a project
        // enabled before the password step offered providers has several to catch up.
        const offered = entries.flatMap((name) => {
          return stringsIn(SsoGenerator.stepNamed(document, name)?.sso_providers);
        });
        const current = listAt(password, "sso_providers");
        const added = [...new Set([...offered, slug])].filter((provider) => {
          return !current.includes(provider);
        });
        password.sso_providers = [...current, ...added];
        password.transitions = SsoGenerator.withProviderRoutes(
          objectAt(password, "transitions"),
          terminal,
        );
      } else {
        skipped.push({
          step: PASSWORD_STEP,
          region: `steps.${PASSWORD_STEP}`,
          reason: "hand-edited",
        });
      }
    }

    // The password registration step shares the outcome, so it has to route to
    // the same place or a taken email dead-ends there.
    const registerPassword = SsoGenerator.stepNamed(document, REGISTER_PASSWORD_STEP);
    if (registerPassword !== undefined) {
      const transitions = objectAt(registerPassword, "transitions");
      const current = transitions.user_already_exists;
      if (!isJsonObject(current) || current.target !== SSO_CONFLICT_STEP) {
        registerPassword.transitions = {
          ...transitions,
          user_already_exists: { target: SSO_CONFLICT_STEP },
        };
      }
    }

    const list = SsoGenerator.stepsOf(document);
    // Each step with every form the generator may have written it in before. The
    // conflict step follows the methods enabled, so one written when passkey was
    // off is still the generator's own output once passkey is on.
    const wanted = [
      {
        name: REGISTER_SSO_STEP,
        step: SsoGenerator.registerSsoStep(SsoGenerator.registrationFields(document), terminal),
        earlier: [],
      },
      {
        name: SSO_CONFLICT_STEP,
        step: SsoGenerator.ssoConflictStep(slug, enabled, login, terminal),
        earlier: [true, false].flatMap((usesPassword) => {
          return [true, false].map((usesPasskey) => {
            return SsoGenerator.ssoConflictStep(
              slug,
              { password: usesPassword, passkey: usesPasskey },
              login,
              terminal,
            );
          });
        }),
      },
    ];
    for (const { name, step, earlier } of wanted) {
      const existing = SsoGenerator.stepNamed(document, name);
      if (existing === undefined) {
        // Before the terminal step, after any step already added here.
        const terminalIndex = list.findIndex((candidate) => {
          return candidate.name === terminal;
        });
        list.splice(terminalIndex === -1 ? list.length : terminalIndex, 0, step);
        continue;
      }
      // The conflict step carries a provider list of its own, so a second
      // provider is added to it rather than replacing the first. `register-sso`
      // declares none, so it is compared as written.
      const merged =
        step.sso_providers === undefined ? undefined : SsoGenerator.mergedProviders(existing, slug);
      const expected = merged === undefined ? step : { ...step, sso_providers: merged };
      // Compared as if the list were already merged, but without merging it: the
      // list is the generator's to extend, the rest of the step is not.
      const candidate = merged === undefined ? existing : { ...existing, sso_providers: merged };
      if (SsoGenerator.matches(candidate, expected)) {
        if (merged !== undefined) {
          existing.sso_providers = merged;
        }
      } else if (
        merged !== undefined &&
        earlier.some((form) => {
          return SsoGenerator.matches(candidate, { ...form, sso_providers: merged });
        })
      ) {
        // What the generator wrote for other methods: bring it up to today's, in
        // the place it already has, keeping the providers it lists.
        list[list.indexOf(existing)] = expected;
      } else {
        skipped.push({ step: name, region: `steps.${name}`, reason: "hand-edited" });
      }
    }
    document.steps = list;

    if (isDeepStrictEqual(document, flow)) {
      return { document: flow, changed: false, skipped };
    }
    return { document, changed: true, skipped };
  }

  /**
   * Remove a provider from every step of a login flow that offers it.
   *
   * @remarks
   * Only the `sso_providers` lists change; a list left empty is dropped. The
   * routes and steps enabling added stay: they validate as they are, and
   * enabling a provider again uses them as they stand.
   *
   * @param slug - The provider to remove.
   * @returns The edit: the flow without the provider, or the flow it was given
   *   when no step offers it.
   */
  withoutProvider(slug: string): Edit<JsonObject> {
    const flow = this.flow;
    const offered = SsoGenerator.stepsOf(flow).some((step) => {
      return listAt(step, "sso_providers").includes(slug);
    });
    if (!offered) {
      return { document: flow, changed: false, skipped: [] };
    }
    const document = structuredClone({
      ...flow,
      steps: listAt(flow, "steps").map((step) => {
        if (!isJsonObject(step) || !listAt(step, "sso_providers").includes(slug)) {
          return step;
        }
        const providers = listAt(step, "sso_providers").filter((provider) => {
          return provider !== slug;
        });
        const { sso_providers: _removed, ...rest } = step;
        if (providers.length === 0) {
          return rest;
        }
        return { ...step, sso_providers: providers };
      }),
    });
    return { document, changed: true, skipped: [] };
  }

  /**
   * Why a flow cannot be edited to offer a provider, or `undefined` when it can.
   *
   * @remarks
   * The edits read a missing region as empty and write the generated one in its
   * place. That is right for a document that has simply not got there yet, and
   * wrong for one whose region holds something else: that value was put there by
   * hand.
   *
   * @returns The reason, or `undefined`.
   */
  get editRefusal(): string | undefined {
    const flow = this.flow;
    const providers = this.providersRefusal;
    if (providers !== undefined) {
      return providers;
    }
    if (SsoGenerator.terminalStep(flow) === undefined) {
      return "no step marks where a completed sign-in ends";
    }
    return undefined;
  }

  /**
   * Why a flow's steps cannot be read for their provider lists, or `undefined`
   * when they can.
   *
   * @remarks
   * This is all removing a provider needs: unlike enabling, it writes no route,
   * so it does not care where a completed sign-in ends.
   *
   * @returns The reason, or `undefined`.
   */
  get providersRefusal(): string | undefined {
    const flow = this.flow;
    if (flow.steps !== undefined && !Array.isArray(flow.steps)) {
      return "steps is not a list";
    }
    for (const [index, step] of listAt(flow, "steps").entries()) {
      if (!isJsonObject(step)) {
        return `steps[${index}] is not a step`;
      }
      const name = typeof step.name === "string" ? step.name : String(index);
      if (step.transitions !== undefined && !isJsonObject(step.transitions)) {
        return `steps.${name}.transitions is not an object`;
      }
      // Owned like transitions are: a non-list would be read as empty and the
      // generated list written over it, losing the provider it named.
      if (step.sso_providers !== undefined && !Array.isArray(step.sso_providers)) {
        return `steps.${name}.sso_providers is not a list`;
      }
    }
    return undefined;
  }

  /**
   * The steps of a flow that are objects.
   *
   * @param flow - The flow.
   * @returns Its steps, as the very objects the flow holds.
   */
  private static stepsOf(flow: JsonObject): Draft[] {
    return listAt(flow, "steps").filter(isJsonObject);
  }

  /**
   * The step with this name.
   *
   * @param flow - The flow.
   * @param name - The step's name.
   * @returns The step, or `undefined`.
   */
  private static stepNamed(flow: JsonObject, name: string): Draft | undefined {
    return SsoGenerator.stepsOf(flow).find((step) => {
      return step.name === name;
    });
  }

  /**
   * The steps a flow starts at, by purpose, plus the steps that collect an
   * identifier.
   *
   * @remarks
   * The provider button belongs on all of them: a developer landing on the first
   * screen expects it there, and someone who has already gone to the email
   * screen should not have to go back for it.
   *
   * On the shipped password-first flow the login entry *is* `identifier`, so
   * this is exactly `identifier` and `register`, which is what the design's
   * reference flow shows. On passkey-first it also picks up the passkey entry
   * screen.
   *
   * @param flow - The flow.
   * @returns The names of the steps that offer providers.
   */
  private static providerSteps(flow: JsonObject): string[] {
    const purposes = objectAt(flow, "purposes");
    const names = [purposes.login, purposes.register, "identifier", "register"];
    return names.filter((name, index): name is string => {
      if (typeof name !== "string" || SsoGenerator.stepNamed(flow, name) === undefined) {
        return false;
      }
      return names.indexOf(name) === index;
    });
  }

  /**
   * The step a flow starts its login purpose at, which a transition that
   * re-purposes to `login` must target.
   *
   * @remarks
   * The engine rejects a `purpose: "login"` transition pointing anywhere else, so
   * this cannot be hardcoded: `identifier` is only the password-first flow's
   * entry, and a passkey-first flow starts at its passkey screen. A flow that
   * does not serve the login purpose has nowhere to send someone who wants to
   * sign in instead, so it gets no such step.
   *
   * @param flow - The flow.
   * @returns The step's name, or `undefined`.
   */
  private static loginEntry(flow: JsonObject): string | undefined {
    const purposes = objectAt(flow, "purposes");
    const named = purposes.login;
    if (typeof named === "string" && SsoGenerator.stepNamed(flow, named) !== undefined) {
      return named;
    }
    if (SsoGenerator.stepNamed(flow, "identifier") !== undefined && purposes.login !== undefined) {
      return "identifier";
    }
    return undefined;
  }

  /**
   * The outcomes the engine fires after a provider returns, and where they go.
   *
   * @param terminal - The step a completed sign-in ends at.
   * @returns Each outcome and its target.
   */
  private static providerOutcomes(terminal: string): Readonly<Record<string, string>> {
    return {
      sso_authenticated: terminal,
      sso_user_not_found: REGISTER_SSO_STEP,
      user_already_exists: SSO_CONFLICT_STEP,
    };
  }

  /**
   * The step a completed sign-in ends at.
   *
   * @remarks
   * Derived, not assumed to be called `done`: what marks a terminal is the
   * `complete` property, and a flow whose terminal is called something else was
   * valid before this edit. Writing `done` into the generated routes would point
   * them at a step that does not exist.
   *
   * @param flow - The flow.
   * @returns The terminal's name, or `undefined` when there is no single one.
   */
  private static terminalStep(flow: JsonObject): string | undefined {
    const complete = SsoGenerator.stepsOf(flow).flatMap((step) => {
      if (step.complete !== undefined && typeof step.name === "string") {
        return [step.name];
      }
      return [];
    });
    if (complete.length === 1) {
      return complete[0];
    }
    if (SsoGenerator.stepNamed(flow, "done") === undefined) {
      return undefined;
    }
    return "done";
  }

  /**
   * A step's transitions with the routes a provider return needs.
   *
   * @remarks
   * A route that already goes where it should is kept as it is.
   *
   * @param transitions - The step's transitions.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The transitions with the provider routes.
   */
  private static withProviderRoutes(transitions: JsonObject, terminal: string): Draft {
    const routed: Draft = { ...transitions };
    for (const [outcome, target] of Object.entries(SsoGenerator.providerOutcomes(terminal))) {
      const current = routed[outcome];
      if (!isJsonObject(current) || current.target !== target) {
        routed[outcome] = { target };
      }
    }
    return routed;
  }

  /**
   * The properties this project collects when someone registers.
   *
   * @remarks
   * Read from the register purpose's own entry step rather than from the schema:
   * that step is where the project decided what to ask for. Credential fields are
   * dropped, because the provider is the proof for an account it creates. Falls
   * back to the identifier-collecting step, and then to nothing.
   *
   * @param flow - The flow.
   * @returns The fields to ask a provider's new user for.
   */
  private static registrationFields(flow: JsonObject): string[] {
    const purposes = objectAt(flow, "purposes");
    const named = typeof purposes.register === "string" ? purposes.register : "register";
    for (const name of [named, "register", "identifier"]) {
      const collected = stringsIn(SsoGenerator.stepNamed(flow, name)?.fields).filter((field) => {
        return !field.startsWith("x-auth-methods#");
      });
      if (collected.length > 0) {
        return collected;
      }
    }
    return [];
  }

  /**
   * The step that collects what the provider did not supply.
   *
   * @remarks
   * It asks for everything registration asks for, because a provider is not
   * obliged to supply any of it.
   *
   * @param fields - What registration asks for.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The step.
   */
  private static registerSsoStep(fields: readonly string[], terminal: string): Draft {
    return {
      name: REGISTER_SSO_STEP,
      fields: [...fields],
      actions: [
        {
          name: "submit",
          kind: "submit",
          primary: true,
          text_key: `${REGISTER_SSO_STEP}.action.submit`,
        },
      ],
      on_success: "create_user_with_sso",
      transitions: {
        submit: { target: terminal },
        user_already_exists: { target: SSO_CONFLICT_STEP },
      },
    };
  }

  /**
   * The step shown when the provider's email already has an account.
   *
   * @remarks
   * It offers only the methods the schema enables: a password box on a schema
   * without passwords is a dead end.
   *
   * @param slug - The provider.
   * @param methods - The methods the schema enables.
   * @param loginStep - Where signing in instead goes, if anywhere.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The step.
   */
  private static ssoConflictStep(
    slug: ConnectionSlug,
    methods: EnabledMethods,
    loginStep: string | undefined,
    terminal: string,
  ): Draft {
    const submit = {
      name: "submit",
      kind: "submit",
      primary: true,
      text_key: `${SSO_CONFLICT_STEP}.action.submit`,
    };
    const passkey = {
      name: "passkey",
      kind: "passkey",
      primary: false,
      text_key: `${SSO_CONFLICT_STEP}.action.passkey`,
    };
    const signIn = {
      name: "sign_in",
      kind: "navigate",
      primary: false,
      text_key: `${SSO_CONFLICT_STEP}.action.sign_in`,
    };
    const submitActions = methods.password ? [submit] : [];
    const passkeyActions = methods.passkey ? [passkey] : [];
    const signInActions = loginStep === undefined ? [] : [signIn];
    const submitRoutes = methods.password ? { submit: { target: terminal } } : {};
    const passkeyRoutes = methods.passkey ? { passkey: { target: terminal } } : {};
    const signInRoutes =
      loginStep === undefined ? {} : { sign_in: { target: loginStep, purpose: "login" } };
    const fields = methods.password ? ["x-auth-methods#password"] : [];
    return {
      name: SSO_CONFLICT_STEP,
      fields,
      actions: [...submitActions, ...passkeyActions, ...signInActions],
      sso_providers: [slug],
      transitions: {
        ...submitRoutes,
        ...passkeyRoutes,
        sso_authenticated: { target: terminal },
        user_already_exists: { target: SSO_CONFLICT_STEP },
        ...signInRoutes,
        sso_user_not_found: { target: REGISTER_SSO_STEP },
      },
    };
  }

  /**
   * Whether a step is still what the generator would write for it, ignoring key
   * order and what the platform leaves out when it answers.
   *
   * @param step - The step in the file.
   * @param expected - The step the generator would write.
   * @returns Whether they are the same step.
   */
  private static matches(step: JsonObject, expected: JsonObject): boolean {
    return isDeepStrictEqual(
      SsoGenerator.withoutServerDefaults(step),
      SsoGenerator.withoutServerDefaults(expected),
    );
  }

  /**
   * A step without what the platform leaves out when it answers: an action's
   * `primary: false`, an empty `fields` list and an empty `gates` map.
   *
   * @remarks
   * A step the platform answered with is not what the generator wrote, though it
   * is the same step.
   *
   * @param step - The step.
   * @returns The step without those defaults.
   */
  private static withoutServerDefaults(step: JsonObject): JsonObject {
    const kept = Object.entries(step).filter((pair) => {
      const [key, value] = pair;
      if (key !== "fields" && key !== "gates") {
        return true;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return !(isJsonObject(value) && Object.keys(value).length === 0);
    });
    const reduced: Draft = Object.fromEntries(kept);
    if (Array.isArray(reduced.actions)) {
      reduced.actions = reduced.actions.map((action: unknown) => {
        if (!isJsonObject(action) || action.primary !== false) {
          return action;
        }
        const { primary: _default, ...rest } = action;
        return rest;
      });
    }
    return reduced;
  }

  /**
   * Whether a password step is the one `setup` wrote, however many providers it
   * offers.
   *
   * @remarks
   * It is when it reduces to one of the shipped password steps once its provider
   * list and generated routes are taken away.
   *
   * @param step - The password step.
   * @param terminal - The step a completed sign-in ends at.
   * @returns Whether it is a shipped password step.
   */
  private static isShippedPasswordStep(step: JsonObject, terminal: string): boolean {
    const reduced = SsoGenerator.withoutSsoRoutes(step, terminal);
    return SETUP_PRESETS.some((preset) => {
      const shipped: unknown = getDefaultLoginFlow({ preset });
      if (!isJsonObject(shipped)) {
        return false;
      }
      const shippedStep = SsoGenerator.stepNamed(shipped, PASSWORD_STEP);
      if (shippedStep === undefined) {
        return false;
      }
      return isDeepStrictEqual(SsoGenerator.withoutSsoRoutes(shippedStep, "done"), reduced);
    });
  }

  /**
   * A password step without what offering providers adds to it: the provider
   * list, and the routes the generator writes for a provider return.
   *
   * @remarks
   * A route that goes somewhere else is the developer's and stays.
   *
   * @param step - The password step.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The step without the provider additions.
   */
  private static withoutSsoRoutes(step: JsonObject, terminal: string): JsonObject {
    const { sso_providers: _providers, ...rest } = SsoGenerator.withoutServerDefaults(step);
    if (!isJsonObject(rest.transitions)) {
      return rest;
    }
    const written = SsoGenerator.providerOutcomes(terminal);
    const transitions = Object.fromEntries(
      Object.entries(rest.transitions).filter((pair) => {
        const [outcome, route] = pair;
        const generated =
          outcome in written &&
          isJsonObject(route) &&
          route.target === written[outcome] &&
          Object.keys(route).length === 1;
        return !generated;
      }),
    );
    return { ...rest, transitions };
  }

  /**
   * Whether a password step already lists the provider and carries the routes the
   * generator writes, whatever else it has been edited to say.
   *
   * @param step - The password step.
   * @param slug - The provider.
   * @param terminal - The step a completed sign-in ends at.
   * @returns Whether it offers the provider already.
   */
  private static offersAlready(step: JsonObject, slug: string, terminal: string): boolean {
    if (!listAt(step, "sso_providers").includes(slug)) {
      return false;
    }
    const transitions = objectAt(step, "transitions");
    return Object.entries(SsoGenerator.providerOutcomes(terminal)).every((pair) => {
      const [outcome, target] = pair;
      const route = transitions[outcome];
      return isJsonObject(route) && route.target === target;
    });
  }

  /**
   * The provider list a step should end up with: what it has, plus this slug.
   *
   * @param step - The step.
   * @param slug - The provider.
   * @returns The merged list, a new one either way.
   */
  private static mergedProviders(step: JsonObject, slug: ConnectionSlug): unknown[] {
    const providers = listAt(step, "sso_providers");
    if (providers.includes(slug)) {
      return [...providers];
    }
    return [...providers, slug];
  }

  /**
   * Rename the previous outcome keys on every step of a flow being built.
   *
   * @remarks
   * The validator rejects the old keys. Where a step already has the new key,
   * that one wins; a key that is also one of the step's action names stays.
   *
   * @param document - The flow, changed in place.
   * @throws {@link RefusedEditError} When a rename would drop a route the author
   *   wrote: the new key is an action, or the old one declares purpose or action.
   */
  private static migrateLegacyOutcomes(document: Draft): void {
    for (const step of SsoGenerator.stepsOf(document)) {
      if (!isJsonObject(step.transitions)) {
        continue;
      }
      const transitions = step.transitions;
      const actionNames = new Set(
        listAt(step, "actions").map((action) => {
          return isJsonObject(action) ? action.name : undefined;
        }),
      );
      for (const [old, next] of LEGACY_OUTCOMES) {
        if (!(old in transitions) || actionNames.has(old)) {
          continue;
        }
        if (actionNames.has(next)) {
          throw new RefusedEditError(
            `steps.${String(step.name)}: transition "${old}" is renamed to "${next}", which is an action on this step`,
            {
              hint: `Rename the action "${next}" on step "${String(step.name)}" (and its transition), then run auth-method sso enable again.`,
              details: { step: step.name, action: next },
            },
          );
        }
        if (!(next in transitions)) {
          const transition = transitions[old];
          if (
            isJsonObject(transition) &&
            ((transition.purpose ?? null) !== null || (transition.action ?? null) !== null)
          ) {
            throw new RefusedEditError(
              `steps.${String(step.name)}: transition "${old}" declares purpose or action, which "${next}" cannot`,
              {
                hint: `Remove purpose and action from the transition "${old}" on step "${String(step.name)}", then run auth-method sso enable again.`,
                details: { step: step.name, transition: old },
              },
            );
          }
          transitions[next] = transition;
        }
        delete transitions[old];
      }
    }
  }

  /**
   * Refuse a flow where a step the edit writes declares an action named like an
   * outcome key the edit writes on that step.
   *
   * @remarks
   * The generated route would silently replace the action's.
   *
   * @param document - The flow.
   * @throws {@link RefusedEditError} When such an action exists.
   */
  private static refuseOutcomeActionCollision(document: JsonObject): void {
    const outcomes = ["sso_authenticated", "sso_user_not_found", "user_already_exists"];
    const entries = [
      ...SsoGenerator.providerSteps(document).map((name) => {
        return { name, keys: outcomes };
      }),
      { name: SSO_CONFLICT_STEP, keys: outcomes },
      { name: REGISTER_SSO_STEP, keys: ["user_already_exists"] },
      { name: REGISTER_PASSWORD_STEP, keys: ["user_already_exists"] },
    ];
    // A step can be listed twice (a provider step named `register-password`), so
    // its keys are the union of every entry, never just the last one.
    const names = new Set(
      entries.map((item) => {
        const { name } = item;
        return name;
      }),
    );
    const written = [...names].map((name): readonly [string, ReadonlySet<string>] => {
      const keys = entries.flatMap((entry) => {
        if (entry.name !== name) {
          return [];
        }
        return entry.keys;
      });
      return [name, new Set(keys)];
    });
    for (const [name, keys] of written) {
      for (const action of listAt(SsoGenerator.stepNamed(document, name) ?? {}, "actions")) {
        if (isJsonObject(action) && typeof action.name === "string" && keys.has(action.name)) {
          throw new RefusedEditError(
            `steps.${name}: action "${action.name}" uses a name auth-method sso enable writes as an outcome on this step`,
            {
              hint: `Rename the action "${action.name}" on step "${name}" (and its transition), then run auth-method sso enable again.`,
              details: { step: name, action: action.name },
            },
          );
        }
      }
    }
  }
}
