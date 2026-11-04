import {
  type Admitted,
  CommandGroups,
  type Connection,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import {
  buildBundle,
  createDeployment,
  DEPLOY_ARGS,
  createReleaseFromBundle,
  diffStep,
  lockoutStep,
  headSha,
  runSteps,
  servesPrimary,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { Cmd } from "../../lib/cmd";
import { ZitadelError } from "../../lib/errors";
import { reads, type Refused } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { issuerHeldAsPreview, originOf, type ProjectOrigin } from "../../lib/origins";
import { readZitadelSecret } from "../../lib/project";
import { deployMessage, MESSAGE_MAX_LENGTH, messageTooLong } from "../../lib/release";
import type { SuggestedCommand } from "../../lib/suggestion";
import { reportWarning } from "../../lib/warnings";

/** How a non-interactive deploy with no message to fall back on is refused. */

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject later. `messageTooLong` counts code points, as the server does, so
 * the length is its call and not the schema's. The message is trimmed.
 */
const MESSAGE: Refused<string> = {
  schema: z
    .string()
    .trim()
    .min(1, "the value is empty")
    .refine((message) => {
      return !messageTooLong(message);
    }, `the message is longer than ${MESSAGE_MAX_LENGTH} characters`),
  refusal: {
    message: "{problem}",
    hint: "Pass a shorter summary with -m.",
    details: {
      argument: "--message",
    },
  },
};

/**
 * What a deploy with no primary origin to land on tells the developer, naming
 * the step that gives the project one. A project `zitadel setup` 0.1.0 created
 * holds its issuer as a preview origin, which `origin add --kind primary`
 * refuses as a conflict: `doctor --fix` makes it primary for the project
 * `.zitadel/secret` records, the one doctor repairs, and any other project
 * removes the pattern and adds it back. Otherwise the issuer is added as
 * primary, or the URL the developer fills in when no issuer resolves.
 */
export function missingPrimaryOrigin(input: {
  origins: ReadonlyArray<ProjectOrigin>;
  issuer: string | undefined;
  setupProject: boolean;
  suggest: (command: string) => SuggestedCommand;
}): { hint: string; next: readonly string[] } {
  const preview =
    input.issuer === undefined ? undefined : issuerHeldAsPreview(input.origins, input.issuer);
  if (preview !== undefined) {
    const held = `It holds its issuer ${preview} as a preview origin, as \`zitadel setup\` 0.1.0 registered it, so adding it as primary conflicts.`;
    if (input.setupProject) {
      return {
        hint: `${held} Run \`${input.suggest("doctor --fix")}\` to make it primary, then deploy.`,
        next: ["doctor --fix"],
      };
    }
    const remove = `origin rm ${Cmd.quote(preview)} --force`;
    const add = `origin add ${Cmd.quote(preview)} --kind primary`;
    return {
      hint: `${held} Remove it with \`${input.suggest(remove)}\`, add it back with \`${input.suggest(add)}\`, then deploy.`,
      // Both steps, in the order they must run: removing the pattern leaves
      // the project admitting every origin until it is added back.
      next: [remove, add],
    };
  }
  if (input.issuer !== undefined) {
    const add = `origin add ${Cmd.quote(originOf(input.issuer))} --kind primary`;
    return {
      hint: `Add the URL the app serves from with \`${input.suggest(add)}\`, then deploy.`,
      next: [add],
    };
  }
  return {
    hint: `Add one with \`${input.suggest("origin add <url> --kind primary")}\`, then deploy.`,
    next: ["origin list"],
  };
}

const NEEDS_MESSAGE_REFUSAL: Refusal = {
  message: "A deploy needs a message in non-interactive mode",
  hint: "Pass -m/--message with a short summary of what this release changes, or deploy from a clean git commit.",
};

/** How a project with nowhere to land a deploy is refused. */
const NO_PRIMARY_ORIGIN_REFUSAL: Refusal = {
  message: "The project has no primary origin to deploy to",
  hint: "{hint}",
  next: ["{next}"],
};

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
    message: Flags.custom<string>({
      parse: reads(MESSAGE),
    })({
      char: "m",
      description:
        "A short summary of what this release changes. Defaults to the pull request's title or the current commit's subject.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof Deploy>): Promise<JsonEnvelope> {
    // Why the deploy happened: the message it was given, or the one its
    // environment implies. Interactively it can be left off; a scripted run
    // with nothing to fall back on must name one, and is refused before
    // anything is built or asked for — the message is the directory's and the
    // environment's to answer, so nothing is connected to find it out. A dry
    // run records nothing, so it needs none.
    const message = this.dryRun
      ? undefined
      : await deployMessage(flags.message, this.cwd, this.env);
    if (!this.dryRun && this.nonInteractive && message === undefined) {
      throw refusalError(NEEDS_MESSAGE_REFUSAL, {});
    }
    const { client, projectId, environment } = await this.connect();
    // A deploy goes to every primary origin, so the project must have one.
    // Checked before the bundle is built and the IdP connections are synced,
    // so a project with none fails before the IdP step writes part of a
    // change. A dry run never reaches the deploy, so it is exempt.
    const landing = this.dryRun ? [] : await this.primaryOrigins(client, projectId, environment);

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
      learned: {},
    };

    // Before-release steps: validate, then diff, which `--json` reports as
    // `diff` on a dry run and a deploy alike, then the lockout check, which
    // only matters when the diff found schemas or flows changed.
    const reported = await runSteps([validateStep, diffStep, lockoutStep], ctx);

    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: resourceCount,
          targets: "primary",
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
      message,
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
    const observed = deployments.find((deployment) => {
      return deployment.targets.some((entry) => {
        return landing.includes(entry.origin);
      });
    })?.id;
    const deployment = await createDeployment(client, projectId, {
      releaseId: release.id,
      targets: "primary",
      message,
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

  /**
   * The primary origins this deploy lands on, refusing a project with none and
   * naming the step that gives it one.
   */
  private async primaryOrigins(
    client: Connection["client"],
    projectId: string,
    environment: Connection["environment"],
  ): Promise<string[]> {
    const project = await client.getProject(projectId);
    const origins = project.origins ?? [];
    const landing = origins
      .filter((entry) => {
        return entry.kind === "primary";
      })
      .map((entry) => {
        return entry.pattern;
      });
    if (landing.length > 0) {
      return landing;
    }
    const setupProject = await readZitadelSecret(this.cwd).then(
      (secret) => {
        return secret.project_id;
      },
      () => {
        return undefined;
      },
    );
    throw refusalError(
      NO_PRIMARY_ORIGIN_REFUSAL,
      missingPrimaryOrigin({
        origins,
        issuer: environment.values.ZITADEL_ISSUER?.value,
        setupProject: setupProject === projectId,
        suggest: (command) => {
          return this.suggest(command);
        },
      }),
      (next) => {
        return this.suggest(next);
      },
    );
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
