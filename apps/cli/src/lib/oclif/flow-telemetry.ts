import { ZitadelError } from "@/lib/errors";
import type { Properties } from "@/lib/telemetry";

export const FLOW_STARTED = "flow_started";
export const FLOW_STEP_COMPLETED = "step_completed";
export const FLOW_COMPLETED = "flow_completed";
export const FLOW_FAILED = "flow_failed";

/**
 * How one wizard step is reported: the step's name in the event catalog, and
 * the choice it settled, if it settled one.
 *
 * @typeParam Known - What a run knows after the step.
 */
export type FlowStep<Known extends object> = {
  /**
   * The name the event catalog gives the step.
   */
  readonly step: string;
  /**
   * The choice the step settled, as properties. Only enums, booleans and
   * counts: never an entered value.
   */
  readonly choice?: (known: Known) => Properties;
};

/**
 * What a flow is told when it is set up.
 *
 * @typeParam Known - What a run knows as its steps finish.
 */
export type FlowOptions<Known extends object> = {
  /**
   * The flow's name in the event catalog.
   */
  readonly flow: string;
  /**
   * How each step is reported, by the step's key. A step that is not here is
   * not reported.
   */
  readonly steps: Readonly<Record<string, FlowStep<Known>>>;
  /**
   * The names a failure is reported under for steps that are never reported
   * as completed, by the step's key, such as the checks before the first
   * question.
   */
  readonly failures?: Readonly<Record<string, string>>;
  /**
   * The key of the step whose finishing means the flow succeeded. A run that
   * ends before it, such as one that finds the work already done, never
   * completes.
   */
  readonly completesAt: string;
  /**
   * The step a failure is reported under when the step that failed is not in
   * `steps`.
   */
  readonly otherwise: string;
  /**
   * Whether the run changes nothing, so that finishing it is not a success
   * worth counting.
   */
  readonly preview: () => boolean;
  /**
   * Sends one event with the run's common properties.
   */
  readonly send: (event: string, properties: Properties) => void;
  /**
   * The time in milliseconds. Defaults to the clock.
   */
  readonly now?: () => number;
};

/**
 * Turns what a wizard run reports about itself into the flow events of the
 * event catalog, so no step knows about telemetry.
 *
 * @remarks
 * The wizard engine calls {@link FlowTelemetry.watcher} as the steps run. This
 * class only reads that and sends: it never changes what the run does, and it
 * never throws, so a failure to record cannot fail a command. Whether anything
 * leaves the machine is the sender's to decide, and that is the opt-out gate.
 *
 * @typeParam Known - What a run knows as its steps finish.
 */
export class FlowTelemetry<Known extends object> {
  private readonly options: FlowOptions<Known>;
  private beganAt = 0;
  private facts: Properties = {};
  private ended = false;

  /**
   * Set up the reporting of one run of a flow.
   *
   * @param options - What the flow is and how to send.
   */
  constructor(options: FlowOptions<Known>) {
    this.options = options;
  }

  /**
   * Report that the flow began, before its first step.
   *
   * @param properties - What is known already.
   */
  begin(properties: Properties = {}): void {
    this.beganAt = this.clock();
    this.facts = { ...properties };
    this.send(FLOW_STARTED, { flow: this.options.flow, ...this.facts });
  }

  /**
   * What to give the wizard run, so its steps are reported as they go.
   */
  get watcher(): {
    readonly finished: (key: string, known: object) => void;
    readonly failed: (key: string, error: unknown) => void;
  } {
    return {
      finished: (key, known) => {
        this.finished(key, known as Known);
      },
      failed: (key, error) => {
        this.failed(key, error);
      },
    };
  }

  private finished(key: string, known: Known): void {
    const reported = this.options.steps[key];
    if (reported !== undefined) {
      const choice = this.choiceOf(reported, known);
      this.facts = { ...this.facts, ...choice };
      this.send(FLOW_STEP_COMPLETED, { flow: this.options.flow, step: reported.step, ...choice });
    }
    if (key === this.options.completesAt && !this.options.preview()) {
      this.ended = true;
      this.send(FLOW_COMPLETED, {
        flow: this.options.flow,
        ...this.facts,
        duration_ms: this.clock() - this.beganAt,
      });
    }
  }

  private failed(key: string, error: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.send(FLOW_FAILED, {
      flow: this.options.flow,
      step:
        this.options.steps[key]?.step ?? this.options.failures?.[key] ?? this.options.otherwise,
      ...this.facts,
      reason: error instanceof ZitadelError ? error.code : undefined,
      duration_ms: this.clock() - this.beganAt,
    });
  }

  private clock(): number {
    return (this.options.now ?? Date.now)();
  }

  private choiceOf(reported: FlowStep<Known>, known: Known): Properties {
    try {
      return reported.choice?.(known) ?? {};
    } catch {
      return {};
    }
  }

  private send(event: string, properties: Properties): void {
    try {
      this.options.send(event, properties);
    } catch {
      // Recording never fails a command.
    }
  }
}
