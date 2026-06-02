import { readZitadelConfig } from "../../../lib/project";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `zitadel.json` exists and parses. */
export class ConfigCheck extends AbstractSanityCheck {
  readonly name = "config";
  readonly path = "zitadel.json";
  protected readonly summary = "zitadel.json parses";

  protected async verify(ctx: CheckContext): Promise<void> {
    await readZitadelConfig(ctx.cwd);
  }
}
