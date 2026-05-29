import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MANAGED_MARKER } from "../../../lib/paths";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies the generated Next middleware still carries the managed marker. */
export class ManagedMiddlewareCheck extends AbstractSanityCheck {
  readonly name = "managed-middleware";
  readonly path = "middleware.ts";
  protected readonly summary = "Next middleware.ts contains Zitadel managed marker";

  protected async verify(ctx: CheckContext): Promise<void> {
    const candidates = ["middleware.ts", "src/middleware.ts"];
    for (const candidate of candidates) {
      try {
        const contents = await readFile(join(ctx.cwd, candidate), "utf8");
        if (!contents.includes(MANAGED_MARKER)) {
          throw new Error(`${candidate} is missing managed marker`);
        }
        return;
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
      }
    }
    throw new Error(`missing one of ${candidates.join(", ")}`);
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
