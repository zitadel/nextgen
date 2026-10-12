import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import {
  buildBundle,
  configIsDirty,
  createDeployment,
  createReleaseFromBundle,
  diffStep,
  headSha,
  idpConnectionsStep,
  runSteps,
  type StepContext,
  validateStep,
} from "../lib/release";
import { ZitadelError } from "../lib/errors";

/**
 * `zitadel deploy` — publish `.zitadel/` to the project's primary origins.
 *
 * It assembles a release bundle from the files on disk, validates it and syncs
 * identity-provider connections, shows what changed since the live release as a
 * git diff, then creates the release and deploys it to every primary origin
 * (or the one `--origin` names). `--dry-run` stops after the diff, writing
 * nothing to the server.
 *
 * It replaces `plan` and `apply`: a release is published as one immutable unit
 * and deployed, rather than each resource being synced in place.
 */
export default class Deploy extends EnvironmentCommand {
  static override description = "Build a release from .zitadel/ and deploy it to the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;
  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --origin https://app.acme.com",
    "<%= config.bin %> deploy --dry-run",
  ];
  static override flags = {
    message: Flags.string({
      char: "m",
      description: "A short summary of what this release changes.",
    }),
    origin: Flags.string({
      description: "Deploy to one primary origin instead of every primary origin.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Deploy);
    await this.toMeta(flags);
    const { cwd, env, dryRun, isTTY, nonInteractive } = this.meta;
    const json = this.jsonEnabled();
    const color = !json && isTTY && flags.color !== false && !process.env.NO_COLOR;

    // A deploy records why it happened. Interactively the reason can be left
    // off, but a non-interactive caller (CI) has no prompt to fall back on, so
    // it must name one. Rejected here, before the pipeline writes anything, so
    // a missing message never leaves a half-synced IdP behind. A dry run makes
    // no release, so it is exempt.
    const message = flags.message?.trim() ? flags.message.trim() : undefined;
    if (nonInteractive && !dryRun && message === undefined) {
      throw new ZitadelError("E_VALIDATION", "A deploy needs a message in non-interactive mode", {
        hint: "Pass -m/--message with a short summary of what this release changes.",
      });
    }

    const { client, projectId } = await this.connect();

    // --origin narrows the deploy to one primary origin. A preview origin is
    // deployed from a pull-request build, not here, so it is refused by name.
    const origin = flags.origin;
    if (origin !== undefined) {
      const origins = (await client.getProject(projectId)).origins ?? [];
      const match = origins.find((entry) => entry.pattern === origin);
      if (!match) {
        throw new ZitadelError("E_VALIDATION", `${origin} is not an origin of the project`, {
          hint: "Pass a primary origin, or add it first with `zitadel origin add`.",
          nextCommands: ["zitadel origin list"],
        });
      }
      if (match.kind === "preview") {
        throw new ZitadelError("E_VALIDATION", `${origin} is a preview origin`, {
          hint: "Pass a primary origin; preview origins are served by pull-request builds.",
        });
      }
    }

    const { bundle, resourceCount } = await buildBundle(cwd);
    this.recordTelemetry({ resources: resourceCount });
    const ctx: StepContext = {
      cwd,
      client,
      projectId,
      env,
      mode: "deploy",
      dryRun,
      json,
      color,
      origin,
      bundle,
    };

    // Before-release steps: validate, sync IdPs (skipped on a dry run), diff.
    await runSteps([validateStep, idpConnectionsStep, diffStep], ctx);

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: resourceCount,
          targets: origin ? [origin] : ["primary"],
        },
        pretty: `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"}. Nothing was deployed (dry run).`,
      });
    }

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message,
      gitSha: await headSha(cwd),
      gitDirty: await configIsDirty(cwd),
    });
    const deployment = await createDeployment(client, projectId, {
      releaseId: release.id,
      targets: origin ? [origin] : ["primary"],
      message,
    });

    const servedOrigins = deployment.targets.map((target) => target.origin);
    this.recordTelemetry({ origin_count: servedOrigins.length });
    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        deployment_id: deployment.id,
        resources: resourceCount,
        origins: servedOrigins,
        next_commands: ["zitadel deployment list"],
      },
      pretty: [
        `Deployed ${release.content_hash}`,
        `  ${resourceCount} resource${resourceCount === 1 ? "" : "s"} to ${servedOrigins.length} origin${servedOrigins.length === 1 ? "" : "s"}`,
        ...servedOrigins.map((served) => `  - ${served}`),
      ].join("\n"),
    });
  }
}
