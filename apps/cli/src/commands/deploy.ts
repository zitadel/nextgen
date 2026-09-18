import { Flags } from "@oclif/core";

import { DEFAULT_ENVIRONMENT } from "../lib/environments";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";
import {
  buildRelease,
  connectEnvironment,
  deployRelease,
  LIVE_ENVIRONMENT,
  syncProjectOrigins,
} from "../lib/ship";

/**
 * `zitadel deploy` — build a release from `.zitadel/` and make it live.
 *
 * The target is one of the environments `zitadel.json` declares (a project
 * on a server); the release lands on that project's `live` environment, the
 * configuration every request is served by unless a preview claims its
 * origin. To try a change before it reaches users, use `zitadel preview`.
 */
export default class Deploy extends BaseCommand {
  static override description =
    "Build a release from .zitadel/ and make it live on an environment's project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 3;
  static override examples = [
    "<%= config.bin %> deploy",
    "<%= config.bin %> deploy --env production --message 'add phone_number to human-user'",
    "<%= config.bin %> deploy --env production --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = {
    env: Flags.string({
      char: "e",
      description: `Environment from zitadel.json whose project receives the release (default: ${DEFAULT_ENVIRONMENT}).`,
      default: DEFAULT_ENVIRONMENT,
    }),
    message: Flags.string({
      char: "m",
      description: "Summary recorded on the release and the deployment.",
    }),
    release: Flags.string({
      description: "Deploy an existing release id instead of packaging .zitadel/.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Deploy);
    await this.toMeta({ ...flags, environment: flags.env });
    const { cwd, dryRun } = this.meta;

    const { target, client } = await connectEnvironment({
      cwd,
      name: flags.env,
      env: this.meta.env,
      serverFlag: this.meta.serverFlag,
    });
    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          environment: flags.env,
          server: target.server,
          project_id: target.projectId,
          target: LIVE_ENVIRONMENT,
        },
      });
    }

    const origins = await syncProjectOrigins({ cwd, client, target });
    const release = await buildRelease({
      cwd,
      client,
      target,
      message: flags.message,
      releaseID: flags.release,
    });
    const deployment = await deployRelease({
      client,
      target,
      environment: LIVE_ENVIRONMENT,
      releaseID: release.id,
      message: flags.message,
    });

    return this.emit({
      status: "ok",
      data: {
        environment: flags.env,
        server: target.server,
        project_id: target.projectId,
        target: LIVE_ENVIRONMENT,
        allowed_origins: origins,
        release,
        deployment,
        next_actions: [
          `${LIVE_ENVIRONMENT} on ${target.projectId} now serves release ${release.id}.`,
          "Try a change before it goes live next time with `zitadel preview`.",
        ],
        next_commands: [publicCliCommand("preview --name <branch>", this.meta.cliVersion)],
      },
    });
  }
}
