import { CONFIG_DIRECTORIES, DiskStore, type Issue, ZitadelConfig } from "@/lib/zitadel";
import { AbstractSanityCheck, type CheckContext, type CheckOutcome } from "./types";

/**
 * Verifies the project's configuration in `.zitadel/` against every rule
 * `ZitadelConfig.validate` holds it to: each schema, flow, connection, policy
 * and branding file's contract, the server's flow rules, and how the files
 * agree. These are the rules `deploy` validates with, so doctor and `deploy`
 * can never disagree about a file. An error fails the check; a warning, when
 * nothing fails, makes it a warning.
 */
export class SchemaCheck extends AbstractSanityCheck {
  readonly name = "schema";
  readonly path = CONFIG_DIRECTORIES.schemas;
  protected readonly summary = "The configuration in .zitadel/ is valid";

  /**
   * Fails on what {@link verify} refuses. Otherwise an empty
   * `.zitadel/schemas/` is a warning, not a failure: projects created before
   * editable config existed were seeded server-side and have no local schema
   * files, and there is no safe auto-fix that could invent them. A warning
   * the rules raise is reported the same way.
   *
   * @param ctx - The project to check.
   * @returns The outcome: a failure, a warning, or a pass.
   */
  override async run(ctx: CheckContext): Promise<CheckOutcome> {
    const outcome = await super.run(ctx);
    if (outcome.status === "fail") {
      return outcome;
    }
    const store = new DiskStore(ctx.cwd);
    const config = await ZitadelConfig.loadUnchecked(store);
    if (config.schemas.all.length === 0) {
      return {
        name: this.name,
        status: "warn",
        message:
          `No schema files found in ${CONFIG_DIRECTORIES.schemas} — this project predates editable ` +
          "schema config or setup was interrupted. New projects scaffold editable " +
          "defaults via `zitadel setup`.",
        path: this.path,
      };
    }
    const warnings = config.validate({ store }).filter((issue) => {
      return issue.severity === "warning";
    });
    if (warnings.length > 0) {
      return { name: this.name, status: "warn", message: described(warnings), path: this.path };
    }
    return outcome;
  }

  /**
   * Loads the configuration without its contract check and validates it.
   *
   * @param ctx - The project to check.
   * @returns Nothing when no rule raises an error.
   * @throws When a file cannot be read, or naming every error the rules raise.
   */
  protected async verify(ctx: CheckContext): Promise<void> {
    const store = new DiskStore(ctx.cwd);
    const config = await ZitadelConfig.loadUnchecked(store);
    const errors = config.validate({ store }).filter((issue) => {
      return issue.severity === "error";
    });
    if (errors.length > 0) {
      throw new Error(described(errors));
    }
  }
}

/**
 * Puts issues on one line, each prefixed with the file it is in.
 *
 * @param issues - The issues, in the order the rules raised them.
 * @returns The issues, separated by semicolons.
 */
function described(issues: readonly Issue[]): string {
  return issues
    .map((issue) => {
      return `${issue.file}: ${issue.message}`;
    })
    .join("; ");
}
