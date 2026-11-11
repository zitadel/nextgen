import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import {
  DeploymentService,
  type ReleasePointer,
  ReleaseService,
  type ZitadelClient,
} from "@/lib/backend";
import { RollbackDeploymentParams } from "@/lib/backend/schemas";
import { isCancellation, toZitadelError } from "@/lib/errors";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { reads, type Refused, taken } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Tabulatable } from "@/lib/oclif/tabulatable";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

const NOTHING_DEPLOYED_REFUSAL: Refusal = {
  message: "There is no deployment to roll back",
  hint: "Nothing has been deployed yet; list the deployments to check.",
  next: ["deployment list"],
};

const NOTHING_EARLIER_REFUSAL: Refusal = {
  message: "There is no earlier deployment to roll back to",
  hint: "Name a deployment to roll back to, or list the deployments to see which there are.",
  next: ["deployment list"],
};

/**
 * The deployment `deployment rollback` re-applies. The schema is the API spec's own, so a value that is not one is
 * refused before anything is asked or called, and says what one looks like.
 */
const DEPLOYMENT_ID: Refused<string> = {
  schema: z.string().trim().pipe(RollbackDeploymentParams.shape.deployment_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel deployment list`, or omit it to undo the last deploy.",
    next: ["deployment list"],
    details: {
      argument: "{input}",
    },
  },
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
 * `zitadel deployment rollback [<deployment_id>]` — roll back to an earlier
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
    deployment_id: Args.custom<string>({
      parse: taken(DEPLOYMENT_ID),
    })({
      required: false,
      description: "The deployment to roll back to. Omit to undo the last deploy.",
    }),
  };
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Roll back to the deployment without the confirmation prompt. Required when non-interactive.",
    }),
    message: Flags.custom<string>({
      char: "m",
      parse: reads(MESSAGE),
    })({
      description: "A short summary of why this rolls back.",
    }),
  };

  protected async execute({
    args,
    flags,
  }: Admitted<typeof DeploymentRollback>): Promise<JsonEnvelope> {
    const { client, projectId, server } = await this.connect();
    const deploymentService = new DeploymentService(client, projectId);
    const suggest = (command: string) => {
      return this.suggest(command);
    };
    const plan = await deploymentService.planRollback(args.deploymentId);
    switch (plan.outcome) {
      case "nothing-deployed": {
        throw refusalError(NOTHING_DEPLOYED_REFUSAL, {}, suggest);
      }
      case "nothing-earlier": {
        throw refusalError(NOTHING_EARLIER_REFUSAL, {}, suggest);
      }
      case "target": {
        break;
      }
    }
    const { target } = plan;
    const changes = await originChanges(client, deploymentService, projectId, target.id);
    const dropped = changes?.dropped ?? [];
    const restored = changes?.restored ?? [];

    const effects: string[] = [];
    if (dropped.length > 0) {
      effects.push(
        `${escapeControlCharacters(dropped.join(", "))} refuse sign-in until the next deploy`,
      );
    }
    if (restored.length > 0) {
      effects.push(`${escapeControlCharacters(restored.join(", "))} serve it again`);
    }
    // Left out when the check failed: an empty list would claim it passed.
    const reported =
      changes === undefined
        ? {}
        : {
            dropped_origins: changes.dropped,
            restored_origins: changes.restored,
            unserved_origins: changes.unserved,
          };
    let consequence = "";
    if (effects.length > 0) {
      consequence = `, which makes ${new Intl.ListFormat("en", { type: "conjunction" }).format(effects)}`;
    }

    return this.emit(
      await this.confirmed({
        verb: "rollback",
        name: `roll back to ${target.id}`,
        message: `Roll back to ${target.id} in project ${projectId} on ${server.replace(/^https?:\/\//, "")} so its release goes live again${consequence}?`,
        // A bare rollback resolved its target, which a retry must not resolve
        // again: a deploy landing in between would name another.
        arguments: [target.id],
        // A dry run re-applies nothing, so it stops once the target is
        // resolved: a rollback re-serves an earlier release, and a dry run
        // must leave what is served untouched.
        preview: () => {
          const title = `Would roll back to ${escapeControlCharacters(target.id)} (dry run)`;
          if (dropped.length > 0) {
            reportWarning(
              `Rolling back to ${target.id} restores origins that leave out ${dropped.join(", ")}: they would refuse sign-in until the next deploy.`,
            );
          }
          if (restored.length > 0) {
            reportWarning(
              `Rolling back to ${target.id} includes ${restored.join(", ")}: they would serve its release again.`,
            );
          }

          return {
            status: "ok",
            data: {
              dry_run: true,
              title,
              deployment_id: target.id,
              ...reported,
            },
            summary: {
              title,
              sections: [],
            },
            next: { commands: [this.suggest(`deployment rollback ${target.id} --force`)] },
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
              // Cancelling is not a revision list that could not be read: the
              // person asked the command to stop, so it stops.
              if (isCancellation(error)) {
                throw error;
              }
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
          if (dropped.length > 0) {
            reportWarning(
              `Rolled back to origins that leave out ${dropped.join(", ")}: they refuse sign-in until the next deploy.`,
            );
          }
          if (restored.length > 0) {
            reportWarning(
              `Rolled back to origins that include ${restored.join(", ")}: they serve ${deployment.release_id} again.`,
            );
          }
          const title = `Rolled back to ${escapeControlCharacters(deployment.release_id)}`;

          return {
            status: "ok",
            data: {
              title,
              deployment_id: deployment.id,
              release_id: deployment.release_id,
              rolled_back_to: deployment.metadata.rollback_to,
              origins: deployment.origins,
              ...reported,
              ...(pointers === undefined ? {} : { pointers }),
            },
            summary: {
              title,
              sections: [],
              lines: [
                ...(deployment.origins.length === 0
                  ? []
                  : [
                      `Live on ${new Intl.ListFormat("en", { type: "conjunction" }).format(
                        deployment.origins.map((origin) => {
                          return escapeControlCharacters(origin);
                        }),
                      )}.`,
                      "",
                    ]),
                ...(pointerTable === undefined ? [] : [...pointerTable.split("\n"), ""]),
                "Users keep the schema revision and attributes they have: a rollback does not migrate them back.",
              ],
            },
          };
        },
      }),
    );
  }
}

/**
 * What a rollback to a deployment does to the project's origins, since it
 * restores the origins that deployment froze. `dropped` are listed but left
 * out, so they refuse; `restored` are listed, left out by the live deployment
 * and served again; `unserved` are named but no longer listed. Undefined when
 * the check could not run.
 */
async function originChanges(
  client: ZitadelClient,
  deployments: DeploymentService,
  projectId: string,
  deploymentId: string,
): Promise<{ dropped: string[]; restored: string[]; unserved: string[] } | undefined> {
  // Only a warning hangs on this, so a failed read says so and rolls back.
  const read = await Promise.all([
    client.getDeploymentById(deploymentId, { project_id: projectId }),
    client.getProject(projectId),
    deployments.newestPrimary(),
  ]).catch((error: unknown) => {
    reportWarning(
      `Could not check which origins rolling back to ${deploymentId} changes: ${toZitadelError(error).message}`,
    );
    return undefined;
  });
  if (read === undefined) {
    return undefined;
  }
  const [deployment, project, live] = read;
  const frozen = deployment.targets.map((target) => {
    return target.origin;
  });
  const listed = (project.origins ?? [])
    .filter((origin) => {
      return origin.kind === "primary";
    })
    .map((origin) => {
      return origin.pattern;
    });
  const served = live?.origins ?? [];
  return {
    dropped: listed.filter((origin) => {
      return !frozen.includes(origin);
    }),
    restored: frozen.filter((origin) => {
      return listed.includes(origin) && !served.includes(origin);
    }),
    unserved: frozen.filter((origin) => {
      return !listed.includes(origin);
    }),
  };
}
