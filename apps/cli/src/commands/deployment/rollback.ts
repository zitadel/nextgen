import { Flags } from "@oclif/core";
import type { ListDeployments200DeploymentsItem } from "@zitadel/api/generated/model";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { collectPages } from "../../lib/oclif/crud/paging";
import { listLiveDeployments, rollbackDeployment, servesPrimary } from "../../lib/release";
import { ZitadelError } from "../../lib/errors";

/**
 * `zitadel deployment rollback [<deployment_id>]` — re-apply an earlier
 * deployment.
 *
 * Bare, it undoes the last deploy: it re-applies the deployment that was live
 * before the current one. Given a `<deployment_id>`, it re-applies exactly that
 * one. `--origin` narrows which origin's history it reads for the bare form. A
 * rollback re-serves an earlier release, so it takes the `--force`-or-confirm
 * gate the destructive commands use.
 */
export default class DeploymentRollback extends EnvironmentCommand {
  static override description = "Roll back to an earlier deployment.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> deployment rollback",
    "<%= config.bin %> deployment rollback dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
    "<%= config.bin %> deployment rollback --origin https://app.acme.com --force",
  ];
  static override args = {
    deployment_id: nonBlankArg({
      required: false,
      description: "The deployment to re-apply. Omit to undo the last deploy.",
    }),
  };
  static override flags = {
    origin: Flags.string({ description: "Which origin's history the bare form reads." }),
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
    if (targetId === undefined) {
      // The prior deployment of a long-lived origin can sit beyond the
      // server's first page, so the whole history is drained rather than the
      // default page searched — otherwise a bare rollback would miss a target
      // further back and refuse a rollback it should resolve.
      const { items } = await collectPages(
        (token) =>
          client.listDeployments({
            project_id: projectId,
            ...(flags.origin === undefined ? {} : { origin: flags.origin }),
            ...(token === undefined ? {} : { page_token: token }),
          }),
        { items: "deployments", all: true, nextPageToken: "next_page_token" },
      );
      // A preview deployment is never the deploy a bare rollback undoes, nor
      // one it can restore: the server refuses to roll one back.
      const deployments = (items as ListDeployments200DeploymentsItem[]).filter(servesPrimary);
      const latest = deployments[0];
      if (!latest) {
        throw new ZitadelError("E_VALIDATION", "There is no deployment to roll back", {
          hint: `Nothing has been deployed yet; check \`zitadel deployment list${this.environmentSelector()}\`.`,
        });
      }
      // Undoing the latest deploy means restoring each origin it touched to
      // the deployment that served it just before — the next one down that
      // origin's history. `--origin` narrows it to that one origin.
      const origins =
        flags.origin === undefined ? latest.targets.map((target) => target.origin) : [flags.origin];
      const priors = origins.map((origin) =>
        deployments
          .slice(1)
          .find((deployment) => deployment.targets.some((target) => target.origin === origin)),
      );
      if (priors.some((prior) => prior === undefined)) {
        throw new ZitadelError("E_VALIDATION", "There is no earlier deployment to roll back to", {
          hint: `Name a deployment to re-apply, or check \`zitadel deployment list${this.environmentSelector()}\`.`,
        });
      }
      // A single rollback re-applies one deployment. When the latest deploy's
      // origins were last served by different deployments, no single one
      // restores them all, so it is refused rather than rolling some back.
      const priorIds = new Set(priors.map((prior) => prior?.id));
      if (priorIds.size !== 1) {
        throw new ZitadelError(
          "E_VALIDATION",
          "The last deployment's origins have different histories, so one rollback can't undo it",
          {
            hint: "Name the deployment to re-apply; it goes live again on every origin it targeted.",
            nextCommands: [this.suggest("deployment list")],
          },
        );
      }
      // A rollback re-applies the named deployment to every origin it
      // targeted, which the request cannot narrow. If that deployment also
      // targeted an origin the undone deploy never touched, and that origin
      // has since moved on to a newer deployment, re-applying it would
      // silently move that origin back too, so it is refused instead. An
      // origin the prior deployment still serves is left exactly as it is.
      const prior = priors[0] as ListDeployments200DeploymentsItem;
      const undone = new Set(origins);
      const beyond = prior.targets
        .map((target) => target.origin)
        .filter(
          (target) =>
            !undone.has(target) &&
            deployments.find((deployment) => deployment.targets.some((t) => t.origin === target))
              ?.id !== prior.id,
        );
      if (beyond.length > 0) {
        throw new ZitadelError(
          "E_VALIDATION",
          `Rolling back to ${prior.id} would also change ${beyond.join(", ")}`,
          {
            hint: `A rollback re-applies ${prior.id} to every origin it targeted. Name it to re-apply it everywhere, or deploy the release you want to the origin instead.`,
            nextCommands: [this.suggest("deployment list")],
          },
        );
      }
      targetId = prior.id;
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

    // The deployment the caller currently sees live on the rollback's targets:
    // the newest live deployment to any origin the re-applied deployment
    // covers, which is what the server compares against. Read before the
    // confirmation gate and passed through as the optimistic guard, so a
    // deploy that lands while the prompt is open (or between this read and the
    // write in non-interactive mode) makes the server answer 409 rather than
    // letting the rollback overwrite a change the caller never saw. Omitted
    // when nothing is live there, which an optional id cannot stand in for.
    const target = await client.getDeploymentById(targetId, { project_id: projectId });
    const targetOrigins = new Set(target.targets.map((entry) => entry.origin));
    const expectedDeploymentId = (await listLiveDeployments(client, projectId)).find((deployment) =>
      deployment.targets.some((entry) => targetOrigins.has(entry.origin)),
    )?.id;

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

    const origins = deployment.targets.map((target) => target.origin);
    return this.emit({
      status: "ok",
      data: {
        deployment_id: deployment.id,
        release_id: deployment.release_id,
        rolled_back_to: deployment.metadata.rollback_to,
        origins,
      },
      pretty: `Rolled back to ${deployment.release_id} on ${origins.join(", ")}`,
    });
  }
}
