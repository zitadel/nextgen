import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { PURPOSE_FLIP_TARGETS } from "@zitadel/config/validate";

import { ConfigDocument, type DocumentStatus } from "@/lib/zitadel/document";
import {
  addSsoToFlow,
  flowEditRefusal,
  generatedSsoSteps,
  offersProvider,
  providersRefusal,
  removeSsoFromFlow,
} from "@/lib/zitadel/flows/sso";
import { Step } from "@/lib/zitadel/flows/step";
import { RefusedEditError } from "@/lib/zitadel/errors";
import type { EnabledMethods, ToggleableMethod } from "@/lib/zitadel/schemas/types";
import type { JsonObject } from "@/lib/zitadel/types";
import type { SkippedRegion } from "@/lib/zitadel/flows/types";
import { isJsonObject, objectAt } from "@/lib/zitadel/utils/json";

/** What offering a provider made of a flow. */
export type FlowEdit<Body extends JsonObject = JsonObject> = Readonly<{
  flow: Flow<Body>;
  /** The regions left alone because they were edited by hand. */
  skipped: readonly SkippedRegion[];
}>;

/** The field a step collects a password with. */
export const PASSWORD_FIELD = "x-auth-methods#password";

/** The action kinds that offer or enrol a passkey. */
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
 * A transition of another step that leads to a step. `purpose` is set when it
 * names only a purpose, so it follows that purpose's entry step.
 */
export type IncomingTransition = Readonly<{
  step: string;
  transition: string;
  purpose?: string;
}>;

/**
 * How one step uses a method, and what the step would be without it: the
 * fields and sign-in methods it keeps, the purposes that start on it, and the
 * transitions that lead to it.
 */
export type MethodUse = Readonly<{
  step: string;
  uses: string;
  keeps: readonly string[];
  entryFor: readonly string[];
  targetedBy: readonly IncomingTransition[];
}>;

/** A login flow under `.zitadel/flows/`: its steps and how they connect. */
export class Flow<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a flow as read.
   *
   * @param file - The file.
   * @returns The flow.
   */
  static of<Body extends JsonObject>(file: Readonly<{ path: string; body: Body }>): Flow<Body> {
    return new Flow(file.path, file.body, "read");
  }

  /**
   * A new file, not yet written: saving it never replaces a file already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The document.
   */
  static create<Body extends JsonObject>(file: Readonly<{ path: string; body: Body }>): Flow<Body> {
    return new Flow(file.path, file.body, "created");
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The document, marked as read.
   */
  asRead(): Flow<Body> {
    return new Flow(this.path, this.body, "read");
  }

  /** The file's name without `.json`. */
  get name(): string {
    return basename(this.path, ".json");
  }

  /**
   * Whether the flow can sign anyone in: it is `active`, the only status that
   * is served, and has a `login` entry.
   */
  get servesLogin(): boolean {
    return (
      this.body.status === "active" && typeof objectAt(this.body, "purposes").login === "string"
    );
  }

  /**
   * The sign-in methods (`password`, `passkey`, `sso`) the flow lets an
   * existing user sign in with. Only the steps reached from the login entry
   * count, and only while the flow is served; a passkey only through a
   * `passkey` action, since `passkey_register` signs nobody in; SSO only
   * through one of the given providers.
   *
   * @param providers - The providers the schema enables.
   * @returns The methods.
   */
  offeredMethods(providers: readonly string[]): readonly string[] {
    if (!this.servesLogin) {
      return [];
    }
    const journey = this.loginJourney;
    const offers = (signsIn: (step: Step) => boolean): boolean => {
      return journey.some(signsIn);
    };
    return [
      ...(offers((step) => {
        return step.fields.includes(PASSWORD_FIELD);
      })
        ? ["password"]
        : []),
      ...(offers((step) => {
        return step.actions.some((action) => {
          return action.kind === "passkey";
        });
      })
        ? ["passkey"]
        : []),
      ...(offers((step) => {
        return step.providers.some((provider) => {
          return providers.includes(provider);
        });
      })
        ? ["sso"]
        : []),
    ];
  }

  /**
   * The steps that use a method, a password field or a passkey action, and
   * what each would be without it.
   *
   * @param method - The method.
   * @param stillEnabled - The sign-in methods the schema enables without it: a
   *   passkey action or a provider list counts as kept only when its method is one.
   * @returns One entry per step that uses it.
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
      const fields = step.fields.filter((field) => {
        return method !== "password" || field !== PASSWORD_FIELD;
      });
      const usesIt =
        method === "password" ? step.fields.includes(PASSWORD_FIELD) : passkeys.length > 0;
      if (!usesIt) {
        return [];
      }
      const keeps = [
        ...fields.map((field) => {
          return `field ${JSON.stringify(field)}`;
        }),
        ...(method === "password" && stillEnabled.includes("passkey")
          ? passkeys.map((action) => {
              return `passkey ${action}`;
            })
          : []),
        ...(stillEnabled.includes("sso") && step.providers.length > 0 ? ["sso_providers"] : []),
        ...(step.hasGates ? ["gates"] : []),
      ];
      const uses =
        method === "password" ? "collects password" : `offers passkey (${passkeys.join(", ")})`;
      return [
        {
          step: step.name,
          uses,
          keeps,
          entryFor: Object.keys(purposes).filter((purpose) => {
            return purposes[purpose] === step.name;
          }),
          targetedBy: this.transitionsInto(step.name),
        },
      ];
    });
  }

  /** What `user_schema` names, or `undefined` when it names nothing. */
  get userSchema(): string | undefined {
    const reference = this.body.user_schema;
    if (typeof reference !== "string" || reference === "") {
      return undefined;
    }
    return reference;
  }

  /** The steps that are objects, in order. */
  get steps(): readonly Step[] {
    const steps: readonly unknown[] = Array.isArray(this.body.steps) ? this.body.steps : [];
    return steps.filter(isJsonObject).map(Step.of);
  }

  /** The steps the flow starts at, one per purpose. */
  get entrySteps(): readonly string[] {
    return Object.values(objectAt(this.body, "purposes")).filter((entry): entry is string => {
      return typeof entry === "string";
    });
  }

  /** The steps enabling a provider adds that the flow carries. */
  get generatedSsoSteps(): readonly string[] {
    return generatedSsoSteps(this.body);
  }

  /**
   * The step with this name.
   *
   * @param name - The step's name.
   * @returns The step, or `undefined`.
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
   * The steps reached from the login entry, following transitions that stay in
   * the login purpose: one with an `action` goes to another flow, one into
   * another purpose leaves the journey, and some outcomes switch to
   * registration on their own.
   */
  private get loginJourney(): readonly Step[] {
    const entry = objectAt(this.body, "purposes").login;
    if (typeof entry !== "string") {
      return [];
    }
    const reached = new Set<string>();
    const queue = [entry];
    // A queue drained as it grows: the walk ends when no step is new.
    while (queue.length > 0) {
      const name = queue.shift();
      const step = name === undefined ? undefined : this.step(name);
      if (name === undefined || step === undefined || reached.has(name)) {
        continue;
      }
      reached.add(name);
      queue.push(
        ...step.transitions
          .filter((transition) => {
            return (
              !LOGIN_LEAVING_OUTCOMES.has(transition.outcome) &&
              transition.target !== "" &&
              transition.action === null &&
              (transition.purpose === null || transition.purpose === "login")
            );
          })
          .map((transition) => {
            return transition.target;
          }),
      );
    }
    return this.steps.filter((step) => {
      return reached.has(step.name);
    });
  }

  /**
   * The transitions of other steps that lead to a step.
   *
   * @param name - The step.
   * @returns Each transition, and the purpose it follows when it names one.
   */
  private transitionsInto(name: string): readonly IncomingTransition[] {
    const purposes = objectAt(this.body, "purposes");
    return this.steps.flatMap((other) => {
      if (other.name === name) {
        return [];
      }
      return other.transitions.flatMap((transition): IncomingTransition[] => {
        if (transition.action !== null) {
          return [];
        }
        if (transition.target !== "") {
          return transition.target === name
            ? [{ step: other.name, transition: transition.outcome }]
            : [];
        }
        if (transition.purpose !== null && purposes[transition.purpose] === name) {
          return [
            { step: other.name, transition: transition.outcome, purpose: transition.purpose },
          ];
        }
        return [];
      });
    });
  }

  /**
   * Why the flow cannot be edited to offer a provider.
   *
   * @returns The reason, or `undefined` when it can.
   */
  editRefusal(): string | undefined {
    return flowEditRefusal(this.body);
  }

  /**
   * Why the flow's provider lists cannot be read, which is all removing a
   * provider needs.
   *
   * @returns The reason, or `undefined` when they can.
   */
  providersRefusal(): string | undefined {
    return providersRefusal(this.body);
  }

  /**
   * The flow offering a provider on its entry steps, with the steps and routes
   * a provider round trip needs.
   *
   * @param slug - The provider.
   * @param methods - The methods the flow's schema enables.
   * @returns The edited flow, and what was left alone.
   * @throws {@link RefusedEditError} When an edit would discard a route
   *   written by hand.
   */
  withProvider(slug: ConnectionSlug, methods: EnabledMethods): FlowEdit<Body> {
    this.refuseUneditable(this.editRefusal());
    const result = addSsoToFlow(this.body, slug, methods);
    if (!result.changed) {
      return { flow: this, skipped: result.skipped };
    }
    return {
      flow: new Flow(this.path, { ...this.body, ...result.body }, this.editedStatus),
      skipped: result.skipped,
    };
  }

  /**
   * The flow without a provider on any step.
   *
   * @param slug - The provider.
   * @returns The edited flow, or this one when no step offers it.
   */
  withoutProvider(slug: string): Flow<Body> {
    this.refuseUneditable(this.providersRefusal());
    const result = removeSsoFromFlow(this.body, slug);
    if (!result.changed) {
      return this;
    }
    return new Flow(this.path, { ...this.body, ...result.body }, this.editedStatus);
  }

  /**
   * Refuse an edit to a region that is not the shape the edit writes.
   *
   * @param region - What is wrong with it, or `undefined` when nothing is.
   * @throws {@link RefusedEditError} Naming the file and the region.
   */
  refuseUneditable(region: string | undefined): void {
    if (region === undefined) {
      return;
    }
    throw new RefusedEditError(`${this.path}: ${region}`, {
      hint:
        "This command edits that region, and it is not the shape it edits. " +
        "Fix it against the dialect in .zitadel/meta/, then run the command again.",
      details: { file: this.path, region },
    });
  }
}
