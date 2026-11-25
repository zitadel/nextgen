import { ForbiddenError, type VariableService } from "@/lib/backend";
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
 * The variables the deploy would freeze, by name, and whether each is a secret.
 *
 * @remarks
 * The primary kind's for a deploy and the preview kind's for a preview, with
 * no fallback from one to the other (ADR 069). A preview's token may not read
 * them, which leaves the check to the deploy that merges it.
 *
 * @param ctx - The step's context.
 * @returns Each variable's name and whether it is a secret, or `undefined`
 *   when a preview's token may not read them.
 * @throws {@link ForbiddenError} When a deploy's token may not read them.
 */
export async function heldVariables(
  ctx: StepContext,
): Promise<ReadonlyMap<string, boolean> | undefined> {
  try {
    return await ctx.variables.heldByName(VARIABLE_KIND[ctx.mode]);
  } catch (error) {
    if (ctx.mode === "preview" && error instanceof ForbiddenError) {
      return undefined;
    }
    throw error;
  }
}
