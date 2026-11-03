import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { messageFlag } from "./flags/message";
import {
  buildBundle,
  createReleaseFromBundle,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { ZitadelError } from "../../lib/errors";

/**
 * `zitadel release create` — build a release from `.zitadel/` and post it,
 * without deploying it.
 *
 * The same bundle `deploy` assembles, validated the same way, but it stops at
 * the release: nothing is made live. Use it to pin a release a pipeline deploys
 * later, or to read back its content digest. Re-running on unchanged content
 * returns the release that already carries it.
 */
export default class ReleaseCreate extends EnvironmentCommand {
  static override description = "Build a release from .zitadel/ without deploying it.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> release create",
    "<%= config.bin %> release create -m 'add phone_number to human-user'",
  ];
  static override flags = {
    message: messageFlag("A short summary of what this release changes."),
  };

  protected async execute({ flags }: Admitted<typeof ReleaseCreate>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const { bundle, resourceCount, brandingSources, idpFiles, policyFiles } = await buildBundle(
      this.cwd,
    );

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
    // The IdP connections sync before the build, as `deploy` does: a release
    // names its connections by slug, and the server refuses to build one
    // that names a slug the project does not hold yet.
    await runSteps([validateStep], ctx);

    // `release create` carries the same no-mutation promise every command does
    // under `--dry-run`: validate the bundle the same way, then stop before the
    // release is posted so nothing is written server-side.
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, resources: resourceCount },
        pretty: `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"}. No release was created (dry run).`,
      });
    }

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message: flags.message,
      gitSha: await headSha(this.cwd),
      gitDirty: await worktreeIsDirty(this.cwd),
    });
    // Building dedupes on content, revoked releases included: the same tree
    // answers with the revoked release, which can never be deployed.
    if (release.revoked_at) {
      throw new ZitadelError(
        "E_CONFLICT",
        `This content was already released as ${release.id}, which is revoked`,
        {
          hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
          details: { release_id: release.id, content_hash: release.content_hash },
        },
      );
    }

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        resources: resourceCount,
      },
      next: { commands: [this.suggest(`deployment create --release ${release.id}`)] },
      pretty: `Created ${release.id} (${release.content_hash})`,
    });
  }
}
