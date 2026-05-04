/**
 * Pluggable Flow API transport.
 *
 * The orchestrator never reaches `fetch` directly. Tests and the dev
 * playground swap in {@link FixtureTransport}; real apps construct
 * {@link FetchTransport} pointed at a Zitadel instance. Once
 * `@zitadel-nextgen/api` ships, a typed transport will replace this stand-in.
 */
import type { Branding, FlowResponse, FlowStep, FlowSubmitInput } from "./types.js";

export type StartInput = {
  purpose: string;
  project_id?: string;
  issuer?: string;
};

export interface FlowTransport {
  start(input: StartInput): Promise<FlowResponse>;
  submit(input: FlowSubmitInput): Promise<FlowResponse>;
}

export type FetchTransportOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
};

export class FlowTransportError extends Error {
  readonly status: number;

  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FlowTransportError";
    this.status = status;
    this.body = body;
  }
}

export class FetchTransport implements FlowTransport {
  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  private readonly headers: Record<string, string>;

  constructor(options: FetchTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.headers = {
      "content-type": "application/json",
      accept: "application/json",
      ...(options.headers ?? {}),
    };
  }

  async start(input: StartInput): Promise<FlowResponse> {
    return this.request<FlowResponse>("POST", "/flows", input);
  }

  async submit(input: FlowSubmitInput): Promise<FlowResponse> {
    return this.request<FlowResponse>(
      "POST",
      `/flows/${encodeURIComponent(input.session_id)}/submit`,
      {
        session_token: input.session_token,
        payload: input.payload,
      },
    );
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new FlowTransportError(
        `Flow API ${method} ${path} failed (${response.status})`,
        response.status,
        parsed,
      );
    }
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type FixtureScript = {
  start: FlowResponse;
  submit?: ReadonlyArray<(input: FlowSubmitInput) => FlowResponse | Promise<FlowResponse>>;
};

/**
 * Dev/test transport. Plays back canned step responses in the order they
 * appear in {@link FixtureScript.submit}. After the script is exhausted the
 * last response is replayed so the UI never crashes mid-demo.
 */
export class FixtureTransport implements FlowTransport {
  private readonly script: FixtureScript;

  private cursor = 0;

  constructor(script: FixtureScript) {
    this.script = script;
  }

  async start(): Promise<FlowResponse> {
    this.cursor = 0;
    return this.script.start;
  }

  async submit(input: FlowSubmitInput): Promise<FlowResponse> {
    const handler = this.script.submit?.[this.cursor];
    if (!handler) {
      return this.script.start;
    }
    this.cursor += 1;
    return await handler(input);
  }
}

/**
 * A {@link FlowDefinitionStep}'s transition target. String targets name
 * another step in the same flow; object targets (`switch` / `pivot`) hop into
 * a different flow and are treated as terminals here.
 */
export type FlowTransitionTarget = string | { switch: string } | { pivot: string };

/**
 * Flow graph shape consumed by {@link WalkingFixtureTransport}. Compatible
 * with the JSON definitions used by `docs/design/flowengine/visualizer.html`.
 */
export type FlowDefinition = {
  name?: string;
  purposes?: ReadonlyArray<string>;
  initial_steps: Record<string, string>;
  steps: ReadonlyArray<FlowDefinitionStep>;
};

export type FlowDefinitionStep = FlowStep & {
  transitions?: Record<string, FlowTransitionTarget>;
  /** Marker types the walker treats as non-visible and skips through. */
  behavior?: string;
};

export type WalkingFixtureOptions = {
  flow: FlowDefinition;
  /**
   * Initial purpose used to look up the entry step in
   * {@link FlowDefinition.initial_steps}. Defaults to the first key.
   */
  purpose?: string;
  /** Branding payload attached to every response. */
  branding?: Branding;
  /**
   * Optional hook to enrich the resolved step before it is returned (e.g.
   * attach `identity` after the user has typed their email). The walker
   * calls this once per `start` / `submit`.
   */
  decorate?: (
    step: FlowDefinitionStep,
    context: { previousStep: FlowDefinitionStep | null; payload: Record<string, unknown> },
  ) => FlowStep;
};

const INVISIBLE_STEP_TYPES = new Set(["policy_check", "action"]);
const MAX_TRANSITION_HOPS = 16;

/**
 * Dev/test transport that walks a {@link FlowDefinition} via
 * `step.transitions`. Used to drive the dev playground and the visualizer's
 * "Real components" tab end-to-end without a backend.
 *
 * Behaviour:
 *
 * - `start({ purpose })` finds `flow.initial_steps[purpose]` (or the first
 *   entry) and walks through any `policy_check` / `action` nodes to the next
 *   visible step.
 * - `submit({ payload: { action, ... } })` looks up the current step's
 *   `transitions[action]`, falling back to `transitions.submit`, then walks
 *   through invisible nodes.
 * - When a transition target is missing, unknown, or an object (`switch` /
 *   `pivot` into another flow), the walker stops and replays the current
 *   step. The orchestrator keeps rendering instead of crashing mid-demo.
 *
 * `switch` / `pivot` targets and missing flows are intentionally not
 * resolved here — that would require a multi-flow registry which doesn't
 * belong in a fixture transport. Use the real Flow API for that.
 */
export class WalkingFixtureTransport implements FlowTransport {
  private readonly flow: FlowDefinition;

  private readonly stepByName: Map<string, FlowDefinitionStep>;

  private readonly branding: Branding | undefined;

  private readonly decorate: WalkingFixtureOptions["decorate"];

  private currentPurpose: string;

  private currentStep: FlowDefinitionStep | null = null;

  constructor(options: WalkingFixtureOptions) {
    this.flow = options.flow;
    this.branding = options.branding;
    this.decorate = options.decorate;
    this.stepByName = new Map(options.flow.steps.map((step) => [step.name, step]));
    this.currentPurpose = options.purpose ?? Object.keys(options.flow.initial_steps)[0] ?? "login";
  }

  async start(input: StartInput): Promise<FlowResponse> {
    this.currentPurpose = input.purpose || this.currentPurpose;
    const entryName =
      this.flow.initial_steps[this.currentPurpose] ??
      Object.values(this.flow.initial_steps)[0] ??
      this.flow.steps[0]?.name;
    const entry = entryName ? this.stepByName.get(entryName) : undefined;
    const visible = entry ? this.walkToVisible(entry, MAX_TRANSITION_HOPS) : null;
    return this.buildResponse(visible, null, {});
  }

  async submit(input: FlowSubmitInput): Promise<FlowResponse> {
    const previous = this.currentStep;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const action = typeof payload.action === "string" && payload.action ? payload.action : null;
    const transitions = previous?.transitions ?? {};
    // If the orchestrator gave us an explicit action, only follow that key.
    // Fall back to `submit` only when no action was sent (e.g. <zl-submit>
    // without an `action` attribute).
    const target = action ? transitions[action] : transitions["submit"];

    if (!previous || typeof target !== "string") {
      // Unknown actions, object targets (switch/pivot), and missing
      // transitions all stop here so the UI never crashes mid-demo.
      return this.buildResponse(previous, previous, payload);
    }

    const next = this.stepByName.get(target);
    if (!next) {
      return this.buildResponse(previous, previous, payload);
    }
    const visible = this.walkToVisible(next, MAX_TRANSITION_HOPS);
    return this.buildResponse(visible, previous, payload);
  }

  private walkToVisible(step: FlowDefinitionStep, hopsLeft: number): FlowDefinitionStep | null {
    if (hopsLeft < 0) return null;
    if (!INVISIBLE_STEP_TYPES.has(step.type)) {
      return step;
    }
    const transitions = step.transitions ?? {};
    for (const target of Object.values(transitions)) {
      if (typeof target !== "string") continue;
      const next = this.stepByName.get(target);
      if (!next) continue;
      const visible = this.walkToVisible(next, hopsLeft - 1);
      if (visible) return visible;
    }
    return null;
  }

  private buildResponse(
    step: FlowDefinitionStep | null,
    previous: FlowDefinitionStep | null,
    payload: Record<string, unknown>,
  ): FlowResponse {
    this.currentStep = step;
    const fallback: FlowStep = step ?? this.fallbackStep();
    const decorated = step && this.decorate ? this.decorate(step, { previousStep: previous, payload }) : fallback;
    return {
      session_id: "sess_walking",
      session_token: "tok_walking",
      step: decorated,
      ...(this.branding ? { branding: this.branding } : {}),
    };
  }

  private fallbackStep(): FlowStep {
    return {
      name: "missing",
      type: "complete",
      texts: { title_key: "complete.title" },
    };
  }
}
