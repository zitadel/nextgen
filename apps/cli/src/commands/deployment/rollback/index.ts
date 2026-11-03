import { Flags } from "@oclif/core";
import type { GetReleaseById200PointersItem } from "@zitadel/api/generated/model";

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
import { deploymentHistory } from "./requirements/history";
import { rollbackTarget } from "./requirements/target";
import { toZitadelError } from "../../../lib/errors";
import { Destructive } from "../../../lib/oclif/destructive";
import { reportWarning } from "../../../lib/warnings";

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

  static override requires = {
    history: deploymentHistory,
    target: rollbackTarget,
  };

  protected async execute({
    flags,
    target,
  }: Admitted<typeof DeploymentRollback>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

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
