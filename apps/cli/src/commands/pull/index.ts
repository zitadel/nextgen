import { Args } from "@oclif/core";
import { z } from "zod";

import type { ReleasePointerKind } from "@/lib/backend";
import { PublishedConfiguration } from "@/lib/publish";
import { ZitadelError } from "@/lib/errors";
import { mapBounded } from "@/lib/map-bounded";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import {
  DiskStore,
  type Flows,
  isJsonObject,
  isJsonValue,
  type Schemas,
  ZitadelConfig,
} from "@/lib/zitadel";
import { type Refused, taken } from "@/lib/oclif/flags";
import { reportWarning } from "@/lib/warnings";
import { prose } from "@/lib/oclif/rendering";

/**
 * A release id, as the platform mints it.
 */
type ReleaseId = `rel_${string}`;

/**
 * A deployment id, as the platform mints it.
 */
type DeploymentId = `dep_${string}`;

/**
 * What a pull target names: the live release, a release, or a deployment.
 */
type PullTarget =
  | { readonly kind: "latest" }
  | { readonly kind: "release"; readonly id: ReleaseId }
  | { readonly kind: "deployment"; readonly id: DeploymentId };

/**
 * The live release, what is pulled when no target is given.
 */
const LATEST_TARGET: PullTarget = {
  kind: "latest",
};

/**
 * Whether a target names a release.
 *
 * @param target - The target as given.
 * @returns Whether it is a release id.
 */
function isReleaseId(target: string): target is ReleaseId {
  return target.startsWith("rel_");
}

/**
 * Whether a target names a deployment.
 *
 * @param target - The target as given.
 * @returns Whether it is a deployment id.
 */
function isDeploymentId(target: string): target is DeploymentId {
  return target.startsWith("dep_");
}

/**
 * What to pull: `latest` (the live release), a release id (`rel_…`) or a
 * deployment id (`dep_…`), refusing anything else.
 */
const TARGET: Refused<PullTarget> = {
  schema: z.string().transform((target, ctx): PullTarget => {
    if (target === "latest") {
      return LATEST_TARGET;
    }
    if (isReleaseId(target)) {
      return { kind: "release", id: target };
    }
    if (isDeploymentId(target)) {
      return { kind: "deployment", id: target };
    }
    ctx.addIssue({ code: "custom", message: "not a pull target" });
    return z.NEVER;
  }),
  refusal: {
    message: 'Don\'t know how to pull "{value}".',
    hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
  },
};

/**
 * The release-pointer kinds `pull` can rebuild on disk.
 */
type PullableKind = Extract<ReleasePointerKind, "schema" | "flow_definition">;

/**
 * The collection of each release-pointer kind `pull` can rebuild on disk from
 * the revision a release pins, which places the revision by its handle.
 *
 * @remarks
 * Only `schema` and `flow_definition` qualify (issue #541): their
 * `revision_id` is the id their read endpoint takes. A release also pins
 * `branding` and `idp`, but those pin a revision id the per-kind read
 * endpoints do not accept yet, so a release that carries them is pulled for
 * the kinds it can and warns for the rest; they gain a pull path when their
 * reads are revision-addressable. A pinned `policy` is skipped the same way
 * until pull learns to write one.
 */
const PULLABLE = {
  schema: (config) => {
    return config.schemas;
  },
  flow_definition: (config) => {
    return config.flows;
  },
} as const satisfies Record<PullableKind, (config: ZitadelConfig) => Schemas | Flows>;

/**
 * Whether `pull` can rebuild a kind on disk.
 *
 * @param kind - The kind a release pins.
 * @returns Whether it is one of {@link PULLABLE}'s.
 */
function isPullable(kind: ReleasePointerKind): kind is PullableKind {
  return Object.hasOwn(PULLABLE, kind);
}

/**
 * A resource a release pins, as `--json` lists it.
 */
type PinnedResource = {
  readonly kind: ReleasePointerKind;
  readonly handle: string;
};

/**
 * A resource written to disk, and where.
 */
type PulledResource = PinnedResource & {
  readonly path: string;
};

/**
 * What became of one pinned resource.
 */
type PullOutcome =
  | { readonly kind: "pulled"; readonly resource: PulledResource }
  | { readonly kind: "skipped"; readonly resource: PinnedResource };

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
    target: Args.custom<PullTarget>({
      parse: taken(TARGET),
    })({
      default: LATEST_TARGET,
      defaultHelp: async () => {
        return "latest";
      },
      description:
        "What to pull: 'latest' (the live release), a release id (rel_…), or a deployment id (dep_…).",
    }),
  };

  /**
   * Write each revision the target's release pins into `.zitadel/`.
   *
   * @param input - The target.
   * @returns The release, what was written, and what was skipped.
   * @throws {@link ZitadelError} With `E_NOT_FOUND` when `latest` is asked for
   *   and nothing is deployed.
   */
  protected async execute(input: Admitted<typeof Pull>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const store = new DiskStore(this.cwd);
    const config = await ZitadelConfig.loadKinds(store, ["schemas", "flows"]);

    const configuration = new PublishedConfiguration(client, projectId);
    const releaseId = await this.resolveReleaseId(configuration, input.args.target);
    const release = await configuration.fetchRelease(releaseId);

    // One resource at a time, so the files land in the order the release pins them.
    const outcomes = await mapBounded(
      release.pointers,
      1,
      async (pointer): Promise<PullOutcome> => {
        const resource: PinnedResource = { kind: pointer.kind, handle: pointer.handle };
        if (!isPullable(pointer.kind)) {
          return { kind: "skipped", resource };
        }
        const body = await configuration.fetchRevision(pointer.kind, pointer.revision_id);
        if (!isJsonValue(body) || !isJsonObject(body)) {
          return { kind: "skipped", resource };
        }
        const collection = PULLABLE[pointer.kind](config);
        if (!this.dryRun) {
          // The server's canonical form, written whole over the file that holds
          // the handle, so what lands is exactly what the release pinned.
          await collection.placeRevision(pointer.handle, body).save(store, { overwrite: true });
        }
        return {
          kind: "pulled",
          resource: { ...resource, path: collection.locate(pointer.handle) },
        };
      },
    );
    const pulled = outcomes.flatMap((outcome) => {
      if (outcome.kind !== "pulled") {
        return [];
      }
      return [outcome.resource];
    });
    const skipped = outcomes.flatMap((outcome) => {
      if (outcome.kind !== "skipped") {
        return [];
      }
      return [outcome.resource];
    });

    for (const resource of skipped) {
      reportSkipped(resource);
    }

    const summary = pulled
      .map((entry) => {
        return entry.path;
      })
      .join("\n");
    const files = pulled.length === 1 ? "file" : "files";
    const headline = this.dryRun
      ? `Would write ${pulled.length} ${files} from ${release.id} (dry run).`
      : `Pulled ${pulled.length} ${files} from ${release.id}.`;
    const next = this.dryRun ? [] : [this.suggest(DEPLOY_ARGS)];

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        pulled,
        skipped,
        dry_run: this.dryRun ? true : undefined,
      },
      next: { commands: next },
      pretty: prose(`${headline}\n${summary}`),
    });
  }

  /**
   * The release a target names: `rel_…` as given, the release a `dep_…`
   * deployment made live, or — for `latest` — the release the newest primary
   * deployment serves.
   *
   * @remarks
   * A preview deployment never serves a primary origin, so `latest` is the
   * project's live configuration, not a pull-request preview.
   *
   * @param configuration - The project's published configuration.
   * @param target - What to pull.
   * @returns The release's id.
   * @throws {@link ZitadelError} With `E_NOT_FOUND` when `latest` is asked for
   *   and nothing is deployed to a primary origin.
   */
  private async resolveReleaseId(
    configuration: PublishedConfiguration,
    target: PullTarget,
  ): Promise<string> {
    switch (target.kind) {
      case "release": {
        return target.id;
      }
      case "deployment": {
        return configuration.fetchReleaseIdOfDeployment(target.id);
      }
      case "latest": {
        const releaseId = await configuration.fetchLiveReleaseId();
        if (releaseId === undefined) {
          throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to a primary origin yet.", {
            hint: `Deploy first with \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`, then pull.`,
          });
        }
        return releaseId;
      }
    }
  }
}

/**
 * Warn that a release pins a resource `pull` cannot rebuild on disk yet.
 *
 * @remarks
 * A reported warning rides the envelope (BaseCommand merges them), so a
 * `--json` caller sees it too.
 *
 * @param resource - The resource.
 */
function reportSkipped(resource: PinnedResource): void {
  reportWarning(
    `The release pins ${resource.kind} "${resource.handle}", which pull cannot rebuild locally yet; reconcile it by hand.`,
  );
}
