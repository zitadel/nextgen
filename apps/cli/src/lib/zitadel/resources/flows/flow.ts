import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { flowConfigSchema } from "@zitadel/config/schemas";
import { PURPOSE_FLIP_TARGETS } from "@zitadel/config/validate";

import { ConfigDocument, type DocumentFile, type DocumentStatus } from "@/lib/zitadel/resources/document";
import {
  addSsoToFlow,
  flowEditRefusal,
  generatedSsoSteps,
  offersProvider,
  providersRefusal,
  removeSsoFromFlow,
} from "@/lib/zitadel/resources/flows/sso";
import { Step, type Transition } from "@/lib/zitadel/resources/flows/step";
import type { SkippedRegion } from "@/lib/zitadel/resources/flows/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { EnabledMethods, ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt } from "@/lib/zitadel/utils/json";

/**
 * The field a step collects a password with.
 */
export const PASSWORD_FIELD = "x-auth-methods#password";

/**
 * The action kinds that offer or enrol a passkey.
 */
const PASSKEY_ACTION_KINDS: ReadonlySet<string> = new Set(["passkey", "passkey_register"]);

/**
 * Outcomes the engine answers by switching from login to register without a
 * `purpose` on the transition: the identifier one, plus `sso_user_not_found`.
 */
const LOGIN_LEAVING_OUTCOMES: ReadonlySet<string> = new Set([
  ...Object.keys(PURPOSE_FLIP_TARGETS.login ?? {}),
  "sso_user_not_found",
]);

/**
 * A transition of another step that leads to a step.
 */
export type IncomingTransition = Readonly<{
  /**
   * The step the transition belongs to.
   */
  step: string;
  /**
   * The outcome that fires it.
   */
  transition: string;
  /**
   * The purpose it follows, when it names only a purpose and so leads to that
   * purpose's entry step.
   */
  purpose?: string;
}>;

/**
 * How one step uses a method, and what the step would be without it.
 */
export type MethodUse = Readonly<{
  /**
   * The step.
   */
  step: string;
  /**
   * How it uses the method, as a message names it.
   */
  uses: string;
  /**
   * The fields and sign-in methods it keeps without the method.
   */
  keeps: readonly string[];
  /**
   * The purposes that start on it.
   */
  entryFor: readonly string[];
  /**
   * The transitions that lead to it.
   */
  targetedBy: readonly IncomingTransition[];
}>;

/**
 * A login flow under `.zitadel/flows/`: its steps and how they connect.
 */
export class Flow<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * Hold a flow's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a flow as read.
   *
   * @param file - The file.
   * @returns The flow, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): Flow<Body> {
    return new Flow(file.path, file.body, "read");
  }

  /**
   * A new flow, not yet written: saving it never replaces a file already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The flow, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): Flow<Body> {
    return new Flow(file.path, file.body, "created");
  }

  /**
   * The flow as saved: what it holds is now what the file holds.
   *
   * @returns The same flow, marked as read.
   */
  asRead(): Flow<Body> {
    return new Flow(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the flow on its own: what the flow contract refuses.
   *
   * @remarks
   * The server's own flow rules need the flow's schema too, so they are not
   * among these.
   *
   * @param _context - Unused: the flow contract needs nothing beyond the file.
   * @returns One `contract/flow` finding per refusal; none when it conforms.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    return this.contractIssues("contract/flow", flowConfigSchema);
  }

  /**
   * The body the server receives: the flow as written.
   *
   * @param _store - Unused: a flow holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The file's name without `.json`.
   *
   * @returns The name.
   */
  get name(): string {
    return basename(this.path, ".json");
  }

  /**
   * Whether the flow can sign anyone in.
   *
   * @returns True when it is `active`, the only status that is served, and has
   *   a `login` entry.
   */
  get servesLogin(): boolean {
    return (
      this.body.status === "active" && typeof objectAt(this.body, "purposes").login === "string"
    );
  }

  /**
   * What `user_schema` names.
   *
   * @returns The reference, or `undefined` when it is missing or empty.
   */
  get userSchema(): string | undefined {
    const reference = this.body.user_schema;
    if (typeof reference !== "string" || reference === "") {
      return undefined;
    }
    return reference;
  }

  /**
   * Whether `user_schema` names the schema by an id rather than by its
   * `objectType`.
   *
   * @remarks
   * Told apart as the server's `isUserSchemaID` does: a platform id
   * (`sch_…`) or a URL, which is a schema's `$id`.
   *
   * @returns True for an id; false for an `objectType` or no reference at all.
   */
  get namesSchemaById(): boolean {
    const reference = this.userSchema ?? "";
    return /^sch_./.test(reference) || /^[a-z][a-z0-9+.-]*:/i.test(reference);
  }

  /**
   * The steps that are objects.
   *
   * @returns Each step, in order; none when `steps` is not a list.
   */
  get steps(): readonly Step[] {
    const steps: readonly unknown[] = Array.isArray(this.body.steps) ? this.body.steps : [];
    return steps.filter(isJsonObject).map(Step.of);
  }

  /**
   * The steps the flow starts at, one per purpose.
   *
   * @returns The entry step names, in the order the purposes are written.
   */
  get entrySteps(): readonly string[] {
    return Object.values(objectAt(this.body, "purposes")).filter((entry): entry is string => {
      return typeof entry === "string";
    });
  }

  /**
   * The steps enabling a provider adds that the flow carries.
   *
   * @returns Their names; none when the flow has none of them.
   */
  get generatedSsoSteps(): readonly string[] {
    return generatedSsoSteps(this.body);
  }

  /**
   * The steps reached from the login entry.
   *
   * @remarks
   * Only transitions that stay in the login purpose are followed: one with an
   * `action` goes to another flow, one into another purpose leaves the
   * journey, and some outcomes switch to registration on their own.
   *
   * @returns The steps reached, in the flow's order; none without a login entry.
   */
  get loginJourney(): readonly Step[] {
    const entry = objectAt(this.body, "purposes").login;
    const staysInLogin = (transition: Transition): boolean => {
      return (
        !LOGIN_LEAVING_OUTCOMES.has(transition.outcome) &&
        transition.target !== "" &&
        transition.action === null &&
        (transition.purpose === null || transition.purpose === "login")
      );
    };
    const grow = (
      reached: ReadonlySet<string>,
      frontier: readonly string[],
    ): ReadonlySet<string> => {
      const fresh = [...new Set(frontier)].filter((name) => {
        return !reached.has(name) && this.step(name) !== undefined;
      });
      if (fresh.length === 0) {
        return reached;
      }
      const next = fresh.flatMap((name) => {
        return (this.step(name)?.transitions ?? []).filter(staysInLogin).map((transition) => {
          return transition.target;
        });
      });
      return grow(new Set([...reached, ...fresh]), next);
    };
    const reached = grow(new Set(), typeof entry === "string" ? [entry] : []);
    return this.steps.filter((step) => {
      return reached.has(step.name);
    });
  }

  /**
   * The fields collected on the way to signing in: every field a step of the
   * {@link loginJourney} asks for.
   *
   * @remarks
   * The journey follows the engine (`flow_state_machine.go`), not the wire
   * alone. A transition with an `action` is a cross-flow `switch` or `pivot`,
   * which leaves this flow; a declared `purpose` other than `login` re-purposes
   * the attempt; and `user_not_found` or `sso_user_not_found` switch a login to
   * registration on their own (`applyOutcomeFlip`), so the step they lead to is
   * a sign-up step even when the transition names no purpose. A transition
   * that declares `purpose: "login"` stays in the login, but the server holds
   * its target to the login entry, which is already on the way.
   *
   * @returns Each field once, in the order of the steps that ask for it.
   */
  get loginFields(): ReadonlySet<string> {
    return new Set(
      this.loginJourney.flatMap((step) => {
        return step.fields;
      }),
    );
  }

  /**
   * The sign-in methods (`password`, `passkey`, `sso`) the flow lets an
   * existing user sign in with.
   *
   * @remarks
   * Only the steps of the {@link loginJourney} count, and only while the flow
   * is served; a passkey only through a `passkey` action, since
   * `passkey_register` signs nobody in; SSO only through one of the given
   * providers.
   *
   * @param providers - The providers the schema enables.
   * @returns The methods, in the order password, passkey, sso.
   */
  offeredMethods(providers: readonly string[]): readonly string[] {
    const journey = this.servesLogin ? this.loginJourney : [];
    const signsIn: Readonly<Record<string, (step: Step) => boolean>> = {
      password: (step) => {
        return step.fields.includes(PASSWORD_FIELD);
      },
      passkey: (step) => {
        return step.actions.some((action) => {
          return action.kind === "passkey";
        });
      },
      sso: (step) => {
        return step.providers.some((provider) => {
          return providers.includes(provider);
        });
      },
    };
    return Object.entries(signsIn)
      .filter(([, offers]) => {
        return journey.some(offers);
      })
      .map(([method]) => {
        return method;
      });
  }

  /**
   * The steps that use a method, a password field or a passkey action, and
   * what each would be without it.
   *
   * @param method - The method.
   * @param stillEnabled - The sign-in methods the schema enables without it: a
   *   passkey action or a provider list counts as kept only when its method is one.
   * @returns One entry per step that uses it, in the flow's order.
   */
  methodUses(method: ToggleableMethod, stillEnabled: readonly string[]): readonly MethodUse[] {
    const purposes = objectAt(this.body, "purposes");
    return this.steps.flatMap((step): MethodUse[] => {
      const passkeys = step.actions
        .filter((action) => {
          return PASSKEY_ACTION_KINDS.has(action.kind);
        })
        .map((action) => {
          return `action ${JSON.stringify(action.name)}`;
        });
      const byPassword = method === "password";
      const usesIt = byPassword ? step.fields.includes(PASSWORD_FIELD) : passkeys.length > 0;
      if (!usesIt) {
        return [];
      }
      const fields = step.fields
        .filter((field) => {
          return !byPassword || field !== PASSWORD_FIELD;
        })
        .map((field) => {
          return `field ${JSON.stringify(field)}`;
        });
      const keptPasskeys =
        byPassword && stillEnabled.includes("passkey")
          ? passkeys.map((action) => {
              return `passkey ${action}`;
            })
          : [];
      const keptProviders =
        stillEnabled.includes("sso") && step.providers.length > 0 ? ["sso_providers"] : [];
      const keptGates = step.hasGates ? ["gates"] : [];
      return [
        {
          step: step.name,
          uses: byPassword ? "collects password" : `offers passkey (${passkeys.join(", ")})`,
          keeps: [...fields, ...keptPasskeys, ...keptProviders, ...keptGates],
          entryFor: Object.keys(purposes).filter((purpose) => {
            return purposes[purpose] === step.name;
          }),
          targetedBy: this.transitionsInto(step.name),
        },
      ];
    });
  }

  /**
   * The transitions of other steps that lead to a step.
   *
   * @remarks
   * A transition with an `action` leaves for another flow, so it leads to no
   * step of this one. One that names only a purpose leads to that purpose's
   * entry step.
   *
   * @param name - The step.
   * @returns Each transition, and the purpose it follows when it names one.
   */
  transitionsInto(name: string): readonly IncomingTransition[] {
    const purposes = objectAt(this.body, "purposes");
    return this.steps
      .filter((other) => {
        return other.name !== name;
      })
      .flatMap((other) => {
        return other.transitions
          .filter((transition) => {
            return transition.action === null;
          })
          .flatMap((transition): IncomingTransition[] => {
            if (transition.target !== "" && transition.target === name) {
              return [{ step: other.name, transition: transition.outcome }];
            }
            if (
              transition.target === "" &&
              transition.purpose !== null &&
              purposes[transition.purpose] === name
            ) {
              return [
                { step: other.name, transition: transition.outcome, purpose: transition.purpose },
              ];
            }
            return [];
          });
      });
  }

  /**
   * The step with this name.
   *
   * @param name - The step's name.
   * @returns The step, or `undefined` when the flow has none by that name.
   */
  step(name: string): Step | undefined {
    return this.steps.find((step) => {
      return step.name === name;
    });
  }

  /**
   * Whether a step offers a provider.
   *
   * @param slug - The provider, or none for any provider at all.
   * @returns Whether one does.
   */
  offers(slug?: string): boolean {
    return offersProvider(this.body, slug);
  }

  /**
   * The regions {@link withProvider} leaves alone because they were edited by
   * hand.
   *
   * @param slug - The provider.
   * @param methods - The methods the flow's schema enables.
   * @returns The regions; none when the edit writes every one it needs.
   */
  regionsLeftAlone(slug: ConnectionSlug, methods: EnabledMethods): readonly SkippedRegion[] {
    return addSsoToFlow(this.body, slug, methods).skipped;
  }

  /**
   * Refuse a flow that an edit offering a provider could not write.
   *
   * @remarks
   * {@link withProvider} checks this itself; a caller checks it first only to
   * refuse before it asks anything.
   *
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes, or no step marks where a completed sign-in ends.
   */
  assertProviderEditable(): void {
    this.refuseUneditable(flowEditRefusal(this.body));
  }

  /**
   * The flow offering a provider on its entry steps, with the steps and routes
   * a provider round trip needs.
   *
   * @remarks
   * Regions edited by hand are left as they are; {@link regionsLeftAlone}
   * names them.
   *
   * @param slug - The provider.
   * @param methods - The methods the flow's schema enables.
   * @returns The edited flow, or this one when it already offers the provider.
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes.
   */
  withProvider(slug: ConnectionSlug, methods: EnabledMethods): Flow<Body> {
    this.assertProviderEditable();
    const edit = addSsoToFlow(this.body, slug, methods);
    if (!edit.changed) {
      return this;
    }
    return new Flow(this.path, { ...this.body, ...edit.body }, this.editedStatus);
  }

  /**
   * The flow without a provider on any step.
   *
   * @remarks
   * Removing writes no route, so only the provider lists need to be readable.
   *
   * @param slug - The provider.
   * @returns The edited flow, or this one when no step offers it.
   * @throws {@link RefusedEditError} When the steps or their provider lists
   *   are not the shape the edit writes.
   */
  withoutProvider(slug: string): Flow<Body> {
    this.refuseUneditable(providersRefusal(this.body));
    const edit = removeSsoFromFlow(this.body, slug);
    if (!edit.changed) {
      return this;
    }
    return new Flow(this.path, { ...this.body, ...edit.body }, this.editedStatus);
  }
}
