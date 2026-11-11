import { Flags } from "@oclif/core";
import { z } from "zod";

import { renderCount } from "@/lib/count";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { DeploymentService } from "@/lib/backend";
import { GetReleaseByIdParams } from "@/lib/backend/schemas";

import { reads, type Refused } from "@/lib/oclif/flags";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * The release `--release` deploys. The schema is the API spec's own, so a
 * value that is not a release id is refused before anything is called, and
 * says what one looks like.
 */
const RELEASE: Refused<string> = {
  schema: z.string().trim().pipe(GetReleaseByIdParams.shape.release_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel release list`.",
    next: ["release list"],
    details: {
      argument: "{input}",
    },
  },
};

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

  static override examples = [
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = {
    release: Flags.custom<string>({
      parse: reads(RELEASE),
    })({ description: "The release id to deploy.", required: true }),
    message: Flags.custom<string>({
      parse: reads(MESSAGE),
    })({
      char: "m",
      description: "A short summary of why this deploys.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof DeploymentCreate>): Promise<JsonEnvelope> {
    // A dry run makes no request, so it answers before the connection — the
    // order `origin add`/`deploy` use, which keeps the no-mutation promise
    // literal: deploying an existing release writes a deployment record, and a
    // dry run must write none.
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, release_id: flags.release, targets: "primary" },
        summary: {
          title: `Would deploy ${escapeControlCharacters(flags.release)} to primary (dry run)`,
          sections: [],
        },
      });
    }

    const { client, projectId } = await this.connect();

    const deploymentService = new DeploymentService(client, projectId);
    const deployment = await deploymentService.create({
      release_id: flags.release,
      targets: "primary",
      message: flags.message,
    });

    return this.emit({
      status: "ok",
      data: {
        deployment_id: deployment.id,
        release_id: deployment.release_id,
        origins: deployment.origins,
      },
      next: { commands: [this.suggest("deployment list")] },
      // One clause and nothing else: spelling the origins out would make the
      // headline as long as the project has origins. `--json` and
      // `deployment get` name them.
      summary: {
        title: `Deployed ${escapeControlCharacters(deployment.release_id)} to ${renderCount(deployment.origins.length, { singular: "origin" })}`,
        sections: [],
      },
    });
  }
}
