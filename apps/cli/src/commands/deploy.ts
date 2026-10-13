import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  diffStep,
  headSha,
  idpConnectionsStep,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../lib/release";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../lib/errors";
import { reportWarning } from "../lib/warnings";

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

/**
 * Whether an origin pattern covers a concrete origin URL, matching the server's
 * glob rule: a `*` stands for one or more characters, none of them a dot, so
 * `https://*.preview.acme.com` covers `https://pr-7.preview.acme.com` but not a
 * deeper label. A pattern with no `*` matches only its exact self.
 */
function originMatchesPattern(pattern: string, origin: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? "\0" : `\\${ch}`));
  return new RegExp(`^${escaped.replaceAll("\0", "[^.]+")}$`).test(origin);
}

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
    // deployed from a pull-request build, not here, so it is refused. A primary
    // pattern is an exact URL, so a literal match is a primary target — and a
    // literal beats a wildcard. A preview pattern may be a wildcard, so it is
    // matched by glob, not string equality: a concrete URL covered by a preview
    // wildcard (say `https://pr-7.preview.acme.com` under
    // `https://*.preview.acme.com`) is still a preview and must be refused here,
    // not slip through as a primary target.
    const origin = flags.origin;
    if (origin !== undefined) {
      const origins = (await client.getProject(projectId)).origins ?? [];
      const isPrimary = origins.some(
        (entry) => entry.kind === "primary" && entry.pattern === origin,
      );
      if (!isPrimary) {
        const isPreview = origins.some(
          (entry) => entry.kind === "preview" && originMatchesPattern(entry.pattern, origin),
        );
        if (isPreview) {
          throw new ZitadelError("E_VALIDATION", `${origin} is a preview origin`, {
            hint: "Pass a primary origin; preview origins are served by pull-request builds.",
          });
        }
        throw new ZitadelError("E_VALIDATION", `${origin} is not an origin of the project`, {
          hint: `Pass a primary origin, or add it first with \`zitadel origin add${this.environmentSelector()}\`.`,
          nextCommands: [`zitadel origin list${this.environmentSelector()}`],
        });
      }
    } else if (!dryRun) {
      // With no --origin the deploy goes to every primary origin, so the
      // project must have at least one. Checked here, before the bundle is
      // built and the IdP connections are synced, so a project with no primary
      // origin fails before the IdP step does a partial write rather than
      // after it, when the final deploy would report the missing origin. A dry
      // run writes nothing and never reaches the deploy, so it is exempt: it
      // still validates and previews a project that has no primary origin yet.
      const origins = (await client.getProject(projectId)).origins ?? [];
      if (!origins.some((entry) => entry.kind === "primary")) {
        throw new ZitadelError("E_VALIDATION", "The project has no primary origin to deploy to", {
          hint: `Add one with \`zitadel origin add <url> --kind primary${this.environmentSelector()}\`, then deploy.`,
          nextCommands: [`zitadel origin list${this.environmentSelector()}`],
        });
      }
    }

    const { bundle, resourceCount, brandingSources } = await buildBundle(cwd);
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
      brandingSources,
    };

    // Before-release steps: validate, sync IdPs (validated and previewed but
    // not written on a dry run), diff.
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

    // Record whether the whole worktree was dirty when this release was built,
    // and warn: a release pins content, but its git provenance is only exact
    // when the tree was clean, so the reader knows the commit is approximate.
    const gitDirty = await worktreeIsDirty(cwd);
    if (gitDirty) {
      reportWarning(
        "The git working tree has uncommitted changes; this release records its commit as approximate.",
      );
    }

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message,
      gitSha: await headSha(cwd),
      gitDirty,
    });

    // What the targets serve right now, newest first. Its id guards the create
    // against another deploy that raced in since we inspected: the server
    // refuses with 409 rather than overwriting that deploy unseen (#538).
    const liveQuery = { project_id: projectId, live: true, ...(origin ? { origin } : {}) };
    const observed = (await client.listDeployments(liveQuery)).deployments[0]?.id;
    const targets = origin ? [origin] : ["primary"];
    let deployment: Awaited<ReturnType<typeof createDeployment>>;
    try {
      deployment = await createDeployment(client, projectId, {
        releaseId: release.id,
        targets,
        message,
        // On a project's first deploy nothing is live, so there is no
        // deployment to guard against: the field is omitted rather than sent
        // empty or as a placeholder, which an optional id cannot stand in for.
        // When a deployment is live its id is sent so a racing deploy is caught
        // with a 409 (#538).
        ...(observed === undefined ? {} : { expectedDeploymentId: observed }),
      });
    } catch (error) {
      // A 409 means another deploy landed between our inspection and this
      // create. Re-read what the targets serve now and report that actual
      // deployment, so the caller re-runs against current state (#538).
      if (!(error instanceof ApiError) || error.status !== 409) {
        throw error;
      }
      const current = (await client.listDeployments(liveQuery)).deployments[0];
      throw new ZitadelError(
        "E_CONFLICT",
        "Another deploy changed the targets since this one was prepared",
        {
          hint: `Re-run \`zitadel deploy${this.environmentSelector()}\`; it will build and deploy against the current state.`,
          details: current === undefined ? undefined : { current_deployment: current },
          nextCommands: [`zitadel deployment list --live${this.environmentSelector()}`],
        },
      );
    }

    // The create response carries any non-blocking advisories the server
    // raised while making the release live (a clamped preview ttl, say). The
    // deploy succeeded regardless, so they are surfaced as warnings, not an
    // error.
    for (const warning of deployment.warnings ?? []) {
      reportWarning(warning.message);
    }

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
        next_commands: [`zitadel deployment list${this.environmentSelector()}`],
      },
      pretty: [
        `Deployed ${release.content_hash}`,
        `  ${resourceCount} resource${resourceCount === 1 ? "" : "s"} to ${servedOrigins.length} origin${servedOrigins.length === 1 ? "" : "s"}`,
        ...servedOrigins.map((served) => `  - ${served}`),
      ].join("\n"),
    });
  }
}
