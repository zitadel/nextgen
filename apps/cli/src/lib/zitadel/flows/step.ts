import { type StepName, stepName } from "@/lib/zitadel/names";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/** One transition out of a step: what fires it, and where it goes. */
export type Transition = Readonly<{
  outcome: string;
  target: string;
  /** `switch` or `pivot` for a transition to another flow; `null` within this one. */
  action: string | null;
  /** The purpose it re-purposes to, or `null`. */
  purpose: string | null;
}>;

/** One action a step declares. */
export type StepAction = Readonly<{ name: string; kind: string }>;

/**
 * One step of a login flow, read-only: the questions the rules ask of it.
 *
 * @remarks
 * A view over the step's JSON, never written back; a flow is edited through
 * {@link Flow}.
 */
export class Step {
  readonly name: StepName;
  private readonly body: JsonObject;

  private constructor(body: JsonObject) {
    this.body = body;
    this.name = stepName(typeof body.name === "string" ? body.name : "");
  }

  /**
   * Read a step of a flow.
   *
   * @param body - The step's JSON.
   * @returns The step.
   */
  static of(body: JsonObject): Step {
    return new Step(body);
  }

  /** The providers `sso_providers` lists, as written. */
  get providers(): readonly string[] {
    return stringsIn(this.body.sso_providers);
  }

  /** The providers listed more than once, which offers their button twice. */
  get repeatedProviders(): readonly string[] {
    const providers = this.providers;
    return [
      ...new Set(
        providers.filter((provider, index) => {
          return providers.indexOf(provider) !== index;
        }),
      ),
    ];
  }

  /** The fields the step asks for, as written. */
  get fields(): readonly string[] {
    return stringsIn(this.body.fields);
  }

  /** The actions the step declares. */
  get actions(): readonly StepAction[] {
    const actions: readonly unknown[] = Array.isArray(this.body.actions) ? this.body.actions : [];
    return actions.filter(isJsonObject).map((action) => {
      return {
        name: typeof action.name === "string" ? action.name : String(action.name),
        kind: typeof action.kind === "string" ? action.kind : String(action.kind),
      };
    });
  }

  /** Whether the step declares any gate. */
  get hasGates(): boolean {
    return Object.keys(objectAt(this.body, "gates")).length > 0;
  }

  /** Whether completing the step creates a user from a provider's sign-in. */
  get createsUserFromSso(): boolean {
    return this.body.on_success === "create_user_with_sso";
  }

  /** Every transition out of the step. */
  get transitions(): readonly Transition[] {
    return Object.entries(objectAt(this.body, "transitions")).map(([outcome, route]) => {
      const entry = isJsonObject(route) ? route : {};
      return {
        outcome,
        target: typeof entry.target === "string" ? entry.target : "",
        action: typeof entry.action === "string" ? entry.action : null,
        purpose: typeof entry.purpose === "string" ? entry.purpose : null,
      };
    });
  }

  /**
   * The outcomes the step routes. The engine follows an SSO collision only
   * through a `user_already_exists` transition that has no action: one that
   * switches or pivots to another flow leaves the step showing the SSO error.
   */
  get routes(): ReadonlySet<string> {
    const transitions = objectAt(this.body, "transitions");
    return new Set(
      Object.keys(transitions).filter((outcome) => {
        if (outcome !== "user_already_exists") {
          return true;
        }
        const route = transitions[outcome];
        return !isJsonObject(route) || route.action === undefined || route.action === null;
      }),
    );
  }

  /** Whether `user_already_exists` is there but carries an action, which the engine does not follow. */
  get collisionCarriesAction(): boolean {
    const transitions = objectAt(this.body, "transitions");
    return "user_already_exists" in transitions && !this.routes.has("user_already_exists");
  }

  /**
   * Whether the step asks for a property, or for something inside it, or for
   * the object it sits in.
   *
   * @param path - The property's dotted path.
   * @returns Whether a field covers it.
   */
  asksFor(path: string): boolean {
    return this.fields.some((field) => {
      return field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`);
    });
  }
}
