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
 * Each stage of the flow edit is a pure transform over the flow's steps: a
 * step is replaced with `map`, a generated step inserted with a slice and a
 * spread, and a step's transitions rebuilt from their entries.
 */

import { isDeepStrictEqual } from "node:util";

import { getDefaultLoginFlow, SETUP_PRESETS } from "@zitadel/config/defaults";
import type { ConnectionSlug } from "@zitadel/config/idp";

import { RefusedEditError } from "@/lib/zitadel/errors";
import { type StepName, stepName } from "@/lib/zitadel/names";
import type { Edit, SkippedRegion } from "@/lib/zitadel/resources/document";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import {
  COLLISION_OUTCOME,
  type FlowValue,
  LEGACY_OUTCOMES,
  PASSWORD_STEP,
  PROVIDER_OUTCOMES,
  type ProviderOutcome,
  REGISTER_PASSWORD_STEP,
  REGISTER_SSO_STEP,
  SSO_CONFLICT_STEP,
} from "@/lib/zitadel/resources/flows/types";
import type { EnabledMethods } from "@/lib/zitadel/resources/schemas/types";
import type { JsonArray, JsonObject, JsonValue } from "@/lib/zitadel/types";
import {
  isJsonArray,
  isJsonObject,
  isJsonValue,
  listAt,
  objectAt,
  stringsIn,
  withoutKey,
} from "@/lib/zitadel/utils/json";

/**
 * The step a completed sign-in ends at when no step says so itself.
 */
const DONE_STEP: StepName = stepName("done");

/**
 * Where each provider outcome goes.
 */
type ProviderRoutes = { readonly [O in ProviderOutcome]: StepName };

/**
 * A step the edit adds, and the forms the generator wrote it in before.
 */
type GeneratedStep = {
  readonly name: StepName;
  readonly step: JsonObject;
  readonly earlier: readonly JsonObject[];
};

/**
 * The steps an edit stage left, and the regions it left alone.
 */
type Staged = {
  readonly steps: readonly JsonObject[];
  readonly skipped: readonly SkippedRegion[];
};

/**
 * The edits that offer a provider on one login flow's body, and take it away
 * again, with the refusal that says when a flow cannot be edited.
 *
 * @remarks
 * Only {@link Flow} uses it, for `withProvider`, `withoutProvider` and
 * `assertProviderEditable`; it is kept out of the class because it is as long
 * again as the class. An edit rewrites the body as written, so it keeps every
 * key the contract does not know and the order the author wrote; whatever is
 * only read is read from the flow's typed value.
 */
export class SsoGenerator {
  /**
   * The flow's body as written, which an edit rewrites into a new one and
   * never changes.
   */
  private readonly body: JsonObject;

  /**
   * The flow as its contract took it, which every question that only reads is
   * asked of.
   */
  private readonly value: FlowValue;

  /**
   * Hold the flow to edit.
   *
   * @param flow - The flow.
   */
  constructor(flow: Flow) {
    this.body = flow.body;
    this.value = flow.value;
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
    const flow = this.body;
    // Before any rewrite, so a refused flow is never half edited.
    SsoGenerator.refuseOutcomeActionCollision(this.value);
    // `editRefusal` has already refused a flow with no terminal to route to,
    // so the caller never reaches here without one.
    const terminal = SsoGenerator.terminalStep(this.value) ?? DONE_STEP;
    // First, so a step the previous CLI wrote matches today's template below.
    const migrated = SsoGenerator.migrateLegacyOutcomes(SsoGenerator.stepsOf(flow));
    const login = SsoGenerator.loginEntry(this.value);
    const entries = SsoGenerator.providerSteps(this.value);

    const offered = entries.reduce(
      (staged: Staged, name) => {
        const routed = SsoGenerator.withProviderRoutes(
          objectAt(SsoGenerator.stepNamed(staged.steps, name) ?? {}, "transitions"),
          terminal,
        );
        const steps = SsoGenerator.replaceStep(staged.steps, name, (step) => {
          return {
            ...step,
            sso_providers: SsoGenerator.mergedProviders(step, slug),
            transitions: routed.transitions,
          };
        });
        if (routed.kept.length === 0) {
          return { steps, skipped: staged.skipped };
        }
        const kept: SkippedRegion = {
          step: name,
          region: `steps.${name}`,
          reason: "routes-kept",
          routes: routed.kept,
        };
        return { steps, skipped: [...staged.skipped, kept] };
      },
      { steps: migrated, skipped: [] },
    );
    const password = SsoGenerator.offerOnPasswordStep(offered.steps, entries, slug, terminal);
    const rerouted = SsoGenerator.routeRegisterPassword(password.steps);
    const fields = SsoGenerator.registrationFields(this.value);
    const wanted = SsoGenerator.generatedSteps(fields, slug, enabled, login, terminal);
    const placed = wanted.reduce(
      (staged: Staged, generated) => {
        return SsoGenerator.placeGeneratedStep(staged, generated, slug, terminal);
      },
      { steps: rerouted, skipped: [...offered.skipped, ...password.skipped] },
    );
    const document: JsonObject = { ...flow, steps: placed.steps };

    if (isDeepStrictEqual(document, flow)) {
      return { document: flow, changed: false, skipped: placed.skipped };
    }
    return { document, changed: true, skipped: placed.skipped };
  }

  /**
   * Remove a provider from every step of a login flow that offers it.
   *
   * @remarks
   * Only the `sso_providers` lists change; a list left empty is dropped. The
   * routes and steps enabling added stay: they validate as they are, and
   * enabling a provider again uses them as they stand.
   *
   * @param slug - The provider to remove, as the steps list it.
   * @returns The edit: the flow without the provider, or the flow it was given
   *   when no step offers it.
   */
  withoutProvider(slug: string): Edit<JsonObject> {
    const flow = this.body;
    const offered = this.value.steps.some((step) => {
      return step.sso_providers.includes(slug);
    });
    if (!offered) {
      return { document: flow, changed: false, skipped: [] };
    }
    const steps = listAt(flow, "steps").map((step) => {
      if (!isJsonObject(step) || !listAt(step, "sso_providers").includes(slug)) {
        return step;
      }
      const providers = listAt(step, "sso_providers").filter((provider) => {
        return provider !== slug;
      });
      if (providers.length === 0) {
        return withoutKey(step, "sso_providers");
      }
      return { ...step, sso_providers: providers };
    });
    return { document: { ...flow, steps }, changed: true, skipped: [] };
  }

  /**
   * Why a flow cannot be edited to offer a provider.
   *
   * @remarks
   * The generated routes send a completed sign-in to the flow's terminal step,
   * so a flow without one has nowhere to send it. Every other region the edit
   * writes is the shape it writes, because the contract took the flow.
   *
   * @returns The reason, or `undefined` when it can be.
   */
  get editRefusal(): string | undefined {
    if (SsoGenerator.terminalStep(this.value) === undefined) {
      return "no step marks where a completed sign-in ends";
    }
    return undefined;
  }

  /**
   * The steps of a flow that are objects.
   *
   * @param flow - The flow.
   * @returns Its steps, as the very objects the flow holds.
   */
  private static stepsOf(flow: JsonObject): readonly JsonObject[] {
    return listAt(flow, "steps").filter(isJsonObject);
  }

  /**
   * The step with this name.
   *
   * @typeParam Found - A step as written, or as the contract took it.
   * @param steps - The flow's steps.
   * @param name - The step's name.
   * @returns The first step by that name, or `undefined`.
   */
  private static stepNamed<Found extends { readonly name?: unknown }>(
    steps: readonly Found[],
    name: string,
  ): Found | undefined {
    return steps.find((step) => {
      return step.name === name;
    });
  }

  /**
   * The steps with the first one by a name replaced.
   *
   * @param steps - The flow's steps.
   * @param name - The step's name.
   * @param update - What the step becomes.
   * @returns New steps; the same ones when no step has the name.
   */
  private static replaceStep(
    steps: readonly JsonObject[],
    name: string,
    update: (step: JsonObject) => JsonObject,
  ): readonly JsonObject[] {
    const index = steps.findIndex((step) => {
      return step.name === name;
    });
    return steps.map((step, position) => {
      if (position !== index) {
        return step;
      }
      return update(step);
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
   * @returns The names of the steps that offer providers, each once.
   */
  private static providerSteps(flow: FlowValue): readonly StepName[] {
    const names = [flow.purposes.login, flow.purposes.register, "identifier", "register"];
    return names.flatMap((name, index): readonly StepName[] => {
      if (name === undefined || SsoGenerator.stepNamed(flow.steps, name) === undefined) {
        return [];
      }
      if (names.indexOf(name) !== index) {
        return [];
      }
      return [stepName(name)];
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
  private static loginEntry(flow: FlowValue): StepName | undefined {
    const named = flow.purposes.login;
    if (named === undefined) {
      return undefined;
    }
    if (SsoGenerator.stepNamed(flow.steps, named) !== undefined) {
      return stepName(named);
    }
    if (SsoGenerator.stepNamed(flow.steps, "identifier") !== undefined) {
      return stepName("identifier");
    }
    return undefined;
  }

  /**
   * The outcomes the engine fires after a provider returns, and where they go.
   *
   * @param terminal - The step a completed sign-in ends at.
   * @returns Each outcome and its target.
   */
  private static providerRoutes(terminal: StepName): ProviderRoutes {
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
  private static terminalStep(flow: FlowValue): StepName | undefined {
    const complete = flow.steps.filter((step) => {
      return step.complete !== undefined;
    });
    const only = complete[0];
    if (complete.length === 1 && only !== undefined) {
      return stepName(only.name);
    }
    if (SsoGenerator.stepNamed(flow.steps, DONE_STEP) === undefined) {
      return undefined;
    }
    return DONE_STEP;
  }

  /**
   * A step's transitions with the routes a provider return needs.
   *
   * @remarks
   * A route that already goes where it should is kept as it is, and a missing
   * one is added at the end. The collision outcome is the generator's: one that
   * goes anywhere else is replaced in place. Any other outcome that already goes
   * somewhere else is the developer's, such as a sign-in routed through an extra
   * step, so it stays and is named among the routes kept.
   *
   * @param transitions - The step's transitions.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The transitions with the provider routes, and the outcomes whose
   *   routes the developer wrote were kept.
   */
  private static withProviderRoutes(
    transitions: JsonObject,
    terminal: StepName,
  ): { readonly transitions: JsonObject; readonly kept: readonly string[] } {
    const routes = SsoGenerator.providerRoutes(terminal);
    const kept: string[] = [];
    const added = PROVIDER_OUTCOMES.flatMap(
      (outcome): readonly (readonly [string, JsonObject])[] => {
        const target = routes[outcome];
        const current = transitions[outcome];
        if (isJsonObject(current) && current.target === target) {
          return [];
        }
        if (current !== undefined && outcome !== COLLISION_OUTCOME) {
          kept.push(outcome);
          return [];
        }
        return [[outcome, { target }]];
      },
    );
    return {
      transitions: { ...transitions, ...Object.fromEntries(added) },
      kept,
    };
  }

  /**
   * A step named as left alone because it was edited by hand.
   *
   * @param name - The step.
   * @returns The skipped region.
   */
  private static handEdited(name: StepName): SkippedRegion {
    return { step: name, region: `steps.${name}`, reason: "hand-edited" };
  }

  /**
   * Offer the providers on the password step too.
   *
   * @remarks
   * The password step is where someone lands who typed their email rather than
   * clicking a provider. A user who signed up with a provider has no password,
   * so a step with only a password field is a dead end for them. It offers the
   * providers too, unless it has been edited by hand. One edited by hand that
   * already carries the provider and its routes is what the warning would ask
   * for, so there is nothing left to say about it.
   *
   * @param steps - The flow's steps, the entry steps already offering the provider.
   * @param entries - The entry steps.
   * @param slug - The provider.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The steps, and the password step when it was left alone.
   */
  private static offerOnPasswordStep(
    steps: readonly JsonObject[],
    entries: readonly StepName[],
    slug: ConnectionSlug,
    terminal: StepName,
  ): Staged {
    const password = SsoGenerator.stepNamed(steps, PASSWORD_STEP);
    if (password === undefined || entries.includes(PASSWORD_STEP)) {
      return { steps, skipped: [] };
    }
    if (SsoGenerator.offersAlready(password, slug, terminal)) {
      return { steps, skipped: [] };
    }
    if (!SsoGenerator.isShippedPasswordStep(password, terminal)) {
      return { steps, skipped: [SsoGenerator.handEdited(PASSWORD_STEP)] };
    }
    // Every provider the entry steps carry, not only the one named: a project
    // enabled before the password step offered providers has several to catch up.
    const offered = entries.flatMap((name) => {
      return stringsIn(SsoGenerator.stepNamed(steps, name)?.sso_providers);
    });
    const current = listAt(password, "sso_providers");
    const added = [...new Set([...offered, slug])].filter((provider) => {
      return !current.includes(provider);
    });
    const edited = SsoGenerator.replaceStep(steps, PASSWORD_STEP, (step) => {
      return {
        ...step,
        sso_providers: [...current, ...added],
        transitions: SsoGenerator.withProviderRoutes(objectAt(step, "transitions"), terminal)
          .transitions,
      };
    });
    return { steps: edited, skipped: [] };
  }

  /**
   * Route the password registration step's taken email to the conflict step.
   *
   * @remarks
   * It shares the outcome, so it has to route to the same place or a taken
   * email dead-ends there.
   *
   * @param steps - The flow's steps.
   * @returns The steps, the registration step routed.
   */
  private static routeRegisterPassword(steps: readonly JsonObject[]): readonly JsonObject[] {
    return SsoGenerator.replaceStep(steps, REGISTER_PASSWORD_STEP, (step) => {
      const transitions = objectAt(step, "transitions");
      const current = transitions[COLLISION_OUTCOME];
      if (isJsonObject(current) && current.target === SSO_CONFLICT_STEP) {
        return step;
      }
      return {
        ...step,
        transitions: { ...transitions, [COLLISION_OUTCOME]: { target: SSO_CONFLICT_STEP } },
      };
    });
  }

  /**
   * The steps the edit adds, each with every form the generator may have
   * written it in before.
   *
   * @remarks
   * The conflict step follows the methods enabled, so one written when passkey
   * was off is still the generator's own output once passkey is on.
   *
   * @param fields - What registration asks for, which `register-sso` asks for too.
   * @param slug - The provider.
   * @param enabled - The methods the schema enables.
   * @param login - Where signing in instead goes, if anywhere.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The generated steps, in the order they are placed.
   */
  private static generatedSteps(
    fields: readonly string[],
    slug: ConnectionSlug,
    enabled: EnabledMethods,
    login: StepName | undefined,
    terminal: StepName,
  ): readonly GeneratedStep[] {
    const earlierConflicts = [true, false].flatMap((usesPassword) => {
      return [true, false].map((usesPasskey) => {
        const methods: EnabledMethods = { password: usesPassword, passkey: usesPasskey };
        return SsoGenerator.ssoConflictStep(slug, methods, login, terminal);
      });
    });
    return [
      {
        name: REGISTER_SSO_STEP,
        step: SsoGenerator.registerSsoStep(fields, terminal),
        earlier: [],
      },
      {
        name: SSO_CONFLICT_STEP,
        step: SsoGenerator.ssoConflictStep(slug, enabled, login, terminal),
        earlier: earlierConflicts,
      },
    ];
  }

  /**
   * Place one generated step: add it when it is missing, bring an earlier form
   * up to date, and leave one edited by hand alone.
   *
   * @remarks
   * The conflict step carries a provider list of its own, so a second provider
   * is added to it rather than replacing the first. `register-sso` declares
   * none, so it is compared as written.
   *
   * @param staged - The steps so far, and the regions left alone so far.
   * @param generated - The step, and its earlier forms.
   * @param slug - The provider.
   * @param terminal - The step a completed sign-in ends at.
   * @returns The steps, and the regions left alone.
   */
  private static placeGeneratedStep(
    staged: Staged,
    generated: GeneratedStep,
    slug: ConnectionSlug,
    terminal: StepName,
  ): Staged {
    const steps = staged.steps;
    const name = generated.name;
    const step = generated.step;
    const existing = SsoGenerator.stepNamed(steps, name);
    if (existing === undefined) {
      // Before the terminal step, after any step already added here.
      const terminalIndex = steps.findIndex((candidate) => {
        return candidate.name === terminal;
      });
      const at = terminalIndex === -1 ? steps.length : terminalIndex;
      return { steps: [...steps.slice(0, at), step, ...steps.slice(at)], skipped: staged.skipped };
    }
    if (step.sso_providers === undefined) {
      if (SsoGenerator.matches(existing, step)) {
        return staged;
      }
      return SsoGenerator.leftAlone(staged, name);
    }
    const merged = SsoGenerator.mergedProviders(existing, slug);
    const expected = { ...step, sso_providers: merged };
    // Compared as if the list were already merged, but without merging it: the
    // list is the generator's to extend, the rest of the step is not.
    const candidate = { ...existing, sso_providers: merged };
    if (SsoGenerator.matches(candidate, expected)) {
      const extended = SsoGenerator.replaceStep(steps, name, () => {
        return candidate;
      });
      return { steps: extended, skipped: staged.skipped };
    }
    const earlierForm = generated.earlier.some((form) => {
      return SsoGenerator.matches(candidate, { ...form, sso_providers: merged });
    });
    if (earlierForm) {
      // What the generator wrote for other methods: bring it up to today's, in
      // the place it already has, keeping the providers it lists.
      const updated = SsoGenerator.replaceStep(steps, name, () => {
        return expected;
      });
      return { steps: updated, skipped: staged.skipped };
    }
    return SsoGenerator.leftAlone(staged, name);
  }

  /**
   * The steps as they are, with one more step named as left alone.
   *
   * @param staged - The steps so far, and the regions left alone so far.
   * @param name - The step edited by hand.
   * @returns The same steps, and the regions left alone with this one.
   */
  private static leftAlone(staged: Staged, name: StepName): Staged {
    return { steps: staged.steps, skipped: [...staged.skipped, SsoGenerator.handEdited(name)] };
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
  private static registrationFields(flow: FlowValue): readonly string[] {
    const named = flow.purposes.register ?? "register";
    const candidates = [named, "register", "identifier"].map((name) => {
      const fields = SsoGenerator.stepNamed(flow.steps, name)?.fields ?? [];
      return fields.filter((field) => {
        return !field.startsWith("x-auth-methods#");
      });
    });
    const collected = candidates.find((fields) => {
      return fields.length > 0;
    });
    return collected ?? [];
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
  private static registerSsoStep(fields: readonly string[], terminal: StepName): JsonObject {
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
    loginStep: StepName | undefined,
    terminal: StepName,
  ): JsonObject {
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
    const submitRoutes: JsonObject = methods.password ? { submit: { target: terminal } } : {};
    const passkeyRoutes: JsonObject = methods.passkey ? { passkey: { target: terminal } } : {};
    const signInRoutes: JsonObject =
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
    const kept = Object.entries(step).filter((entry) => {
      const key = entry[0];
      const value = entry[1];
      if (key !== "fields" && key !== "gates") {
        return true;
      }
      if (isJsonArray(value)) {
        return value.length > 0;
      }
      return !(isJsonObject(value) && Object.keys(value).length === 0);
    });
    const reduced: JsonObject = Object.fromEntries(kept);
    const actions = reduced.actions;
    if (!isJsonArray(actions)) {
      return reduced;
    }
    const plain: JsonArray = actions.map((action) => {
      if (!isJsonObject(action) || action.primary !== false) {
        return action;
      }
      return withoutKey(action, "primary");
    });
    return { ...reduced, actions: plain };
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
  private static isShippedPasswordStep(step: JsonObject, terminal: StepName): boolean {
    const reduced = SsoGenerator.withoutSsoRoutes(step, terminal);
    return SETUP_PRESETS.some((preset) => {
      const shipped: unknown = getDefaultLoginFlow({ preset });
      if (!isJsonValue(shipped) || !isJsonObject(shipped)) {
        return false;
      }
      const shippedStep = SsoGenerator.stepNamed(SsoGenerator.stepsOf(shipped), PASSWORD_STEP);
      if (shippedStep === undefined) {
        return false;
      }
      return isDeepStrictEqual(SsoGenerator.withoutSsoRoutes(shippedStep, DONE_STEP), reduced);
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
  private static withoutSsoRoutes(step: JsonObject, terminal: StepName): JsonObject {
    const rest = withoutKey(SsoGenerator.withoutServerDefaults(step), "sso_providers");
    if (!isJsonObject(rest.transitions)) {
      return rest;
    }
    const written: { readonly [outcome: string]: StepName } = SsoGenerator.providerRoutes(terminal);
    const transitions = Object.fromEntries(
      Object.entries(rest.transitions).filter((entry) => {
        const outcome = entry[0];
        const route = entry[1];
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
  private static offersAlready(
    step: JsonObject,
    slug: ConnectionSlug,
    terminal: StepName,
  ): boolean {
    if (!listAt(step, "sso_providers").includes(slug)) {
      return false;
    }
    const transitions = objectAt(step, "transitions");
    const routes = SsoGenerator.providerRoutes(terminal);
    return PROVIDER_OUTCOMES.every((outcome) => {
      const route = transitions[outcome];
      return isJsonObject(route) && route.target === routes[outcome];
    });
  }

  /**
   * The provider list a step should end up with: what it has, plus this slug.
   *
   * @param step - The step.
   * @param slug - The provider.
   * @returns The merged list, a new one either way.
   */
  private static mergedProviders(step: JsonObject, slug: ConnectionSlug): JsonArray {
    const providers = listAt(step, "sso_providers");
    if (providers.includes(slug)) {
      return [...providers];
    }
    return [...providers, slug];
  }

  /**
   * Rename the previous outcome keys on every step of a flow.
   *
   * @remarks
   * The validator rejects the old keys. Where a step already has the new key,
   * that one wins and the old one goes; a key that is also one of the step's
   * action names stays. A renamed key moves to the end of the step's
   * transitions, as it always has.
   *
   * @param steps - The flow's steps.
   * @returns New steps with the old keys renamed.
   * @throws {@link RefusedEditError} When a rename would drop a route the author
   *   wrote: the new key is an action, or the old one declares purpose or action.
   */
  private static migrateLegacyOutcomes(steps: readonly JsonObject[]): readonly JsonObject[] {
    return steps.map((step) => {
      const transitions = step.transitions;
      if (!isJsonObject(transitions)) {
        return step;
      }
      const name = String(step.name);
      const actionNames = new Set(
        listAt(step, "actions").map((action) => {
          return isJsonObject(action) ? action.name : undefined;
        }),
      );
      const renames = Object.entries(LEGACY_OUTCOMES).filter((rename) => {
        const old = rename[0];
        return old in transitions && !actionNames.has(old);
      });
      for (const rename of renames) {
        SsoGenerator.refuseLossyRename(name, transitions, actionNames, rename[0], rename[1]);
      }
      if (renames.length === 0) {
        return step;
      }
      const olds = renames.map((rename) => {
        return rename[0];
      });
      const kept = Object.entries(transitions).filter((entry) => {
        return !olds.includes(entry[0]);
      });
      const moved = renames.flatMap((rename): readonly (readonly [string, JsonValue])[] => {
        const next = rename[1];
        const value = transitions[rename[0]];
        if (next in transitions || value === undefined) {
          return [];
        }
        return [[next, value]];
      });
      return { ...step, transitions: Object.fromEntries([...kept, ...moved]) };
    });
  }

  /**
   * Refuse renaming a legacy outcome key when the rename would drop a route the
   * author wrote.
   *
   * @param step - The step's name, as a message names it.
   * @param transitions - The step's transitions.
   * @param actionNames - The names of the step's actions.
   * @param old - The key the previous CLI wrote.
   * @param next - The key it is renamed to.
   * @throws {@link RefusedEditError} When the new key is an action, or the old
   *   one declares a purpose or an action and the new one is not there yet.
   */
  private static refuseLossyRename(
    step: string,
    transitions: JsonObject,
    actionNames: ReadonlySet<JsonValue | undefined>,
    old: string,
    next: string,
  ): void {
    if (actionNames.has(next)) {
      throw new RefusedEditError(
        `steps.${step}: transition "${old}" is renamed to "${next}", which is an action on this step`,
        {
          hint: `Rename the action "${next}" on step "${step}" (and its transition), then run auth-method sso enable again.`,
          details: { step, action: next },
        },
      );
    }
    if (next in transitions) {
      return;
    }
    const transition = transitions[old];
    if (!isJsonObject(transition)) {
      return;
    }
    const purpose = transition.purpose ?? null;
    const action = transition.action ?? null;
    if (purpose !== null || action !== null) {
      throw new RefusedEditError(
        `steps.${step}: transition "${old}" declares purpose or action, which "${next}" cannot`,
        {
          hint: `Remove purpose and action from the transition "${old}" on step "${step}", then run auth-method sso enable again.`,
          details: { step, transition: old },
        },
      );
    }
  }

  /**
   * Refuse a flow where a step the edit writes declares an action named like an
   * outcome key the edit writes on that step.
   *
   * @remarks
   * The generated route would silently replace the action's. A step can be
   * listed twice (a provider step named `register-password`), so its keys are
   * the union of every entry, never just the last one.
   *
   * @param flow - The flow.
   * @throws {@link RefusedEditError} When such an action exists.
   */
  private static refuseOutcomeActionCollision(flow: FlowValue): void {
    const providerSteps = SsoGenerator.providerSteps(flow);
    const collisionOnly: readonly string[] = [COLLISION_OUTCOME];
    const entries = [
      ...providerSteps.map((name) => {
        return { name, keys: PROVIDER_OUTCOMES };
      }),
      { name: SSO_CONFLICT_STEP, keys: PROVIDER_OUTCOMES },
      { name: REGISTER_SSO_STEP, keys: collisionOnly },
      { name: REGISTER_PASSWORD_STEP, keys: collisionOnly },
    ];
    const names = [
      ...new Set(
        entries.map((entry) => {
          return entry.name;
        }),
      ),
    ];
    for (const name of names) {
      const keys = new Set(
        entries.flatMap((entry): readonly string[] => {
          if (entry.name !== name) {
            return [];
          }
          return entry.keys;
        }),
      );
      const actions = SsoGenerator.stepNamed(flow.steps, name)?.actions ?? [];
      for (const action of actions) {
        const actionName = action.name;
        if (keys.has(actionName)) {
          throw new RefusedEditError(
            `steps.${name}: action "${actionName}" uses a name auth-method sso enable writes as an outcome on this step`,
            {
              hint: `Rename the action "${actionName}" on step "${name}" (and its transition), then run auth-method sso enable again.`,
              details: { step: name, action: actionName },
            },
          );
        }
      }
    }
  }
}
