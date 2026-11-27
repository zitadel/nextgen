import { createHash, randomUUID } from "node:crypto";

import { Flags } from "@oclif/core";

import { toZitadelError } from "@/lib/errors";
import type { BaseCommand, Facts, MetaOptions } from "@/cli/core/base";
import type { CommandClass } from "@/lib/oclif/command-class";
import type { CommandResult, JsonEnvelope } from "@/cli/core";
import type { GlobalOptions } from "@/cli/core/types";
import { Telemetry, type TelemetryDeps } from "@/lib/telemetry";
import { DO_NOT_TRACK, ZITADEL_TELEMETRY } from "@/lib/telemetry/consent";
import { markNoticed, profileDue } from "@/lib/telemetry/identity";
import type { RunWatcher } from "@/lib/wizard";

import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
  firstSeenProperties,
  FIRST_RUN_NOTICE,
  serverKindOf,
  vercelEventKeys,
} from "./properties";

/**
 * `--telemetry`: the one flag every command that reports takes, declared once
 * so every command carries the same one.
 */
export const TELEMETRY_FLAG = Flags.boolean({
  default: true,
  allowNo: true,
  description: "Send anonymous usage analytics. Disable with --no-telemetry.",
});

/**
 * The events of a flow go to Mixpanel only; the three lifecycle events go
 * everywhere, as the hosted intake's copy is for them alone.
 */
const FLOW_DESTINATIONS = ["mixpanel"] as const;

/**
 * How a wizard command names its steps for reports of the flow.
 */
export type FlowReport = Readonly<{
  /**
   * The flow's name in the event catalog.
   */
  flow: string;
  /**
   * What is known about every event of the flow from the start.
   */
  with?: Facts;
  /**
   * The step a failure is reported under when the step that failed has no name
   * of its own.
   */
  otherwise?: string;
  /**
   * Names a step and, once it has finished, says what it settled.
   *
   * @param key - The step's name in the wizard.
   * @param known - What is known once the step finished; absent while it is only starting.
   * @returns The step's name in the catalog, if it has one, and the choice it settled if
   *   it settled one; nothing for a step the flow knows nothing about. A choice with no
   *   name still goes on the flow's ending.
   */
  step(key: string, known?: object): Readonly<{ step?: string; choice?: Facts }> | undefined;
}>;

/**
 * Marks a command that reports on its own run, and gives it the one way to:
 * the three events every command has, and a wizard's flow.
 *
 * ```ts
 * export default class Origins extends Telemetered(ServerCommand(EnvironmentCommand)) {}
 * ```
 *
 * @remarks
 * A command without it sends nothing, and the base command knows nothing of it.
 * A command adds what it knows about its run by overriding `describe()`, which
 * is asked once the run is over, and notes what it learns on the way with
 * {@link annotate}. A wizard command passes {@link watchWizard} to the wizard it
 * runs. Telemetry never writes to stdout and never fails a command.
 *
 * @param Base - The command class to extend.
 * @returns The class, reporting on its run.
 */
export function Telemetered<
  TBase extends CommandClass<BaseCommand> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(Base: TBase) {
  abstract class Reporting extends Base {
    // oclif reads a command's statics up the chain of classes only while each
    // declares a static of its own, so this mixin declares the ones it passes on.
    static override baseFlags = { ...Base.baseFlags, telemetry: TELEMETRY_FLAG };
    static override enableJsonFlag = Base.enableJsonFlag;

    /**
     * The environment variables that set what `--telemetry` sets, for the CLI reference.
     */
    static readonly flagVariables = [DO_NOT_TRACK, ZITADEL_TELEMETRY];

    /**
     * The one fact of its own that this command's copy for the hosted analytics
     * intake keeps, when it has one.
     */
    static readonly headline: string | undefined = undefined;

    private reportClient: Telemetry | undefined;
    private readonly reportInvocationId = randomUUID();
    private readonly reportStartedAt = Date.now();
    private reportNotes: Facts = Object.freeze({});
    private reportFlow:
      | {
          readonly report: FlowReport;
          began: number | undefined;
          facts: Facts;
          step: string | undefined;
          readonly viewed: Set<string>;
          over: boolean;
        }
      | undefined;

    /**
     * Note facts about this run as it learns them, merged immutably into what
     * is sent with its outcome.
     *
     * @param patch - The facts to add or replace.
     */
    protected annotate(patch: Facts): void {
      this.reportNotes = Object.freeze({ ...this.reportNotes, ...patch });
    }

    /**
     * Sends a product event the catalog lists for the CLI, with the header and
     * context every CLI event carries, to every destination the catalog names.
     * Only for an event an ADR names; a command's own facts are dimensions
     * ({@link annotate}, `describe()`).
     *
     * @param event - The event's name in the catalog.
     * @param properties - The event's properties.
     */
    protected trackEvent(event: string, properties: Facts): void {
      this.reportGuard(() => {
        this.reportTrack(event, properties);
      });
    }

    /**
     * Telemetry factory seam. Production returns the real {@link Telemetry.create};
     * tests override it to inject a recording client.
     *
     * @param deps - What the client is made from.
     * @returns The client.
     */
    protected createTelemetry(deps: TelemetryDeps): Telemetry {
      return Telemetry.create(deps);
    }

    /**
     * What a wizard command gives the wizard it runs, so the wizard's steps are
     * reported as a flow: it starts with the first step, reports each step that
     * has a name and settled a choice, and ends once, completed or failed. A
     * wizard that ends early, or runs as a dry run, never completes.
     *
     * @param report - What the flow is called and how its steps are named.
     * @returns The watcher to pass as the wizard's `watch`.
     */
    protected watchWizard(report: FlowReport): RunWatcher {
      this.reportFlow = {
        report,
        began: undefined,
        facts: { ...report.with },
        step: undefined,
        viewed: new Set<string>(),
        over: false,
      };

      return {
        started: (key) => {
          this.reportGuard(() => {
            this.reportFlowStarted(key);
          });
        },
        finished: (key, known) => {
          this.reportGuard(() => {
            this.reportFlowFinished(key, known);
          });
        },
        failed: (key, error) => {
          this.reportGuard(() => {
            this.reportFlowFailed(key, error);
          });
        },
        ended: () => {
          this.reportGuard(() => {
            this.reportFlowEnded();
          });
        },
        completed: () => {
          this.reportGuard(() => {
            this.reportFlowCompleted();
          });
        },
      };
    }

    /**
     * Opens the run's reporting once its context is settled.
     */
    protected override async toMeta(
      given: Record<string, unknown>,
      options?: MetaOptions,
    ): Promise<GlobalOptions> {
      const meta = await super.toMeta(given, options);
      this.reportGuard(() => {
        this.reportBegin(typeof given.telemetry === "boolean" ? given.telemetry : undefined, true);
        this.ui.onPrompt(() => {
          this.reportGuard(() => {
            this.reportPrompted();
          });
        });
      });

      return meta;
    }

    /**
     * Reports the run as completed with its result.
     */
    protected override emit(result: CommandResult): JsonEnvelope {
      this.reportGuard(() => {
        this.reportTrack(CLI_COMMAND_COMPLETED, {
          ...this.reportNotes,
          ...this.reportFacts(),
          status: result.status,
          duration_ms: Date.now() - this.reportStartedAt,
        });
      });

      return super.emit(result);
    }

    /**
     * Reports the run as failed, even when it failed before its context was
     * settled, in which case `--no-telemetry` is read from the command line.
     */
    protected override async catch(error: unknown): Promise<never> {
      try {
        return await super.catch.call(this, error);
      } finally {
        this.reportGuard(() => {
          this.reportBegin(this.argv.includes("--no-telemetry") ? false : undefined, false);
          const failure = this.failed ?? toZitadelError(error);
          this.reportTrack(CLI_COMMAND_FAILED, {
            ...this.reportNotes,
            ...this.reportFacts(),
            status: "error",
            reason: failure.code,
            exit_code: failure.exitCode,
            duration_ms: Date.now() - this.reportStartedAt,
          });
        });
      }
    }

    /**
     * Sends what is still unsent before the process ends, once the command's
     * own cleanup (the interrupt listener, the narration) is done.
     *
     * @remarks
     * The flush is bounded, so a hung or firewalled network adds at most about
     * a second. `mixpanel` keeps its sockets alive and exposes no handle, so a
     * finished request would hold Node's event loop open past the await; an
     * unref'd watchdog force-exits with the resolved code once the grace has
     * passed.
     */
    protected override async finally(error: Error | undefined): Promise<void> {
      await super.finally(error);
      try {
        await this.reportClient?.shutdown(1000);
      } catch {
        // A safety net: flushing reports must never fail a run that finished.
      }
      if (this.reportClient?.enabled) {
        this.armExitWatchdog();
      }
    }

    /**
     * Forces the process to end with the resolved code if a telemetry socket
     * still holds the event loop open shortly after the run is over.
     */
    protected armExitWatchdog(): void {
      setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
    }

    private reportBegin(reporting: boolean | undefined, resolved: boolean): void {
      if (this.reportClient !== undefined) {
        return;
      }
      const client = this.createTelemetry({
        env: this.env,
        flag: reporting,
        debug: this.meta.debug,
        vercelKeys: vercelEventKeys((this.constructor as typeof Reporting).headline),
      });
      this.reportClient = client;
      if (!client.enabled) {
        return;
      }
      // The notice comes before the first send, and until a run that can show
      // it has, every run is the first.
      if (client.isFirstRun && resolved && !this.nonInteractive && markNoticed(this.env)) {
        this.logToStderr(FIRST_RUN_NOTICE);
      }
      this.reportTrack(CLI_COMMAND_STARTED, { ...this.reportNotes });
      this.reportProfile(client);
    }

    /**
     * Writes the install's profile when it is due: the first time, when what it
     * says changed (an upgrade, another Node), and at most once a day, which
     * keeps its "last seen" within a day of the install's last run.
     */
    private reportProfile(client: Telemetry): void {
      const facts = deviceProfileProperties(this.meta, client.distinctId);
      // What changes with the install, not with the run: the host and the package
      // manager differ between runs and would rewrite the profile on each.
      const hash = createHash("sha256")
        .update(JSON.stringify([facts.cli_version, facts.node_version, facts.os, facts.arch]))
        .digest("hex");
      const due = profileDue(this.env, hash, client.record, this.meta.cliVersion);
      if (due !== undefined) {
        client.profile(facts, { $ip: 0 }, firstSeenProperties(due.firstVersion));
      }
    }

    private reportFacts(): Facts {
      try {
        return this.describe();
      } catch {
        // A safety net: a run that failed before its flags were read has no facts
        // of its own, and reporting must never fail the run.
        return {};
      }
    }

    private reportTrack(
      name: string,
      facts: Facts,
      only?: readonly ("mixpanel" | "vercel")[],
    ): void {
      if (this.reportClient?.enabled !== true) {
        return;
      }
      this.reportClient.track(
        name,
        commandEventProperties(
          this.meta,
          serverKindOf(this.meta.source),
          this.reportInvocationId,
          facts,
        ),
        only,
      );
    }

    private reportGuard(work: () => void): void {
      try {
        work();
      } catch {
        // A safety net: reporting never changes what a command does.
      }
    }

    private reportFlowStarted(key: string): void {
      const flow = this.reportFlow;
      if (flow === undefined || flow.over) {
        return;
      }
      if (flow.began === undefined) {
        flow.began = Date.now();
        this.reportTrack(
          "flow_started",
          { flow: flow.report.flow, ...flow.facts },
          FLOW_DESTINATIONS,
        );
      }
      flow.step = flow.report.step(key)?.step;
    }

    private reportFlowFinished(key: string, known: object): void {
      const flow = this.reportFlow;
      const named = flow?.report.step(key, known);
      if (flow === undefined || flow.over || named === undefined) {
        return;
      }
      if (named.choice !== undefined) {
        flow.facts = { ...flow.facts, ...named.choice };
        if (named.step !== undefined) {
          this.reportTrack(
            "step_completed",
            { flow: flow.report.flow, step: named.step, ...named.choice },
            FLOW_DESTINATIONS,
          );
        }
      }
    }

    private reportFlowFailed(key: string, error: unknown): void {
      const flow = this.reportFlow;
      if (flow === undefined || flow.over) {
        return;
      }
      flow.over = true;
      this.reportTrack(
        "flow_failed",
        {
          flow: flow.report.flow,
          step: flow.report.step(key)?.step ?? flow.report.otherwise,
          ...flow.facts,
          reason: toZitadelError(error).code,
          duration_ms: Date.now() - (flow.began ?? Date.now()),
        },
        FLOW_DESTINATIONS,
      );
    }

    private reportFlowEnded(): void {
      if (this.reportFlow !== undefined) {
        this.reportFlow.over = true;
      }
    }

    private reportFlowCompleted(): void {
      const flow = this.reportFlow;
      if (flow === undefined || flow.over) {
        return;
      }
      flow.over = true;
      if (this.meta.dryRun) {
        return;
      }
      this.reportTrack(
        "flow_completed",
        {
          flow: flow.report.flow,
          ...flow.facts,
          duration_ms: Date.now() - (flow.began ?? Date.now()),
        },
        FLOW_DESTINATIONS,
      );
    }

    private reportPrompted(): void {
      const flow = this.reportFlow;
      const step = flow?.step;
      if (flow === undefined || step === undefined || flow.viewed.has(step)) {
        return;
      }
      flow.viewed.add(step);
      this.reportTrack("viewed_step", { flow: flow.report.flow, step }, FLOW_DESTINATIONS);
    }
  }

  return Reporting;
}
