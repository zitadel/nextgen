import { Flags } from "@oclif/core";
import type {
  GetReleaseById200PointersItem,
  ListDeployments200DeploymentsItem,
} from "@zitadel/api/generated/model";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "../../../lib/oclif";
import { Tabulatable } from "../../../lib/oclif/tabulatable";
import { rollbackDeployment, servesPrimary } from "../../../lib/release";
import { messageFlag } from "../flags/message";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";
import { toZitadelError } from "../../../lib/errors";
import type { SuggestedCommand } from "../../../lib/suggestion";
import { Destructive } from "../../../lib/oclif/destructive";
import { reportWarning } from "../../../lib/warnings";

type Deployment = ListDeployments200DeploymentsItem;

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

/** The newest primary deployment and the one before it, either of which may not exist. */
export type History = Readonly<{
  latest: Deployment | undefined;
  prior: Deployment | undefined;
}>;

/** The deployment a rollback re-applies, and the one it expects to be live. */
export type RollbackTarget = Readonly<{
  id: string;
  expectedDeploymentId: string | undefined;
}>;

/**
 * The primary deployments a bare rollback decides from. A preview deployment is
 * never the one a bare rollback undoes, nor one it can restore. Naming a
 * deployment needs none of it, and reads nothing. Nothing deployed is a
 * refusal, since there is nothing to undo.
 *
 * The whole history is read, not the first page, because the prior deployment
 * of a long-lived origin can sit beyond it, and a bare rollback that missed it
 * would refuse a rollback it should resolve.
 */
export async function readPrimaryHistory(
  given: string | undefined,
  load: () => Promise<readonly Deployment[]>,
  suggest: (command: string) => SuggestedCommand,
): Promise<History> {
  if (given !== undefined) {
    return {
      latest: undefined,
      prior: undefined,
    };
  }
  const [latest, prior] = (await load()).filter(servesPrimary);
  if (latest === undefined) {
    throw refusalError(NOTHING_DEPLOYED_REFUSAL, {}, suggest);
  }
  return {
    latest,
    prior,
  };
}

/**
 * A named deployment is taken as given. A bare rollback decides from the one
 * read of the history, so its guard comes from that same read: a deploy landing
 * after it is one the caller never saw, and must make the server refuse rather
 * than become the expected one. With no deployment before the latest there is
 * nothing to roll back to, which is a refusal.
 */
export function readRollbackTarget(
  given: string | undefined,
  history: History,
  suggest: (command: string) => SuggestedCommand,
): RollbackTarget {
  if (given !== undefined) {
    return {
      id: given,
      expectedDeploymentId: undefined,
    };
  }
  if (history.latest === undefined || history.prior === undefined) {
    throw refusalError(NOTHING_EARLIER_REFUSAL, {}, suggest);
  }
  return {
    id: history.prior.id,
    expectedDeploymentId: history.latest.id,
  };
}

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
    message: messageFlag("A short summary of why this rolls back."),
  };

  protected async execute({
    flags,
    args,
  }: Admitted<typeof DeploymentRollback>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const suggest = (command: string) => {
      return this.suggest(command);
    };
    const history = await readPrimaryHistory(
      args.deploymentId,
      async () => {
        return client.listDeployments.all({ project_id: projectId });
      },
      suggest,
    );
    const target = readRollbackTarget(args.deploymentId, history, suggest);

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
        preview: () => ({
          status: "ok",
          data: { dry_run: true, deployment_id: target.id },
          pretty: `Would re-apply ${target.id}. Nothing was rolled back (dry run).`,
        }),
        // The deployment the caller currently sees live: the project's newest
        // primary deployment, which is what the server compares against. Read
        // before the confirmation and passed through as the optimistic guard,
        // so a deploy that lands while the prompt is open (or between this
        // read and the write in non-interactive mode) makes the server answer
        // 409 rather than letting the rollback overwrite a change the caller
        // never saw. Omitted when nothing is live there, which an optional id
        // cannot stand in for.
        prepare: async () =>
          target.expectedDeploymentId ??
          (await client.listDeployments.all({ project_id: projectId, live: true })).find(
            servesPrimary,
          )?.id,
        apply: async (consent, guard) => {
          const deployment = await rollbackDeployment(consent, client, projectId, target.id, {
            ...(flags.message === undefined ? {} : { message: flags.message }),
            ...(guard === undefined ? {} : { expectedDeploymentId: guard }),
          });
          const release = await client
            .getReleaseById(deployment.release_id, { project_id: projectId })
            .catch((error: unknown) => {
              reportWarning(
                `Rolled back, but the revisions ${deployment.release_id} pins could not be read: ${toZitadelError(error).message}`,
              );
              return undefined;
            });
          const pointers: readonly GetReleaseById200PointersItem[] | undefined = release?.pointers;

          const pointerTable =
            pointers === undefined
              ? undefined
              : await this.tabulate(["kind", "handle", "revision_id"], pointers);
          const origins = deployment.targets.map((target) => target.origin);
          return {
            status: "ok",
            data: {
              deployment_id: deployment.id,
              release_id: deployment.release_id,
              rolled_back_to: deployment.metadata.rollback_to,
              origins,
              ...(pointers === undefined ? {} : { pointers }),
            },
            pretty: [
              `Rolled back to ${deployment.release_id} on ${origins.join(", ")}`,
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
