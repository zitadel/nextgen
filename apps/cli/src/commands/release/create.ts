import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import {
  buildBundle,
  createReleaseFromBundle,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";

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
    message: Flags.string({
      char: "m",
      description: "A short summary of what this release changes.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(ReleaseCreate);
    await this.toMeta(flags);
    const { cwd, env, dryRun, isTTY } = this.meta;
    const json = this.jsonEnabled();

    const { client, projectId } = await this.connect();
    const { bundle, resourceCount, brandingSources } = await buildBundle(cwd);

    const ctx: StepContext = {
      cwd,
      client,
      projectId,
      env,
      mode: "deploy",
      dryRun,
      json,
      color: !json && isTTY && flags.color !== false && !process.env.NO_COLOR,
      bundle,
      brandingSources,
    };
    await runSteps([validateStep], ctx);

    // `release create` carries the same no-mutation promise every command does
    // under `--dry-run`: validate the bundle the same way, then stop before the
    // release is posted so nothing is written server-side.
    if (dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, resources: resourceCount },
        pretty: `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"}. No release was created (dry run).`,
      });
    }

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message: flags.message,
      gitSha: await headSha(cwd),
      gitDirty: await worktreeIsDirty(cwd),
    });

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        resources: resourceCount,
        next_commands: [
          `zitadel deployment create --release ${release.id}${this.environmentSelector()}`,
        ],
      },
      pretty: `Created ${release.id} (${release.content_hash})`,
    });
  }
}
