import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  liveDeployments,
  matchesPattern,
  normalizeOrigins,
  servingByOrigin,
  targetLabel,
} from "../lib/deployments";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";
import { buildRelease } from "../lib/release";
import { connectTarget } from "../lib/target";

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

    const { client, projectId, server, target } = await connectTarget({
      cwd,
      env,
      serverFlag,
      envName,
      envFile,
    });
    consola.info(`environment  ${target.environment.value}   ${server}   ${projectId}`);

    const project = await client.getProject(projectId);
    const explicit = normalizeOrigins(flags.origin ?? []);
    for (const origin of explicit) {
      const kind = project.allowed_origins.find((entry) => matchesPattern(entry.pattern, origin))?.kind;
      if (kind === "preview") {
        throw new ZitadelError("E_VALIDATION", `${origin} matches a preview pattern`, {
          hint: "deploy targets the default and primary origins; use `zitadel preview --origin` for a preview URL.",
          nextCommands: [publicCliCommand(`preview --origin ${origin}`, cliVersion)],
        });
      }
    }
    const targets = explicit.length > 0 ? explicit : ["default", "primary"];
    const before = servingByOrigin(await liveDeployments(client, projectId));

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: target.environment.value, server, project_id: projectId, targets },
      });
    }

    consola.start("Building the release");
    const release = await buildRelease({ cwd, client, projectId, message: flags.message });
    consola.start(`Deploying to ${targets.join(", ")}`);
    const deploy = await client.createDeployment(
      { release: release.id, targets, ...(flags.message ? { message: flags.message } : {}) },
      { project_id: projectId },
    );

    const lines = deploy.deployments.map(
      (row) => `  ${targetLabel(row.origin).padEnd(42)} ${before.get(row.origin) ?? "(nothing)"} -> ${row.release_id}`,
    );
    const pretty = [
      `release     ${release.id}  sha256:${release.content_hash.slice(0, 12)}  ${release.created ? "(new)" : "(exists, reusing)"}`,
      "",
      `deployed to ${deploy.deployments.length} target${deploy.deployments.length === 1 ? "" : "s"}`,
      ...lines,
      ...(deploy.warnings ?? []).map((warning) => `warning  ${warning}`),
      "",
      `deployed    ${deploy.deploy_id}   ${deploy.deployments.length} deployment records written`,
      `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:${release.content_hash}`,
    ].join("\n");

    return this.emit({
      status: "ok",
      data: {
        environment: target.environment.value,
        server,
        project_id: projectId,
        release,
        deploy_id: deploy.deploy_id,
        targets: deploy.targets,
        deployments: deploy.deployments,
        warnings: deploy.warnings ?? [],
        next_commands: [publicCliCommand("deployments --live", cliVersion)],
      },
      warnings: deploy.warnings ?? [],
      pretty,
    });
  }
}
