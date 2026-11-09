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
 * What one read of the configuration found.
 */
type Inspection = {
  readonly store: DiskStore;
  readonly config: ZitadelConfig;
  readonly issues: readonly Issue[];
};

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
   * The read in flight for each run, so the run reads and validates once.
   */
  private readonly inspections = new WeakMap<CheckContext, Promise<Inspection>>();

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
    try {
      const outcome = await super.run(ctx);
      if (outcome.status === "fail") {
        return outcome;
      }
      const found = await this.inspected(ctx);
      if (found.config.schemas.all.length === 0) {
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
      const warnings = (await this.warningsKnowingDeployed(ctx, found)).filter((issue) => {
        return issue.severity === "warning";
      });
      if (warnings.length > 0) {
        return { name: this.name, status: "warn", message: described(warnings), path: this.path };
      }
      return outcome;
    } finally {
      this.inspections.delete(ctx);
    }
  }

  /**
   * Reads and validates the configuration once for a run, however many steps
   * of the run ask for it.
   *
   * @param ctx - The project to check.
   * @returns What the one read and validation found.
   * @throws When a file cannot be read.
   */
  private inspected(ctx: CheckContext): Promise<Inspection> {
    const held = this.inspections.get(ctx);
    if (held !== undefined) {
      return held;
    }
    const fresh = this.inspect(ctx);
    this.inspections.set(ctx, fresh);
    return fresh;
  }

  /**
   * Loads the configuration without its contract check and validates it.
   *
   * @param ctx - The project to check.
   * @returns The store, the configuration and the issues the rules raise.
   * @throws When a file cannot be read.
   */
  private async inspect(ctx: CheckContext): Promise<Inspection> {
    const store = new DiskStore(ctx.cwd);
    const config = await ZitadelConfig.loadUnchecked(store);
    return { store, config, issues: config.validate({ store }) };
  }

  /**
   * Validates the configuration, asking the server which connections are
   * deployed only when a rule that depends on it could fire.
   *
   * @param ctx - The project to check.
   * @param found - The configuration as read without the deployed connections,
   *   and what the rules found in it.
   * @returns Every finding; without the deployed-dependent rule's when the
   *   deployed connections could not be listed.
   * @throws {@link ZitadelError} `E_CANCELLED` when the person stops the command.
   */
  private async warningsKnowingDeployed(
    ctx: CheckContext,
    found: Inspection,
  ): Promise<readonly Issue[]> {
    const depends = found.issues.some((issue) => {
      return issue.rule === DEPLOYED_DEPENDENT_RULE;
    });
    if (!depends) {
      return found.issues;
    }
    const deployed = await this.deployedConnections(ctx);
    if (deployed === undefined) {
      return found.issues.filter((issue) => {
        return issue.rule !== DEPLOYED_DEPENDENT_RULE;
      });
    }
    return found.config.withOptions({ deployed }).validate({ store: found.store });
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
   * Refuses the configuration when the rules raise an error.
   *
   * @param ctx - The project to check.
   * @returns Nothing when no rule raises an error.
   * @throws When a file cannot be read, or naming every error the rules raise.
   */
  protected async verify(ctx: CheckContext): Promise<void> {
    const found = await this.inspected(ctx);
    const errors = found.issues.filter((issue) => {
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
