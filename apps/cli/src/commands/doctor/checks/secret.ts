import { readZitadelSecret } from "../../../lib/project";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/secret` exists and parses. */
export class SecretCheck extends AbstractSanityCheck {
  readonly name = "secret";
  readonly path = ".zitadel/secret";
  protected readonly summary = ".zitadel/secret parses";

  protected async verify(ctx: CheckContext): Promise<void> {
    await readZitadelSecret(ctx.cwd);
  }
}
