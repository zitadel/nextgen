import { ZitadelError } from "@/lib/errors";
import type { Notes, Report } from "@/lib/oclif/events";
import type { GlobalOptions } from "@/lib/oclif/types";

import type { Announcement } from "./announcement";

/**
 * What a command's own logic says about a run as it is announced: the events
 * to send, if any, for this announcement. It is made fresh for every run, so
 * it may remember what it has seen.
 */
export type Follow = (announcement: Announcement) => readonly Report[];

/**
 * What a command declares about how its run is followed. It sits next to the
 * command, which is the only place that knows what its run means.
 */
export type Observation = Readonly<{
  /**
   * The one fact of its own that this command's copy for the hosted analytics
   * intake keeps, when it has one.
   */
  headline?: string;
  /**
   * Makes the command's own logic for one run.
   */
  follow?: () => Follow;
}>;

/**
 * Read what a command declared, whatever it declared.
 *
 * @param raw - The command's declaration, if it made one.
 * @returns What it declared, or nothing.
 */
export function readObservation(raw: unknown): Observation {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const declared = raw as Observation;

  return {
    headline: typeof declared.headline === "string" ? declared.headline : undefined,
    follow: typeof declared.follow === "function" ? declared.follow : undefined,
  };
}

/**
 * What an action is, which may depend on the command that ran it.
 */
type Subject = Notes | ((meta: GlobalOptions) => Notes);

/**
 * The command's action: one `action_completed` when it succeeds, or one
 * `action_failed` when it fails, never for a dry run or a result a person
 * declined. The facts the command's run announces along the way are added to
 * both.
 *
 * @param subject - What the action is: `action` and `resource_type`, and anything fixed.
 * @param facts - What an announcement of the run says about the action, if anything.
 * @returns The command's own logic.
 */
export function action(
  subject: Subject,
  facts: (announcement: Announcement) => Notes | undefined = () => undefined,
): () => Follow {
  return () => {
    const gathered: { facts: Notes } = { facts: {} };

    return (announcement) => {
      gathered.facts = { ...gathered.facts, ...facts(announcement) };
      if (announcement.channel !== "command") {
        return [];
      }
      const event = announcement.event;
      if (event.phase !== "completed" && event.phase !== "failed") {
        return [];
      }
      if (event.meta.dryRun || (event.phase === "completed" && event.status !== "ok")) {
        return [];
      }
      const what = typeof subject === "function" ? subject(event.meta) : subject;

      return [
        {
          name: event.phase === "completed" ? "action_completed" : "action_failed",
          facts: {
            ...gathered.facts,
            ...what,
            reason: event.phase === "failed" ? event.code : undefined,
            duration_ms: Date.now() - event.startedAt,
          },
        },
      ];
    };
  };
}

/**
 * The action of a generated resource command, named by the command that ran:
 * `<resource>:<verb>` is the resource acted on and what was done to it.
 *
 * @param facts - What an announcement of the run says about the action, if anything.
 * @returns The command's own logic.
 */
export function crudAction(
  facts?: (announcement: Announcement) => Notes | undefined,
): () => Follow {
  return action((meta) => {
    const [resource, verb] = meta.command.split(":");

    return { action: verb, resource_type: resource };
  }, facts);
}

/**
 * What a flow is.
 */
type FlowSpec = Readonly<{
  /**
   * The flow's name.
   */
  flow: string;
  /**
   * What is known about every event of the flow from the start.
   */
  with?: Notes;
  /**
   * The step a failure is reported under when the step that failed names none.
   */
  otherwise?: string;
}>;

/**
 * The command's wizard as a flow: it starts with the first step, reports each
 * step that names itself and settles a choice, and ends once, completed or
 * failed. A wizard that ends early, or runs as a dry run, never completes.
 * Everything comes from what the steps declare about themselves.
 *
 * @param spec - What the flow is called and what is known about it.
 * @returns The command's own logic.
 */
export function flow(spec: FlowSpec): () => Follow {
  return () => {
    const state = {
      began: undefined as number | undefined,
      facts: { ...spec.with } as Notes,
      meta: undefined as GlobalOptions | undefined,
      step: undefined as string | undefined,
      viewed: new Set<string>(),
      over: false,
    };
    const duration = (): number => {
      return Date.now() - (state.began ?? Date.now());
    };

    return (announcement) => {
      if (announcement.channel === "command") {
        if (announcement.event.phase === "opened") {
          state.meta = announcement.event.meta;
        }
        return [];
      }
      if (announcement.channel === "prompt") {
        const step = state.step;
        if (step === undefined || state.viewed.has(step)) {
          return [];
        }
        state.viewed.add(step);

        return [{ name: "viewed_step", facts: { flow: spec.flow, step } }];
      }
      if (announcement.channel !== "wizard" || state.over) {
        return [];
      }
      const event = announcement.event;
      const reports: Report[] = [];
      if (state.began === undefined) {
        state.began = Date.now();
        reports.push({ name: "flow_started", facts: { flow: spec.flow, ...state.facts } });
      }
      if (event.phase === "started") {
        state.step = event.milestone;
      } else if (event.phase === "finished") {
        state.facts = { ...state.facts, ...(event.facts as Notes | undefined) };
        if (event.milestone !== undefined && event.facts !== undefined) {
          reports.push({
            name: "step_completed",
            facts: { flow: spec.flow, step: event.milestone, ...(event.facts as Notes) },
          });
        }
      } else if (event.phase === "completed") {
        state.over = true;
        if (state.meta?.dryRun !== true) {
          reports.push({
            name: "flow_completed",
            facts: { flow: spec.flow, ...state.facts, duration_ms: duration() },
          });
        }
      } else if (event.phase === "ended") {
        state.over = true;
      } else {
        state.over = true;
        reports.push({
          name: "flow_failed",
          facts: {
            flow: spec.flow,
            step: event.milestone ?? spec.otherwise,
            ...state.facts,
            reason: event.error instanceof ZitadelError ? event.error.code : undefined,
            duration_ms: duration(),
          },
        });
      }

      return reports;
    };
  };
}

/**
 * Several pieces of a command's own logic as one.
 *
 * @param parts - The pieces.
 * @returns The command's own logic.
 */
export function together(...parts: readonly (() => Follow)[]): () => Follow {
  return () => {
    const made = parts.map((part) => {
      return part();
    });

    return (announcement) => {
      return made.flatMap((follow) => {
        return follow(announcement);
      });
    };
  };
}
