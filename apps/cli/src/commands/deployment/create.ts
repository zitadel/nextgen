import { Flags } from "@oclif/core";
import { z } from "zod";

import { renderCount } from "../../lib/count";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { createDeployment } from "../../lib/release";

import { reads, type Refused } from "../../lib/oclif/flags";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "../../lib/release";

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

export default class DeploymentCreate extends EnvironmentCommand {
  static override description = "Deploy an existing release to the project's origins.";
  static override group = CommandGroups.configuration;

  static override heading = "Creating a deployment";
  static override examples = [
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = {
    release: nonBlankString({ description: "The release id to deploy.", required: true }),
    message: Flags.custom<string>({
      parse: reads(MESSAGE),
    })({
      char: "m",
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
        pretty: `Would deploy ${flags.release} to ${targets.join(", ")} (dry run)`,
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
      // One clause and nothing else. The bulleted list under it was folded
      // into the footer beside the clause, which put a list bullet in the
      // middle of a sentence; spelling the origins out instead would make
      // the clause as long as the project has origins, and a clause too long
      // to read is replaced by "Done". `--json` and `deployment get` name
      // them.
      pretty: `Deployed ${deployment.release_id} to ${renderCount(origins.length, { singular: "origin" })}`,
    });
  }
}
