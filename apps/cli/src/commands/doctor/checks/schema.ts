import { createZitadelClient, IdpService } from "@/lib/backend";
import { isCancellation } from "@/lib/errors";
import { readProjectServer, readZitadelConfig, readZitadelSecret } from "@/lib/project";
import { userAgent } from "@/lib/user-agent";
import {
  CONFIG_DIRECTORIES,
  DiskStore,
  type Issue,
  type RuleId,
  ZitadelConfig,
} from "@/lib/zitadel";
import { AbstractSanityCheck, type CheckContext, type CheckOutcome } from "./types";

/**
 * The rule whose advice only holds before a connection's first deploy, so it
 * can only be judged knowing which connections the project already has.
 */
const DEPLOYED_DEPENDENT_RULE: RuleId = "sso/subject-claim-unstable";

/**
 * Verifies the project's configuration in `.zitadel/` against every rule
 * `ZitadelConfig.validate` holds it to: each schema, flow, connection, policy
 * and branding file's contract, the server's flow rules, and how the files
 * agree. These are the rules `deploy` validates with, so doctor and `deploy`
 * can never disagree about a file. An error fails the check; a warning, when
 * nothing fails, makes it a warning.
 *
 * Like `deploy`, it stops warning about a connection the project already has
 * when a connection's subject claim is one the user can change: the server
 * keeps a deployed connection's subject, so that advice could not be followed.
 * It lists the connections only when a local one could draw the warning. When
 * the listing cannot be read, nobody can tell which connections are deployed,
 * so that one warning is left out rather than given for all of them.
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
    const warnings = (await this.warningsKnowingDeployed(ctx, store, config)).filter((issue) => {
      return issue.severity === "warning";
    });
    if (warnings.length > 0) {
      return { name: this.name, status: "warn", message: described(warnings), path: this.path };
    }
    return outcome;
  }

  /**
   * Validates the configuration, asking the server which connections are
   * deployed only when a rule that depends on it could fire.
   *
   * @param ctx - The project to check.
   * @param store - Where the configuration is kept.
   * @param config - The configuration, read without the deployed connections.
   * @returns Every finding; without the deployed-dependent rule's when the
   *   deployed connections could not be listed.
   * @throws {@link ZitadelError} `E_CANCELLED` when the person stops the command.
   */
  private async warningsKnowingDeployed(
    ctx: CheckContext,
    store: DiskStore,
    config: ZitadelConfig,
  ): Promise<readonly Issue[]> {
    const issues = config.validate({ store });
    const depends = issues.some((issue) => {
      return issue.rule === DEPLOYED_DEPENDENT_RULE;
    });
    if (!depends) {
      return issues;
    }
    const deployed = await this.deployedConnections(ctx);
    if (deployed === undefined) {
      return issues.filter((issue) => {
        return issue.rule !== DEPLOYED_DEPENDENT_RULE;
      });
    }
    const known = await ZitadelConfig.loadUnchecked(store, { deployed });
    return known.validate({ store });
  }

  /**
   * Lists the slugs of the connections the project already has, as `deploy`
   * does, from the server and project `.zitadel/` names.
   *
   * @param ctx - The project to check.
   * @returns The slugs, or undefined when the project's files do not say where
   *   to ask or the listing cannot be read.
   * @throws {@link ZitadelError} `E_CANCELLED` when the person stops the command.
   */
  private async deployedConnections(ctx: CheckContext): Promise<ReadonlySet<string> | undefined> {
    try {
      const secret = await readZitadelSecret(ctx.cwd);
      const server = readProjectServer(await readZitadelConfig(ctx.cwd));
      const client = createZitadelClient({
        userAgent: userAgent(),
        baseUrl: server,
        token: secret.project_secret,
        signal: ctx.signal,
      });
      return await new IdpService(client, secret.project_id).deployedSlugs();
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return undefined;
    }
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
