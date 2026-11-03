import type { Connection } from "../../src/lib/oclif/types";
import type { RequirementContext } from "../../src/lib/oclif/requirements";

/** A requirement's inputs, with a meta holding only what the requirement reads. */
export function requirementContext(
  input: {
    flags?: Record<string, unknown>;
    args?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    argv?: readonly string[];
    resolved?: Record<string, unknown>;
    connect?: () => Promise<Connection>;
  } = {},
): RequirementContext {
  return {
    flags: input.flags ?? {},
    args: input.args ?? {},
    argv: input.argv ?? [],
    meta: (input.meta ?? {}) as never,
    connect: input.connect ?? (() => Promise.reject(new Error("no connection"))),
    suggest: (command: string) => command as never,
    resolved: input.resolved ?? {},
  };
}
