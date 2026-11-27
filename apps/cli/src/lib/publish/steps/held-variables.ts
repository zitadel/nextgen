import { BackendForbiddenError, type VariableService } from "@/lib/backend";
import type { PipelineMode, StepContext } from "@/lib/publish/pipeline";

/**
 * The kind of variable each publish freezes, with no fallback from one to the
 * other (ADR 069).
 */
const VARIABLE_KIND = {
  deploy: "primary",
  preview: "preview",
} as const satisfies Record<PipelineMode, Parameters<VariableService["heldByName"]>[0]>;

/**
 * The read of each run's variables, so the checks that need them share one
 * request.
 */
const READS = new WeakMap<StepContext, Promise<ReadonlyMap<string, boolean> | undefined>>();

/**
 * The variables the deploy would freeze, by name, and whether each is a secret.
 *
 * @remarks
 * The primary kind's for a deploy and the preview kind's for a preview, with
 * no fallback from one to the other (ADR 069). A preview's token may not read
 * them, which leaves the check to the deploy that merges it. They are read
 * once per run: every later call with the same context gets the same answer.
 *
 * @param ctx - The step's context.
 * @returns Each variable's name and whether it is a secret, or `undefined`
 *   when a preview's token may not read them.
 * @throws {@link BackendForbiddenError} When a deploy's token may not read them.
 */
export async function heldVariables(
  ctx: StepContext,
): Promise<ReadonlyMap<string, boolean> | undefined> {
  const read =
    READS.get(ctx) ??
    ctx.variables.heldByName(VARIABLE_KIND[ctx.mode]).catch((error: unknown) => {
      if (ctx.mode === "preview" && error instanceof BackendForbiddenError) {
        return undefined;
      }
      throw error;
    });
  READS.set(ctx, read);
  return read;
}
