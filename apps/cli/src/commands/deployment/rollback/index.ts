import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "../../../lib/oclif";
import { Tabulatable } from "../../../lib/oclif/tabulatable";
import { reads, type Refused } from "../../../lib/oclif/flags";
import { DeploymentService, ReleaseService, type ReleasePointer } from "../../../lib/backend";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "../../../lib/publish";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { toZitadelError } from "../../../lib/errors";
import { Destructive } from "../../../lib/oclif/destructive";
import { reportWarning } from "../../../lib/warnings";

const NOTHING_DEPLOYED_REFUSAL: Refusal = {
  message: "There is no deployment to roll back",
  hint: "Nothing has been deployed yet; check `zitadel deployment list`.",
  next: ["deployment list"],
};

const NOTHING_EARLIER_REFUSAL: Refusal = {
  message: "There is no earlier deployment to roll back to",
  hint: "Name a deployment to re-apply, or check `zitadel deployment list`.",
  next: ["deployment list"],
};

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject. `messageTooLong` counts code points, as the server does, so the
 * length is its call and not the schema's. The message is trimmed.
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
 * `zitadel deployment rollback [<deployment_id>]` — re-apply an earlier
 * deployment.
 *
 * Bare, it undoes the last deploy: it re-applies the deployment that was live
 * before the current one. Given a `<deployment_id>`, it re-applies exactly that
 * one. It reports the revisions that release pins, and that users keep theirs:
 * configuration rolls back, user data does not.
 */
export default class DeploymentRollback extends Tabulatable(Destructive(EnvironmentCommand)) {
  static override description = "Roll back to an earlier deployment.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment rollback",
    "<%= config.bin %> deployment rollback dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
    "<%= config.bin %> deployment rollback --force",
  ];
  static override args = {
    deployment_id: nonBlankArg({
      required: false,
      description: "The deployment to re-apply. Omit to undo the last deploy.",
    }),
  };
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Re-apply the deployment without the confirmation prompt. Required when non-interactive.",
    }),
    message: Flags.custom<string>({
      char: "m",
      parse: reads(MESSAGE),
    })({
      description: "A short summary of why this rolls back.",
    }),
  };

  protected async execute({
    flags,
    args,
  }: Admitted<typeof DeploymentRollback>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const deploymentService = new DeploymentService(client, projectId);
    const suggest = (command: string) => {
      return this.suggest(command);
    };
    const plan = await deploymentService.planRollback(args.deploymentId);
    switch (plan.outcome) {
      case "nothing-deployed":
        throw refusalError(NOTHING_DEPLOYED_REFUSAL, {}, suggest);
      case "nothing-earlier":
        throw refusalError(NOTHING_EARLIER_REFUSAL, {}, suggest);
      case "target":
        break;
    }
    const { target } = plan;

    return this.emit(
      await this.confirmed({
        verb: "rollback",
        name: `re-apply ${target.id}`,
        message: `Re-apply ${target.id}? Its release goes live again.`,
        // A bare rollback resolved its target, which a retry must not resolve
        // again: a deploy landing in between would name another.
        arguments: [target.id],
        // A dry run re-applies nothing, so it stops once the target is
        // resolved: a rollback re-serves an earlier release, and a dry run
        // must leave what is served untouched.
        preview: () => {
          return {
            status: "ok",
            data: { dry_run: true, deployment_id: target.id },
            pretty: `Would re-apply ${target.id}. Nothing was rolled back (dry run).`,
          };
        },
        // The deployment the caller currently sees live: the project's newest
        // primary deployment, which is what the server compares against. Read
        // before the confirmation and passed through as the optimistic guard,
        // so a deploy that lands while the prompt is open (or between this
        // read and the write in non-interactive mode) makes the server answer
        // 409 rather than letting the rollback overwrite a change the caller
        // never saw. Omitted when nothing is live there, which an optional id
        // cannot stand in for.
        prepare: async () => {
          return target.expectedDeploymentId ?? (await deploymentService.newestPrimary())?.id;
        },
        apply: async (consent, guard) => {
          const unlocked = new DeploymentService(consent.unlock(client), projectId);
          const deployment = await unlocked.rollback(target.id, {
            ...(flags.message === undefined ? {} : { message: flags.message }),
            ...(guard === undefined ? {} : { expected_deployment_id: guard }),
          });
          const releaseService = new ReleaseService(client, projectId);
          const release = await releaseService
            .get(deployment.release_id)
            .catch((error: unknown) => {
              reportWarning(
                `Rolled back, but the revisions ${deployment.release_id} pins could not be read: ${toZitadelError(error).message}`,
              );
              return undefined;
            });
          const pointers: readonly ReleasePointer[] | undefined = release?.pointers;

          const pointerTable =
            pointers === undefined
              ? undefined
              : await this.tabulate(["kind", "handle", "revision_id"], pointers);
          return {
            status: "ok",
            data: {
              deployment_id: deployment.id,
              release_id: deployment.release_id,
              rolled_back_to: deployment.metadata.rollback_to,
              origins: deployment.origins,
              ...(pointers === undefined ? {} : { pointers }),
            },
            pretty: [
              `Rolled back to ${deployment.release_id} on ${deployment.origins.join(", ")}`,
              ...(pointerTable === undefined ? [] : ["", pointerTable]),
              "",
              "Users keep the schema revision and attributes they have: a rollback does not migrate them back.",
            ].join("\n"),
          };
        },
      }),
    );
  }
}
