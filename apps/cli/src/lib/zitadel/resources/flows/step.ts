import { type PropertyPath, type StepName, stepName } from "@/lib/zitadel/names";
import {
  COLLISION_OUTCOME,
  type RouteValue,
  type StepAction,
  type StepValue,
  type Transition,
} from "@/lib/zitadel/resources/flows/types";

/**
 * One step of a login flow, read-only: the questions the rules ask of it.
 *
 * @remarks
 * A view over the step as the flow contract took it, never written back; a
 * flow is edited through {@link Flow}.
 */
export class Step {
  /**
   * The step's name.
   */
  readonly name: StepName;

  /**
   * The step as the flow contract took it.
   */
  private readonly value: StepValue;

  /**
   * Hold a step the flow contract took.
   *
   * @param value - The step.
   */
  private constructor(value: StepValue) {
    this.value = value;
    this.name = stepName(value.name);
  }

  /**
   * Read a step of a flow.
   *
   * @param value - The step, as the flow contract took it.
   * @returns The step.
   */
  static of(value: StepValue): Step {
    return new Step(value);
  }

  /**
   * The providers `sso_providers` lists.
   *
   * @returns The slugs, in order; none when the step lists none.
   */
  get providers(): readonly string[] {
    return this.value.sso_providers;
  }

  /**
   * The fields the step asks for.
   *
   * @returns The fields, in order; none when the step asks for none.
   */
  get fields(): readonly string[] {
    return this.value.fields;
  }

  /**
   * The actions the step declares.
   *
   * @returns Each action, in order; none when the step declares none.
   */
  get actions(): readonly StepAction[] {
    return this.value.actions;
  }

  /**
   * Whether the step declares any gate.
   *
   * @returns True when `gates` has at least one entry.
   */
  get hasGates(): boolean {
    return Object.keys(this.value.gates).length > 0;
  }

  /**
   * Whether completing the step creates a user from a provider's sign-in.
   *
   * @returns True when `on_success` is `create_user_with_sso`.
   */
  get createsUserFromSso(): boolean {
    return this.value.on_success === "create_user_with_sso";
  }

  /**
   * Every transition out of the step.
   *
   * @returns One per outcome, in the order written; none when there are none.
   */
  get transitions(): readonly Transition[] {
    return Object.entries(this.routesByOutcome).map((entry) => {
      return Step.transitionOf(entry[0], entry[1]);
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
    const routes = this.routesByOutcome;
    return new Set(
      Object.keys(routes).filter((outcome) => {
        if (outcome !== COLLISION_OUTCOME) {
          return true;
        }
        return Step.crossFlowAction(routes[outcome]) === undefined;
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
    return Step.crossFlowAction(this.routesByOutcome[COLLISION_OUTCOME]) !== undefined;
  }

  /**
   * Whether the step asks for a property, or for something inside it, or for
   * the object it sits in.
   *
   * @param path - The property's dotted path.
   * @returns Whether a field covers it.
   */
  asksFor(path: PropertyPath): boolean {
    return this.fields.some((field) => {
      return field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`);
    });
  }

  /**
   * The step's transitions by outcome.
   *
   * @returns Each outcome and where it goes; none when the step routes none.
   */
  private get routesByOutcome(): Readonly<Record<string, RouteValue>> {
    return this.value.transitions ?? {};
  }

  /**
   * One transition, as the engine reads it.
   *
   * @param outcome - The outcome that fires it.
   * @param route - Where it goes.
   * @returns The transition: an `action` leaves the flow, a target names a
   *   step, a lone purpose names that purpose's entry step.
   */
  private static transitionOf(outcome: string, route: RouteValue): Transition {
    const action = Step.crossFlowAction(route);
    const target = Step.targetOf(route);
    const purpose = route.purpose ?? undefined;
    if (action !== undefined) {
      return { kind: "cross-flow", outcome, action, target };
    }
    if (target !== undefined) {
      return { kind: "step", outcome, target, purpose };
    }
    if (purpose !== undefined) {
      return { kind: "purpose", outcome, purpose };
    }
    return { kind: "nowhere", outcome };
  }

  /**
   * The step a transition names.
   *
   * @param route - Where the transition goes.
   * @returns The step, or `undefined` when the transition names none.
   */
  private static targetOf(route: RouteValue): StepName | undefined {
    if (route.target === undefined) {
      return undefined;
    }
    return stepName(route.target);
  }

  /**
   * The action that sends a transition to another flow.
   *
   * @param route - Where the transition goes, or `undefined` when there is no
   *   such transition.
   * @returns `switch` or `pivot`, or `undefined` when it stays in this flow;
   *   a `null` action stays too.
   */
  private static crossFlowAction(route: RouteValue | undefined): string | undefined {
    return route?.action ?? undefined;
  }
}
