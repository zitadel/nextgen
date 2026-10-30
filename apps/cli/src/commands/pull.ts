import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Args } from "@oclif/core";

import type { ZitadelClient } from "../lib/api-client";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR } from "../lib/flows";
import { readJsonDirEntries } from "../lib/json-dir";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { nextCommandsData } from "../lib/oclif/envelope";
import { DEPLOY_ARGS, servesPrimary } from "../lib/release";
import { writeBackResource } from "../lib/sync";
import { SCHEMAS_DIR } from "../lib/user-schema";
import { reportWarning } from "../lib/warnings";

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
 * rest — they gain a pull path when their reads are revision-addressable.
 */
type Reconstructable = {
  readonly dir: string;
  read(client: ZitadelClient, revisionId: string): Promise<Record<string, unknown>>;
  handleOf(body: Record<string, unknown>): string | undefined;
};

/** The release-pointer kinds `pull` can rebuild on disk. */
type ReconstructableKind = "schema" | "flow_definition";

export const RECONSTRUCTABLE: Readonly<Record<ReconstructableKind, Reconstructable>> = {
  schema: {
    dir: SCHEMAS_DIR,
    read: async (client, revisionId) => {
      const response = await client.getSchemaById(revisionId);
      return response.schema as Record<string, unknown>;
    },
    handleOf: (body) => (typeof body.objectType === "string" ? body.objectType : undefined),
  },
  flow_definition: {
    dir: FLOWS_DIR,
    read: async (client, revisionId) => {
      const response = await client.getFlowDefinition(revisionId);
      return response.flow_definition as Record<string, unknown>;
    },
    handleOf: (body) => (typeof body.name === "string" ? body.name : undefined),
  },
};

/** What a pull target names, or that it names nothing pull understands. */
export type PullTarget =
  | { readonly kind: "latest" }
  | { readonly kind: "release"; readonly id: string }
  | { readonly kind: "deployment"; readonly id: string }
  | { readonly kind: "invalid" };

/**
 * Classify a pull target: `latest` (the live release), a release id (`rel_…`),
 * a deployment id (`dep_…`), or something pull does not understand. Kept pure
 * and separate from the lookups it drives so the shape is settled before any
 * server call.
 */
export function classifyTarget(target: string): PullTarget {
  if (target === "latest") {
    return { kind: "latest" };
  }
  if (target.startsWith("rel_")) {
    return { kind: "release", id: target };
  }
  if (target.startsWith("dep_")) {
    return { kind: "deployment", id: target };
  }
  return { kind: "invalid" };
}

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
    target: Args.string({
      required: false,
      default: "latest",
      description:
        "What to pull: 'latest' (the live release), a release id (rel_…), or a deployment id (dep_…).",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(Pull);
    await this.toMeta(flags);
    const { cwd, dryRun } = this.meta;
    const { client, projectId } = await this.connect();

    const releaseId = await this.resolveReleaseId(client, projectId, args.target);
    const release = await client.getReleaseById(releaseId, { project_id: projectId });

    const pulled: { kind: string; handle: string; path: string }[] = [];
    const skipped: { kind: string; handle: string }[] = [];
    for (const pointer of release.pointers) {
      // A release may pin kinds pull cannot rebuild yet (branding, idp), so the
      // lookup is over the broad pointer kind and may miss.
      const kind = (RECONSTRUCTABLE as Record<string, Reconstructable | undefined>)[pointer.kind];
      if (kind === undefined) {
        skipped.push({ kind: pointer.kind, handle: pointer.handle });
        continue;
      }
      const body = await kind.read(client, pointer.revision_id);
      const relPath = await relPathForHandle(cwd, kind, pointer.handle);
      if (!dryRun) {
        await mkdir(dirname(join(cwd, relPath)), { recursive: true });
        // The read body is the server's canonical form; write it verbatim
        // (carrying over any local `$schema` editor pointer) with no
        // normalizer, so what lands is exactly what the release pinned.
        await writeBackResource(cwd, relPath, {}, body);
      }
      pulled.push({ kind: pointer.kind, handle: pointer.handle, path: relPath });
    }

    for (const resource of skipped) {
      reportSkipped(resource);
    }

    const nextCommands = dryRun ? [] : [this.suggest(DEPLOY_ARGS)];
    const summary = pulled.map((entry) => entry.path).join("\n");
    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        pulled,
        skipped,
        ...(dryRun ? { dry_run: true } : {}),
        ...nextCommandsData(nextCommands),
      },
      pretty: dryRun
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
    target: string,
  ): Promise<string> {
    const classified = classifyTarget(target);
    if (classified.kind === "release") {
      return classified.id;
    }
    if (classified.kind === "deployment") {
      const deployment = (await client.getDeploymentById(classified.id, {
        project_id: projectId,
      })) as { release_id: string };
      return deployment.release_id;
    }
    if (classified.kind === "latest") {
      const live = await client.listDeployments.all({ project_id: projectId, live: true });
      const deployment = live.find(servesPrimary);
      if (deployment === undefined) {
        throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to a primary origin yet.", {
          hint: `Deploy first with \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`, then pull.`,
        });
      }
      return deployment.release_id;
    }
    throw new ZitadelError("E_VALIDATION", `Don't know how to pull "${target}".`, {
      hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
    });
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
