import { Flags } from "@oclif/core";
import type { ZitadelClient } from "@zitadel/api/client";
import type {
  GetReleaseById200PointersItem,
  ListDeployments200DeploymentsItem,
} from "@zitadel/api/generated/model";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { collectPages } from "../../lib/oclif/crud/paging";
import { renderTable } from "../../lib/oclif/crud/table";
import { listLiveDeployments, rollbackDeployment, servesPrimary } from "../../lib/release";
import { toZitadelError, ZitadelError } from "../../lib/errors";
import { Promptable } from "../../lib/oclif/promptable";
import { reportWarning } from "../../lib/warnings";

/**
 * `zitadel deployment rollback [<deployment_id>]` — re-apply an earlier
 * deployment.
 *
 * Bare, it undoes the last deploy: it re-applies the deployment that was live
 * before the current one. Given a `<deployment_id>`, it re-applies exactly that
 * one. A rollback re-serves an earlier release, so it takes the `--force`-or-confirm
 * gate the destructive commands use. It reports the revisions that release
 * pins, and that users keep theirs: configuration rolls back, user data does
 * not.
 */
export default class DeploymentRollback extends Promptable(EnvironmentCommand) {
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
      description: "Roll back without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(DeploymentRollback);
    await this.toMeta(flags);
    const { dryRun } = this.meta;

    const { client, projectId } = await this.connect();

    // Bare: undo the latest deployment by re-applying what its targets served
    // before it. With an id, re-apply exactly that one.
    let targetId = args.deployment_id as string | undefined;
    // The bare form decides from one read of the history, so its guard comes
    // from that same read: a deploy landing after it is one the caller never
    // saw, and must make the server refuse rather than become the expected one.
    let bareGuard: string | undefined;
    if (targetId === undefined) {
      // The prior deployment of a long-lived origin can sit beyond the
      // server's first page, so the whole history is drained rather than the
      // default page searched — otherwise a bare rollback would miss a target
      // further back and refuse a rollback it should resolve.
      const { items } = await collectPages(
        (token) =>
          client.listDeployments({
            project_id: projectId,
            ...(token === undefined ? {} : { page_token: token }),
          }),
        { items: "deployments", all: true, nextPageToken: "next_page_token" },
      );
      // A preview deployment is never the deploy a bare rollback undoes, nor
      // one it can restore: the server refuses to roll one back. Primary
      // deployments make one history for the project, newest first.
      const history = (items as ListDeployments200DeploymentsItem[]).filter(servesPrimary);
      const [latest, prior] = history;
      if (!latest) {
        throw new ZitadelError("E_VALIDATION", "There is no deployment to roll back", {
          hint: `Nothing has been deployed yet; check \`zitadel deployment list${this.environmentSelector()}\`.`,
        });
      }
      if (!prior) {
        throw new ZitadelError("E_VALIDATION", "There is no earlier deployment to roll back to", {
          hint: `Name a deployment to re-apply, or check \`zitadel deployment list${this.environmentSelector()}\`.`,
        });
      }
      targetId = prior.id;
      bareGuard = latest.id;
    }

    // A dry run re-applies nothing, so it stops once the target is resolved,
    // before the destructive-confirm gate and the write: a rollback re-serves
    // an earlier release, and a dry run must leave what is served untouched.
    if (dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, deployment_id: targetId },
        pretty: `Would re-apply ${targetId}. Nothing was rolled back (dry run).`,
      });
    }

    // The deployment the caller currently sees live: the project's newest
    // primary deployment, which is what the server compares against. Read before the
    // confirmation gate and passed through as the optimistic guard, so a
    // deploy that lands while the prompt is open (or between this read and the
    // write in non-interactive mode) makes the server answer 409 rather than
    // letting the rollback overwrite a change the caller never saw. Omitted
    // when nothing is live there, which an optional id cannot stand in for.
    const expectedDeploymentId = bareGuard ?? (await liveGuard(client, projectId));

    const confirmed = await this.input({
      kind: "confirm",
      name: `re-apply ${targetId}`,
      message: `Re-apply ${targetId}? Its release goes live again.`,
      retry: this.suggest(`deployment rollback ${targetId} --force`),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "rollback-cancelled" });
    }

    const deployment = await rollbackDeployment(client, projectId, targetId, {
      ...(expectedDeploymentId === undefined ? {} : { expectedDeploymentId }),
    });

    let pointers: readonly GetReleaseById200PointersItem[] | undefined;
    try {
      pointers = (await client.getReleaseById(deployment.release_id, { project_id: projectId }))
        .pointers;
    } catch (error) {
      reportWarning(
        `Rolled back, but the revisions ${deployment.release_id} pins could not be read: ${toZitadelError(error).message}`,
      );
    }

    const origins = deployment.targets.map((target) => target.origin);
    return this.emit({
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
        ...(pointers === undefined
          ? []
          : ["", renderTable(["kind", "handle", "revision_id"], pointers)]),
        "",
        "Users keep the schema revision and attributes they have: a rollback does not migrate them back.",
      ].join("\n"),
    });
  }
}

/** The project's newest primary deployment, which a rollback is guarded by. */
async function liveGuard(client: ZitadelClient, projectId: string): Promise<string | undefined> {
  return (await listLiveDeployments(client, projectId)).find(servesPrimary)?.id;
}
