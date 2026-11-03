import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { createDeployment } from "../../lib/release";

/**
 * `zitadel deployment create --release <id>` — make an existing release live.
 *
 * The low-level counterpart of `deploy`: it deploys a release that already
 * exists rather than assembling one from `.zitadel/`. By default it targets
 * every primary origin: primary origins are never named one by one. Deploying
 * the release a target already serves changes nothing.
 */
import { refuseBlank } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "../../lib/release";

const MESSAGE_TOO_LONG_REFUSAL: Refusal = {
  message: "the message is longer than {limit} characters",
  hint: "Pass a shorter summary with -m.",
  details: {
    argument: "--message",
  },
};

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject. It returns the message trimmed.
 */
function readMessage(input: string): string {
  const value = refuseBlank(input, "--message", "the value is empty");
  if (messageTooLong(value)) {
    throw refusalError(MESSAGE_TOO_LONG_REFUSAL, {
      limit: MESSAGE_MAX_LENGTH,
    });
  }
  return value;
}

export default class DeploymentCreate extends EnvironmentCommand {
  static override description = "Deploy an existing release to the project's origins.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = {
    release: Flags.string({ description: "The release id to deploy.", required: true }),
    message: Flags.custom<string>({
      char: "m",
      parse: async (input) => {
        return readMessage(input);
      },
    })({
      description: "A short summary of why this deploys.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof DeploymentCreate>): Promise<JsonEnvelope> {
    const targets = ["primary"];

    // A dry run makes no request, so it answers before the connection — the
    // order `origin add`/`deploy` use, which keeps the no-mutation promise
    // literal: deploying an existing release writes a deployment record, and a
    // dry run must write none.
    if (this.dryRun) {
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
      },
      next: { commands: [this.suggest("deployment list")] },
      pretty: [
        `Deployed ${deployment.release_id} to ${origins.length} origin${origins.length === 1 ? "" : "s"}`,
        ...origins.map((origin) => `  - ${origin}`),
      ].join("\n"),
    });
  }
}
