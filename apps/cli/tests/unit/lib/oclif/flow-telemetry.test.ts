import { describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { FlowTelemetry } from "@/lib/oclif/flow-telemetry";
import type { Properties } from "@/lib/telemetry";

type Known = { readonly answer?: string };

type Sent = { readonly event: string; readonly properties: Properties };

/**
 * A flow over three steps, the second of which settles a choice, with a clock
 * that moves 10 ms every time it is read.
 */
function flowOf(overrides: { preview?: boolean; sent?: Sent[]; throws?: boolean } = {}) {
  const sent = overrides.sent ?? [];
  const ticks = { now: 0 };
  const flow = new FlowTelemetry<Known>({
    flow: "onboarding",
    steps: {
      first: { step: "framework_selection" },
      second: {
        step: "preset_selection",
        choice: ({ answer }) => {
          if (overrides.throws === true) {
            throw new Error("bad choice");
          }
          return { preset: answer };
        },
      },
    },
    failures: { checks: "initial_checks" },
    completesAt: "last",
    otherwise: "application_setup",
    preview: () => {
      return overrides.preview === true;
    },
    send: (event, properties) => {
      sent.push({ event, properties });
    },
    now: () => {
      ticks.now += 10;
      return ticks.now;
    },
  });
  return { flow, sent };
}

describe("FlowTelemetry", () => {
  it("reports a run that completes as start, each reported step, then completion with its choices", () => {
    const { flow, sent } = flowOf();

    flow.begin();
    flow.watcher.finished("first", {});
    flow.watcher.finished("second", { answer: "email" });
    flow.watcher.finished("unreported", {});
    flow.watcher.finished("last", { answer: "email" });

    expect(sent).toEqual([
      { event: "flow_started", properties: { flow: "onboarding" } },
      { event: "step_completed", properties: { flow: "onboarding", step: "framework_selection" } },
      {
        event: "step_completed",
        properties: { flow: "onboarding", step: "preset_selection", preset: "email" },
      },
      {
        event: "flow_completed",
        properties: { flow: "onboarding", preset: "email", duration_ms: 10 },
      },
    ]);
  });

  it("reports a failure under the step that failed, with the choices so far and the error code", () => {
    const { flow, sent } = flowOf();

    flow.begin();
    flow.watcher.finished("second", { answer: "email" });
    flow.watcher.failed("first", new ZitadelError("E_NETWORK", "offline"));

    expect(sent.at(-1)).toEqual({
      event: "flow_failed",
      properties: {
        flow: "onboarding",
        step: "framework_selection",
        preset: "email",
        reason: "E_NETWORK",
        duration_ms: 10,
      },
    });
  });

  it("reports a failure before the questions as an initial check", () => {
    const { flow, sent } = flowOf();

    flow.begin();
    flow.watcher.failed("checks", new Error("no"));

    expect(sent.at(-1)?.properties).toMatchObject({ step: "initial_checks" });
  });

  it("reports a failure of any other step as the application setup, without an error code for a plain error", () => {
    const { flow, sent } = flowOf();

    flow.begin();
    flow.watcher.failed("install", new Error("no"));

    expect(sent.at(-1)?.properties).toMatchObject({
      step: "application_setup",
      reason: undefined,
    });
  });

  it("does not count the finish of a run that changes nothing", () => {
    const { flow, sent } = flowOf({ preview: true });

    flow.begin();
    flow.watcher.finished("last", {});

    expect(sent.map(({ event }) => event)).toEqual(["flow_started"]);
  });

  it("reports one ending per run", () => {
    const { flow, sent } = flowOf();

    flow.begin();
    flow.watcher.finished("last", {});
    flow.watcher.failed("last", new Error("later"));

    expect(sent.map(({ event }) => event)).toEqual(["flow_started", "flow_completed"]);
  });

  it("never fails the run when a choice cannot be read", () => {
    const { flow, sent } = flowOf({ throws: true });

    flow.begin();

    expect(() => {
      flow.watcher.finished("second", { answer: "x" });
    }).not.toThrow();
    expect(sent.at(-1)).toEqual({
      event: "step_completed",
      properties: { flow: "onboarding", step: "preset_selection" },
    });
  });

  it("never fails the run when the sender throws", () => {
    const flow = new FlowTelemetry<Known>({
      flow: "onboarding",
      steps: {},
      completesAt: "last",
      otherwise: "application_setup",
      preview: () => {
        return false;
      },
      send: () => {
        throw new Error("down");
      },
    });

    expect(() => {
      flow.begin();
      flow.watcher.finished("last", {});
    }).not.toThrow();
  });

  it("carries the choice of a step with no name onto the ending, without a step event", () => {
    const sent: Sent[] = [];
    const flow = new FlowTelemetry<Known>({
      flow: "oidc_provider_setup",
      steps: {
        picked: {
          choice: ({ answer }) => {
            return { provider_type: answer };
          },
        },
      },
      completesAt: "last",
      preview: () => {
        return false;
      },
      send: (event, properties) => {
        sent.push({ event, properties });
      },
      now: () => {
        return 0;
      },
    });

    flow.begin({ entry_point: "standalone" });
    flow.watcher.finished("picked", { answer: "google" });
    flow.watcher.failed("later", new Error("no"));

    expect(sent).toEqual([
      {
        event: "flow_started",
        properties: { flow: "oidc_provider_setup", entry_point: "standalone" },
      },
      {
        event: "flow_failed",
        properties: {
          flow: "oidc_provider_setup",
          entry_point: "standalone",
          provider_type: "google",
          step: undefined,
          reason: undefined,
          duration_ms: 0,
        },
      },
    ]);
  });


  it("reports a prompt once for the step that is running, under its own or its prompt name", () => {
    const sent: Sent[] = [];
    const flow = new FlowTelemetry<Known>({
      flow: "onboarding",
      steps: { second: { step: "preset_selection" } },
      viewed: { confirm: "framework_selection" },
      completesAt: "last",
      preview: () => {
        return false;
      },
      send: (event, properties) => {
        sent.push({ event, properties });
      },
    });

    flow.prompted();
    flow.watcher.started("second");
    flow.prompted();
    flow.prompted();
    flow.watcher.started("confirm");
    flow.prompted();
    flow.watcher.started("unnamed");
    flow.prompted();

    expect(sent).toEqual([
      { event: "viewed_step", properties: { flow: "onboarding", step: "preset_selection" } },
      { event: "viewed_step", properties: { flow: "onboarding", step: "framework_selection" } },
    ]);
  });
});
