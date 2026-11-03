import { Args } from "@oclif/core";
import { z } from "zod";

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GetReleaseById200PointersItemKind } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "../../lib/api-client";
import { ZitadelError } from "../../lib/errors";
import { FLOWS_DIR } from "../../lib/flows";
import { readJsonDirEntries } from "../../lib/json-dir";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../../lib/oclif";
import { DEPLOY_ARGS, DeploymentService, ReleaseService } from "../../lib/backend";
import { writeBackResource } from "../../lib/sync";
import { SCHEMAS_DIR } from "../../lib/user-schema";
import { type Refused, taken } from "../../lib/oclif/flags";
import { reportWarning } from "../../lib/warnings";

/** What a pull target names, or that it names nothing pull understands. */
type PullTarget =
  | { readonly kind: "latest" }
  | { readonly kind: "release"; readonly id: string }
  | { readonly kind: "deployment"; readonly id: string }
  | { readonly kind: "invalid" };

/** A pull target that names something pull can read. */
type ReadablePullTarget = Exclude<PullTarget, { readonly kind: "invalid" }>;

/** The live release, what is pulled when no target is given. */
const LATEST_TARGET: ReadablePullTarget = {
  kind: "latest",
};

/**
 * What to pull: `latest` (the live release), a release id (`rel_…`) or a
 * deployment id (`dep_…`), refusing anything else.
 */
const TARGET: Refused<ReadablePullTarget> = {
  schema: z
    .string()
    .refine((target) => {
      return target === "latest" || target.startsWith("rel_") || target.startsWith("dep_");
    })
    .transform((target): ReadablePullTarget => {
      if (target === "latest") {
        return { kind: "latest" };
      }
      if (target.startsWith("rel_")) {
        return { kind: "release", id: target };
      }
      return { kind: "deployment", id: target };
    }),
  refusal: {
    message: 'Don\'t know how to pull "{value}".',
    hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
  },
};

/**
 * A resource kind `pull` can rebuild on disk from the revision a release pins:
 * it knows the kind's directory, how to read the pinned revision's body, and
 * how to read the handle off a body so an existing file for the same resource
 * is overwritten rather than duplicated.
 *
 * Only `schema` and `flow_definition` qualify (issue #541): their `revision_id`
 * is the id their read endpoint takes. A release also pins `branding` and `idp`,
 * but those pin a revision id the per-kind read endpoints do not accept yet, so
 * a release that carries them is pulled for the kinds it can and warns for the
 * rest — they gain a pull path when their reads are revision-addressable. A
 * pinned `policy` is skipped the same way until pull learns to write one.
 */
type Reconstructable = {
  readonly dir: string;
  read(client: ZitadelClient, revisionId: string): Promise<object>;
  handleOf(body: Record<string, unknown>): string | undefined;
};

/** The release-pointer kinds `pull` can rebuild on disk. */
type ReconstructableKind = "schema" | "flow_definition";

// Keyed by every kind a release pins, so a kind pull cannot rebuild yet
// (branding, idp, policy) looks up as missing.
export const RECONSTRUCTABLE: Readonly<Record<ReconstructableKind, Reconstructable>> &
  Readonly<Partial<Record<GetReleaseById200PointersItemKind, Reconstructable>>> = {
  schema: {
    dir: SCHEMAS_DIR,
    read: async (client, revisionId) => {
      const response = await client.getSchemaById(revisionId);
      return response.schema;
    },
    handleOf: (body) => (typeof body.objectType === "string" ? body.objectType : undefined),
  },
  flow_definition: {
    dir: FLOWS_DIR,
    read: async (client, revisionId) => {
      const response = await client.getFlowDefinition(revisionId);
      return response.flow_definition;
    },
    handleOf: (body) => (typeof body.name === "string" ? body.name : undefined),
  },
};

/**
 * The file a handle already lives in under `dir`, or `<dir>/<handle>.json` when
 * none does. Setup writes a schema to `default-human-user.json` though its
 * object type is `human-user`, so matching by the body's handle — not by the
 * file name — keeps a pull overwriting that file instead of leaving a second
 * one for the same resource, which a deploy would then reject as two revisions
 * of one handle.
 */
export async function relPathForHandle(
  cwd: string,
  kind: Reconstructable,
  handle: string,
): Promise<string> {
  const entries = await readJsonDirEntries(join(cwd, kind.dir));
  const match = entries.find((entry) => kind.handleOf(entry.body) === handle);
  return `${kind.dir}/${match ? match.name : `${handle}.json`}`;
}

/**
 * `zitadel pull [target]` — rebuild `.zitadel/` from the revisions a released
 * snapshot pins, the inverse of `deploy`.
 *
 * `deploy` builds an immutable release from the files on disk and makes it
 * live; `pull` goes the other way, writing each revision a release pins back
 * into `.zitadel/` so the working copy matches what a release shipped. The use
 * case is adoption: bring the live configuration (or a specific release) into
 * the git-tracked source of truth, then edit and `deploy` again.
 *
 * The target is the live release by default, a release id (`rel_…`), or a
 * deployment id (`dep_…`) whose release is pulled. A release references each
 * resource by handle, so files are written by handle and the next `deploy`
 * rebuilds the same release.
 */
export default class Pull extends EnvironmentCommand {
  static override description =
    "Rebuild your .zitadel/ files from a release.\n\nWrites .zitadel/ from the revisions a released snapshot pins.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 2;
  static override examples = [
    "<%= config.bin %> pull",
    "<%= config.bin %> pull rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
    "<%= config.bin %> pull dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
  ];
  static override args = {
    target: Args.custom<ReadablePullTarget>({
      parse: taken(TARGET),
    })({
      default: LATEST_TARGET,
      defaultHelp: async () => "latest",
      description:
        "What to pull: 'latest' (the live release), a release id (rel_…), or a deployment id (dep_…).",
    }),
  };

  protected async execute({ args }: Admitted<typeof Pull>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

    const releaseId = await this.resolveReleaseId(client, projectId, args.target);
    const releaseService = new ReleaseService(client, projectId);
    const release = await releaseService.get(releaseId);

    const pulled: { kind: string; handle: string; path: string }[] = [];
    const skipped: { kind: string; handle: string }[] = [];
    for (const pointer of release.pointers) {
      const kind = RECONSTRUCTABLE[pointer.kind];
      if (kind === undefined) {
        skipped.push({ kind: pointer.kind, handle: pointer.handle });
        continue;
      }
      const body = await kind.read(client, pointer.revision_id);
      const relPath = await relPathForHandle(this.cwd, kind, pointer.handle);
      if (!this.dryRun) {
        await mkdir(dirname(join(this.cwd, relPath)), { recursive: true });
        // The read body is the server's canonical form; write it verbatim
        // (carrying over any local `$schema` editor pointer) with no
        // normalizer, so what lands is exactly what the release pinned.
        await writeBackResource(this.cwd, relPath, {}, body);
      }
      pulled.push({ kind: pointer.kind, handle: pointer.handle, path: relPath });
    }

    for (const resource of skipped) {
      reportSkipped(resource);
    }

    const nextCommands = this.dryRun ? [] : [this.suggest(DEPLOY_ARGS)];
    const summary = pulled.map((entry) => entry.path).join("\n");
    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        pulled,
        skipped,
        ...(this.dryRun ? { dry_run: true } : {}),
      },
      next: { commands: nextCommands },
      pretty: this.dryRun
        ? `Would write ${pulled.length} file${pulled.length === 1 ? "" : "s"} from ${release.id} (dry run).\n${summary}`
        : `Pulled ${pulled.length} file${pulled.length === 1 ? "" : "s"} from ${release.id}.\n${summary}`,
    });
  }

  /**
   * The release a target names: `rel_…` as given, the release a `dep_…`
   * deployment made live, or — for `latest` — the release the newest primary
   * deployment serves. A preview deployment never serves a primary origin, so
   * `latest` is the project's live configuration, not a pull-request preview.
   */
  private async resolveReleaseId(
    client: ZitadelClient,
    projectId: string,
    target: ReadablePullTarget,
  ): Promise<string> {
    if (target.kind === "release") {
      return target.id;
    }
    const deploymentService = new DeploymentService(client, projectId);
    if (target.kind === "deployment") {
      const deployment = await deploymentService.get(target.id);
      return deployment.release_id;
    }
    const deployments = await deploymentService.live();
    const deployment = deployments.find(DeploymentService.servesPrimary);
    if (deployment === undefined) {
      throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to a primary origin yet.", {
        hint: `Deploy first with \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`, then pull.`,
      });
    }
    return deployment.release_id;
  }
}

/**
 * Warn that a release pins a resource `pull` cannot rebuild on disk yet. A
 * reported warning rides the envelope (BaseCommand merges them), so a `--json`
 * caller sees it too.
 */
function reportSkipped(resource: { kind: string; handle: string }): void {
  reportWarning(
    `The release pins ${resource.kind} "${resource.handle}", which pull cannot rebuild locally yet; reconcile it by hand.`,
  );
}
