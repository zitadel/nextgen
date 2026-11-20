import { AbstractSanityCheck, type CheckContext } from "./types";
import { Project } from "@/lib/project";

/** Verifies the framework detected on disk matches the one recorded in config. */
export class FrameworkCheck extends AbstractSanityCheck {
  readonly name = "framework";
  readonly path = "zitadel.json";
  protected readonly summary = "Detected framework matches recorded framework";

  protected async verify(ctx: CheckContext): Promise<void> {
    const config = await Project.at(ctx.cwd).config();
    const detected = await ctx.orca.detect(ctx.cwd);
    const recorded = config.frameworkId;
    if (recorded !== detected.id) {
      throw new Error(`expected ${String(recorded)}, detected ${detected.id}`);
    }
  }
}
