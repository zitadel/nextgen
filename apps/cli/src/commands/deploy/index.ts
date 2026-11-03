import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { messageFlag } from "./flags/message";
import { origins } from "./requirements/origins";
import { reason } from "./requirements/reason";
import {
  buildBundle,
  createDeployment,
  DEPLOY_ARGS,
  createReleaseFromBundle,
  diffStep,
  headSha,
  runSteps,
  servesPrimary,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../../lib/errors";
import { reportWarning } from "../../lib/warnings";

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
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;
  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --dry-run",
  ];
  static override flags = {
    message: messageFlag({
      description:
        "A short summary of what this release changes. Defaults to the pull request's title or the current commit's subject.",
    }),
  };

  static override requires = {
    reason: reason,
    origins: origins,
  };

  protected async execute({ reason, origins }: Admitted<typeof Deploy>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const { bundle, resourceCount, brandingSources, idpFiles, policyFiles } = await buildBundle(
      this.cwd,
    );
    this.recordTelemetry({ resources: resourceCount });
    const ctx: StepContext = {
      cwd: this.cwd,
      client,
      projectId,
      env: this.env,
      mode: "deploy",
      dryRun: this.dryRun,
      json: this.isJson,
      color: this.isColored,
      bundle,
      brandingSources,
      idpFiles,
      policyFiles,
      suggest: (args) => this.suggest(args),
    };

    // Before-release steps: validate, then diff, which `--json` reports as
    // `diff` on a dry run and a deploy alike.
    const reported = await runSteps([validateStep, diffStep], ctx);

    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: resourceCount,
          targets: ["primary"],
          ...reported,
        },
        pretty: `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"}. Nothing was deployed (dry run).`,
      });
    }

    // Record whether the whole worktree was dirty when this release was built,
    // and warn: a release pins content, but its git provenance is only exact
    // when the tree was clean, so the reader knows the commit is approximate.
    const gitDirty = await worktreeIsDirty(this.cwd);
    if (gitDirty) {
      reportWarning(
        "The git working tree has uncommitted changes; this release records its commit as approximate.",
      );
    }

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message: reason.message,
      gitSha: await headSha(this.cwd),
      gitDirty,
    });

    // What the targets serve right now. The guard id is the newest deployment
    // to any origin this deploy lands on — the contract's rule — so a live
    // preview, which never targets a primary, is never it. It guards the
    // create against another deploy that raced in since we inspected: the
    // server refuses with 409 rather than overwriting that deploy unseen (#538).
    const deployments = await client.listDeployments.all({
      project_id: projectId,
      live: true,
    });
    const observed = deployments.find((deployment) =>
      deployment.targets.some((entry) => origins.landing.includes(entry.origin)),
    )?.id;
    const targets = ["primary"];
    const deployment = await createDeployment(client, projectId, {
      releaseId: release.id,
      targets,
      message: reason.message,
      // On a project's first deploy nothing is live, so there is no
      // deployment to guard against: the field is omitted rather than sent
      // empty or as a placeholder, which an optional id cannot stand in for.
      // When a deployment is live its id is sent so a racing deploy is caught
      // with a 409 (#538).
      ...(observed === undefined ? {} : { expectedDeploymentId: observed }),
    }).catch(async (error: unknown): Promise<never> => {
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
      const deployments = await client.listDeployments.all({
        project_id: projectId,
        live: true,
      });
      const current = deployments.find(servesPrimary);
      throw new ZitadelError(
        "E_CONFLICT",
        "Another deploy changed the targets since this one was prepared",
        {
          hint: `Re-run \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`; it will build and deploy against the current state.`,
          details: current === undefined ? undefined : { current_deployment: current },
          nextCommands: [this.suggest("deployment list --live")],
        },
      );
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
        ...reported,
      },
      next: { commands: [this.suggest("deployment list")] },
      pretty: [
        `Deployed ${release.content_hash}`,
        `  ${resourceCount} resource${resourceCount === 1 ? "" : "s"} to ${servedOrigins.length} origin${servedOrigins.length === 1 ? "" : "s"}`,
        ...servedOrigins.map((served) => `  - ${served}`),
      ].join("\n"),
    });
  }
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
