import { isObject } from "../../../lib/json";
import { readZitadelConfig } from "../../../lib/project";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies the framework detected on disk matches the one recorded in config. */
export class FrameworkCheck extends AbstractSanityCheck {
  readonly name = "framework";
  readonly path = "zitadel.json";
  protected readonly summary = "Detected framework matches recorded framework";

  protected async verify(ctx: CheckContext): Promise<void> {
    const config = await readZitadelConfig(ctx.cwd);
    const detected = await ctx.orca.detect(ctx.cwd);
    const recorded = isObject(config.framework) ? config.framework.id : undefined;
    if (recorded !== detected.id) {
      throw new Error(`expected ${String(recorded)}, detected ${detected.id}`);
    }
  }
}
