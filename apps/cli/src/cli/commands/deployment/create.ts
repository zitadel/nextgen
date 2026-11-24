import { Flags } from "@oclif/core";
import { z } from "zod";

import { DeploymentService } from "@/lib/backend";
import { GetReleaseParams } from "@/lib/backend/schemas";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { reads, type Refused } from "@/cli/core/flags";
import { relatedFlags } from "@/lib/suggestion/relations";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * The release `--release` deploys. The schema is the API spec's own, so a
 * value that is not a release id is refused before anything is called, and
 * says what one looks like.
 */
const RELEASE: Refused<string> = {
  schema: z.string().trim().pipe(GetReleaseParams.shape.release_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "List the releases to find one.",
    next: [{ id: "release:list" }],
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
const MESSAGE = {
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
} as const satisfies Refused<string>;

/**
 * `zitadel deployment create` — deploy an existing release to the project's
 * origins.
 */
export default class DeploymentCreate extends Telemetered(ChangeCommand) {
  static override description = "Deploy an existing release to the project's origins.";
  static override group = CommandGroups.releases;
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = relatedFlags(
    {
      release: Flags.custom<string>({
        parse: reads(RELEASE),
      })({
        description: "The release id to deploy.",
      }),
      message: Flags.custom<string>({
        parse: reads(MESSAGE),
      })({
        char: "m",
        description: "A short summary of why this deploys.",
      }),
    },
    { release: { required: true } },
  );

  /**
   * Says what would be deployed. A dry run makes no request, so it answers
   * before the connection: deploying an existing release writes a deployment
   * record, and a dry run must write none.
   *
   * @param input - The flags the command accepts.
   * @returns The envelope of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof DeploymentCreate>): Promise<CommandResult> {
    const result = dryRunResult({
      verb: "deploy",
      topic: "deployment",
      noun: "release",
      id: flags.release,
      clause: "to primary",
      next: await this.realRun(),
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        release_id: flags.release,
        targets: "primary",
      },
    };
  }

  /**
   * Deploys the release to the project's origins.
   *
   * @param input - The flags the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof DeploymentCreate>): Promise<CommandResult> {
    const deploymentService = await this.service(DeploymentService);
    const deployment = await deploymentService.create({
      release_id: flags.release,
      targets: "primary",
      message: flags.message,
    });

    const title = `Deployed ${escapeControlCharacters(deployment.release_id)}`;

    return {
      status: "ok",
      data: {
        title,
        deployment_id: deployment.id,
        release_id: deployment.release_id,
        origins: deployment.origins,
      },
      summary: {
        title,
        sections: [],
        lines:
          deployment.origins.length === 0
            ? []
            : [
                `Live on ${new Intl.ListFormat("en", { type: "conjunction" }).format(
                  deployment.origins.map((origin) => {
                    return escapeControlCharacters(origin);
                  }),
                )}.`,
              ],
      },
      next: { commands: [this.suggest({ id: "deployment:list" })] },
    };
  }
}
