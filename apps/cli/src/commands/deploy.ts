import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  liveTargets,
  matchesPattern,
  normalizeOrigins,
  servingByOrigin,
  targetLabel,
} from "../lib/deployments";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";
import { connectEnvironment } from "../lib/environment";
import { buildRelease } from "../lib/release";

/**
 * `zitadel deploy` — build a release from `.zitadel/` and make it live on the
 * project default and every primary origin. Previews are `zitadel preview`:
 * the two verbs never share a target, so shipping to production is never one
 * forgotten flag away.
 */
export default class Deploy extends BaseCommand {
  static override description =
    "Build a release from .zitadel/ and deploy it to the project default and primary origins.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 3;
  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --env production",
    "<%= config.bin %> deploy --origin https://staging.acme.com",
  ];
  static override flags = {
    message: Flags.string({ char: "m", description: "Summary recorded on the release and the deploy." }),
    origin: Flags.string({
      multiple: true,
      description: "Deploy to one primary origin only. Repeatable. A preview URL is refused.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Deploy);
    await this.toMeta(flags);
    const { cwd, env, dryRun, cliVersion, serverFlag, envName, envFile } = this.meta;

    const { client, projectId, server, environment } = await connectEnvironment({
      cwd,
      env,
      serverFlag,
      envName,
      envFile,
    });
    consola.info(`environment  ${environment.name.value}   ${server}   ${projectId}`);

    const project = await client.getProject(projectId);
    const explicit = normalizeOrigins(flags.origin ?? []);
    for (const origin of explicit) {
      const kind = project.origins.find((entry) => matchesPattern(entry.pattern, origin))?.kind;
      if (kind === "preview") {
        throw new ZitadelError("E_VALIDATION", `${origin} matches a preview pattern`, {
          hint: "deploy targets the default and primary origins; use `zitadel preview --origin` for a preview URL.",
          nextCommands: [publicCliCommand(`preview --origin ${origin}`, cliVersion)],
        });
      }
    }
    const targets = explicit.length > 0 ? explicit : ["default", "primary"];
    const before = servingByOrigin(await liveTargets(client, projectId));

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: environment.name.value, server, project_id: projectId, targets },
      });
    }

    consola.start("Building the release");
    const release = await buildRelease({ cwd, client, projectId, message: flags.message });
    consola.start(`Deploying to ${targets.join(", ")}`);
    const result = await client.createDeployment(
      { release: release.id, targets, ...(flags.message ? { message: flags.message } : {}) },
      { project_id: projectId },
    );
    const { deployment } = result;
    const warnings = result.warnings ?? [];

    const lines = deployment.targets.map(
      (entry) =>
        `  ${targetLabel(entry.origin).padEnd(42)} ${before.get(entry.origin) ?? "(nothing)"} -> ${deployment.release_id}`,
    );
    const pretty = [
      `release     ${release.id}  sha256:${release.content_hash.slice(0, 12)}  ${release.created ? "(new)" : "(exists, reusing)"}`,
      "",
      `deployed to ${deployment.targets.length} target${deployment.targets.length === 1 ? "" : "s"}`,
      ...lines,
      ...warnings.map((warning) => `warning  ${warning}`),
      "",
      `deployment  ${deployment.id}`,
      `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:${release.content_hash}`,
    ].join("\n");

    return this.emit({
      status: "ok",
      data: {
        environment: environment.name.value,
        server,
        project_id: projectId,
        release,
        deployment_id: deployment.id,
        targets: deployment.targets.map((entry) => entry.origin),
        deployment,
        warnings,
        next_commands: [publicCliCommand("deployment list --live", cliVersion)],
      },
      warnings,
      pretty,
    });
  }
}
