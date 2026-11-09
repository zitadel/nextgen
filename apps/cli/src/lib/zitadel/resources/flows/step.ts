import { type StepName, stepName } from "@/lib/zitadel/names";
import {
  COLLISION_OUTCOME,
  type StepAction,
  type Transition,
} from "@/lib/zitadel/resources/flows/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, listAt, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/**
 * One step of a login flow, read-only: the questions the rules ask of it.
 *
 * @remarks
 * A view over the step's JSON, never written back; a flow is edited through
 * {@link Flow}.
 */
export class Step {
  /**
   * The step's name; empty when it has none.
   */
  readonly name: StepName;

  /**
   * The step's JSON, exactly as the flow holds it.
   */
  private readonly body: JsonObject;

  /**
   * Hold a step's JSON.
   *
   * @param body - The step's JSON.
   */
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

  /**
   * The providers `sso_providers` lists, as written.
   *
   * @returns The strings listed, in order; none when there is no list.
   */
  get providers(): readonly string[] {
    return stringsIn(this.body.sso_providers);
  }

  /**
   * The fields the step asks for, as written.
   *
   * @returns The strings listed, in order; none when there is no list.
   */
  get fields(): readonly string[] {
    return stringsIn(this.body.fields);
  }

  /**
   * The actions the step declares.
   *
   * @remarks
   * A name or kind that is not a string is spelled out, so a rule can still
   * name it.
   *
   * @returns Each action that is an object, in order; none when there is no list.
   */
  get actions(): readonly StepAction[] {
    return listAt(this.body, "actions")
      .filter(isJsonObject)
      .map((action) => {
      return {
        name: typeof action.name === "string" ? action.name : String(action.name),
        kind: typeof action.kind === "string" ? action.kind : String(action.kind),
      };
      });
  }

  /**
   * Whether the step declares any gate.
   *
   * @returns True when `gates` has at least one entry.
   */
  get hasGates(): boolean {
    return Object.keys(objectAt(this.body, "gates")).length > 0;
  }

  /**
   * Whether completing the step creates a user from a provider's sign-in.
   *
   * @returns True when `on_success` is `create_user_with_sso`.
   */
  get createsUserFromSso(): boolean {
    return this.body.on_success === "create_user_with_sso";
  }

  /**
   * Every transition out of the step.
   *
   * @returns One per outcome, in the order written; none when there are none.
   */
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
   * The outcomes the step routes.
   *
   * @remarks
   * The engine follows an SSO collision only through a `user_already_exists`
   * transition that has no action: one that switches or pivots to another
   * flow leaves the step showing the SSO error.
   *
   * @returns The outcomes the engine follows.
   */
  get routes(): ReadonlySet<string> {
    const transitions = objectAt(this.body, "transitions");
    return new Set(
      Object.keys(transitions).filter((outcome) => {
        if (outcome !== COLLISION_OUTCOME) {
          return true;
        }
        const route = transitions[outcome];
        return !isJsonObject(route) || route.action === undefined || route.action === null;
      }),
    );
  }

  /**
   * Whether `user_already_exists` is there but carries an action, which the
   * engine does not follow.
   *
   * @returns True when the collision transition is written but not routed.
   */
  get collisionCarriesAction(): boolean {
    const transitions = objectAt(this.body, "transitions");
    return COLLISION_OUTCOME in transitions && !this.routes.has(COLLISION_OUTCOME);
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
