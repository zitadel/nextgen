import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import {
  buildBundle,
  createDeployment,
  DEPLOY_ARGS,
  createReleaseFromBundle,
  diffStep,
  headSha,
  listLiveDeployments,
  runSteps,
  servesPrimary,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../lib/release";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../lib/errors";
import { reportWarning } from "../lib/warnings";
import { nextCommandsData } from "../lib/oclif/envelope";

/**
 * `zitadel deploy` — publish `.zitadel/` to the project's primary origins.
 *
 * It assembles a release bundle from the files on disk, validates it and syncs
 * identity-provider connections, shows what changed since the live release as a
 * git diff, then creates the release and deploys it to every primary origin
 * (primary origins are never named one by one). `--dry-run` stops after the
 * diff, writing nothing to the server.
 *
 * It replaces `plan` and `apply`: a release is published as one immutable unit
 * and deployed, rather than each resource being synced in place.
 */

export default class Deploy extends EnvironmentCommand {
  static override description =
    "Apply your local configuration to Zitadel.\n\nBuilds a release from .zitadel/ and deploys it to the project. Use --dry-run to preview what would change.";

  static override heading = "Deploying the configuration";

  static override wizard = true;
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;
  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --dry-run",
  ];
  static override flags = {
    message: Flags.string({
      char: "m",
      description: "A short summary of what this release changes.",
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

    // The origins this deploy lands on, for the optimistic guard below.
    let landing: string[] = [];
    if (!dryRun) {
      // The deploy goes to every primary origin, so the project must have at
      // least one. Checked here, before the bundle is built and the IdP
      // connections are synced, so a project with no primary origin fails
      // before the IdP step does a partial write rather than after it, when the
      // final deploy would report the missing origin. A dry run writes nothing
      // and never reaches the deploy, so it is exempt: it still validates and
      // previews a project that has no primary origin yet.
      const origins = (await client.getProject(projectId)).origins ?? [];
      landing = origins.filter((entry) => entry.kind === "primary").map((entry) => entry.pattern);
      if (landing.length === 0) {
        throw new ZitadelError("E_VALIDATION", "The project has no primary origin to deploy to", {
          hint: `Add one with ${this.suggest("origin add <url> --kind primary")}, then deploy.`,
          nextCommands: [this.suggest("origin list")],
        });
      }
    }

    const { bundle, resourceCount, brandingSources, idpFiles, policyFiles } =
      await buildBundle(cwd);
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
      bundle,
      brandingSources,
      idpFiles,
      policyFiles,
      suggest: (args) => this.suggest(args),
    };

    // Before-release steps: validate, sync IdPs (validated and previewed but
    // not written on a dry run), diff.
    await runSteps([validateStep, diffStep], ctx);

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: resourceCount,
          targets: ["primary"],
        },
        pretty: `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"} and deployed nothing (dry run)`,
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

    // What the targets serve right now. The guard id is the newest deployment
    // to any origin this deploy lands on — the contract's rule — so a live
    // preview, which never targets a primary, is never it. It guards the
    // create against another deploy that raced in since we inspected: the
    // server refuses with 409 rather than overwriting that deploy unseen (#538).
    const live = await listLiveDeployments(client, projectId);
    const observed = live.find((deployment) =>
      deployment.targets.some((entry) => landing.includes(entry.origin)),
    )?.id;
    const targets = ["primary"];
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
      // Building dedupes on content, revoked releases included, so a tree
      // that matches a revoked release builds back to it and cannot deploy.
      // That is not a race: re-running would fail the same way.
      if (errorCode(error) === "rel.revoked") {
        throw new ZitadelError(
          "E_CONFLICT",
          `This content was already released as ${release.id}, which is revoked`,
          {
            hint: "A revoked release can never be served again. Change the configuration so it builds a new release, then deploy.",
            details: { release_id: release.id, content_hash: release.content_hash },
          },
        );
      }
      // The deployment that raced in on a primary origin, not a live preview.
      const current = (await listLiveDeployments(client, projectId)).find(servesPrimary);
      throw new ZitadelError(
        "E_CONFLICT",
        "Another deploy changed the targets since this one was prepared",
        {
          hint: `Rerun ${this.suggest(DEPLOY_ARGS)}; it will build and deploy against the current state.`,
          details: current === undefined ? undefined : { current_deployment: current },
          nextCommands: [this.suggest("deployment list --live")],
        },
      );
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
        ...nextCommandsData([this.suggest("deployment list")]),
      },
      pretty: [deployed(resourceCount), liveOn(release.content_hash, servedOrigins)].join("\n"),
      summary: {
        title: deployed(resourceCount),
        sections: [],
        lines: [liveOn(release.content_hash, servedOrigins)],
        boxed: true,
      },
    });
  }
}

/** What the run did, as the one sentence the chain closes on. */
export function deployed(resources: number): string {
  return `Deployed ${resources} resource${resources === 1 ? "" : "s"}`;
}

/**
 * Where the release went, as one sentence.
 *
 * The origins are named inside it rather than listed under it: a deploy
 * usually lands on one, and a bullet list of a single item is not a list. The
 * hash is the short one — the full digest identifies the release to a machine
 * and is in the envelope, where a machine reads it.
 */
export function liveOn(hash: string, origins: readonly string[]): string {
  const release = `Release ${abbreviate(hash)} is now live`;
  if (origins.length === 0) {
    return `${release}.`;
  }
  const where =
    origins.length === 1 ? origins[0] : `${origins.slice(0, -1).join(", ")} and ${origins.at(-1)}`;
  return `${release} on ${where}.`;
}

/**
 * A content hash short enough to close the chain on. `sha256:` and 64 hex
 * digits is wider than a closing line may be, so the digest is cut to the 12
 * characters that identify it in practice; the full hash stays in the
 * envelope, where something might match on it.
 */
export function abbreviate(hash: string): string {
  const separator = hash.indexOf(":");
  const algorithm = separator < 0 ? "" : hash.slice(0, separator + 1);
  return `${algorithm}${hash.slice(separator + 1, separator + 13)}`;
}

/** The `code` of an API error body, when it carries one. */
function errorCode(error: ApiError): string | undefined {
  const body = error.body;
  return typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code
    : undefined;
}
