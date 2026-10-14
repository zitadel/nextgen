import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { createDeployment } from "../../lib/release";
import { nextCommandsData } from "../../lib/oclif/envelope";

/**
 * `zitadel deployment create --release <id>` — make an existing release live.
 *
 * The low-level counterpart of `deploy`: it deploys a release that already
 * exists rather than assembling one from `.zitadel/`. By default it targets
 * every primary origin; `--origin` narrows it to one. Deploying the release a
 * target already serves changes nothing.
 */
export default class DeploymentCreate extends EnvironmentCommand {
  static override description = "Deploy an existing release to the project's origins.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --origin https://app.acme.com",
  ];
  static override flags = {
    release: Flags.string({ description: "The release id to deploy.", required: true }),
    origin: Flags.string({
      description: "Deploy to one primary origin instead of every primary origin.",
    }),
    message: Flags.string({ char: "m", description: "A short summary of why this deploys." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(DeploymentCreate);
    await this.toMeta(flags);

    const targets = flags.origin ? [flags.origin] : ["primary"];

    // A dry run makes no request, so it answers before the connection — the
    // order `origin add`/`deploy` use, which keeps the no-mutation promise
    // literal: deploying an existing release writes a deployment record, and a
    // dry run must write none.
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, release_id: flags.release, targets },
        pretty: `Would deploy ${flags.release} to ${targets.join(", ")}. Nothing was deployed (dry run).`,
      });
    }

    const { client, projectId } = await this.connect();

    const deployment = await createDeployment(client, projectId, {
      releaseId: flags.release,
      targets,
      message: flags.message,
    });

    const origins = deployment.targets.map((target) => target.origin);
    return this.emit({
      status: "ok",
      data: {
        deployment_id: deployment.id,
        release_id: deployment.release_id,
        origins,
        ...nextCommandsData([this.suggest("deployment list")]),
      },
      pretty: [
        `Deployed ${deployment.release_id} to ${origins.length} origin${origins.length === 1 ? "" : "s"}`,
        ...origins.map((origin) => `  - ${origin}`),
      ].join("\n"),
    });
  }
}
