import { Args } from "@oclif/core";
import { z } from "zod";

import type { ReleasePointer, ReleasePointerKind } from "@/lib/backend";
import { GetDeploymentByIdParams, GetReleaseByIdParams } from "@/lib/backend/schemas";
import { ZitadelError } from "@/lib/errors";
import { mapBounded } from "@/lib/map-bounded";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { type Refused, taken } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { PublishedConfiguration } from "@/lib/publish";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import {
  type Change,
  DiskStore,
  type Flows,
  isJsonObject,
  isJsonValue,
  type Schemas,
  ZitadelConfig,
} from "@/lib/zitadel";

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
  return GetReleaseByIdParams.shape.release_id.safeParse(target).success;
}

/**
 * Whether a target names a deployment.
 *
 * @param target - The target as given.
 * @returns Whether it is a deployment id.
 */
function isDeploymentId(target: string): target is DeploymentId {
  return GetDeploymentByIdParams.shape.deployment_id.safeParse(target).success;
}

/**
 * What to pull: `latest` (the live release), a release id (`rel_…`) or a
 * deployment id (`dep_…`), refusing anything else.
 */
const TARGET = {
  schema: z.string().transform((target, ctx): PullTarget => {
    if (target === "latest") {
      return LATEST_TARGET;
    }
    if (isReleaseId(target)) {
      return {
        kind: "release",
        id: target,
      };
    }
    if (isDeploymentId(target)) {
      return {
        kind: "deployment",
        id: target,
      };
    }
    ctx.addIssue({
      code: "custom",
      message: "not a pull target",
    });
    return z.NEVER;
  }),
  refusal: {
    message: 'Don\'t know how to pull "{value}".',
    hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
  },
} as const satisfies Refused<PullTarget>;

/**
 * What a release that pins two resources into one file is refused for.
 */
const SHARED_FILE_REFUSAL = {
  code: "E_CONFLICT",
  message: 'The release pins "{first}" and "{second}", which both go in {path}.',
  hint: "Rename one of them in the source configuration and deploy again, or reconcile the file by hand.",
  details: {
    path: "{path}",
    handles: "{handles}",
  },
} as const satisfies Refusal;

/**
 * The release-pointer kinds `pull` can rebuild on disk.
 */
type PullableKind = Extract<ReleasePointerKind, "schema" | "flow_definition">;

/**
 * The collection of each release-pointer kind `pull` can rebuild on disk from
 * the revision a release pins, which places the revision by its handle.
 *
 * @remarks
 * Only `schema` and `flow_definition` qualify: their
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
 * How many revisions are fetched at once.
 */
const FETCH_CONCURRENCY = 8;

/**
 * One pinned resource's attempt: what became of it, or what stopped it.
 */
type Attempt =
  | { readonly kind: "done"; readonly outcome: PullOutcome }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * What became of one pinned resource: the file it goes in and the change that
 * writes it, or why nothing is written.
 */
type PullOutcome =
  | { readonly kind: "pulled"; readonly resource: PulledResource; readonly change: Change }
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
   * @param input.args - The target.
   * @returns The release, what was written, and what was skipped.
   * @throws {@link ZitadelError} With `E_NOT_FOUND` when `latest` is asked for
   *   and nothing is deployed.
   */
  protected async execute({ args }: Admitted<typeof Pull>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const store = new DiskStore(this.cwd);
    const config = await ZitadelConfig.loadKinds(store, ["schemas", "flows"]);

    const configuration = new PublishedConfiguration(client, projectId);
    const releaseId = await this.resolveReleaseId(configuration, args.target);
    const release = await configuration.fetchRelease(releaseId);

    // Fetched together, but kept in the order the release pins them, so the
    // files land in that order and the first failure in it is the one raised.
    const attempts = await mapBounded(
      release.pointers,
      FETCH_CONCURRENCY,
      async (pointer): Promise<Attempt> => {
        try {
          return {
            kind: "done",
            outcome: await this.fetchOne(configuration, config, pointer),
          };
        } catch (error) {
          return {
            kind: "failed",
            error,
          };
        }
      },
    );
    const outcomes: PullOutcome[] = [];
    for (const attempt of attempts) {
      if (attempt.kind === "failed") {
        throw attempt.error;
      }
      outcomes.push(attempt.outcome);
    }
    this.refuseSharedFiles(outcomes);
    if (!this.dryRun) {
      for (const outcome of outcomes) {
        if (outcome.kind === "pulled") {
          // The server's canonical form, written whole over the file that holds
          // the handle, so what lands is exactly what the release pinned.
          await outcome.change.save(store, { overwrite: true });
        }
      }
    }
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

    const files = `${pulled.length} ${new Intl.PluralRules("en").select(pulled.length) === "one" ? "file" : "files"}`;

    const title = escapeControlCharacters(
      this.dryRun
        ? `Would write ${files} from ${release.id} (dry run)`
        : `Pulled ${files} from ${release.id}`,
    );

    return this.emit({
      status: "ok",
      data: {
        title,
        release_id: release.id,
        pulled,
        skipped,
        ...(this.dryRun ? { dry_run: true } : {}),
      },
      summary: {
        title,
        sections: [],
        lines: fileList(
          pulled.map((entry) => {
            return entry.path;
          }),
          this.dryRun,
        ),
      },
      next: {
        commands: this.dryRun
          ? [await this.again("pull", { without: ["dryRun"] })]
          : args.target.kind !== "latest"
            ? []
            : [this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } })],
      },
    });
  }

  /**
   * Refuse a pull in which two pinned resources would be written to one file.
   *
   * @remarks
   * Each change is computed against the configuration as it was loaded, so the
   * second write over a shared file would silently replace the first. This
   * runs before anything is written, so the working copy stays untouched.
   *
   * @param outcomes - What became of each pinned resource, in pin order.
   * @throws {@link ZitadelError} With `E_CONFLICT` naming both handles and the
   *   file when two outcomes target the same path.
   */
  private refuseSharedFiles(outcomes: readonly PullOutcome[]): void {
    const owners = new Map<string, PulledResource>();
    for (const outcome of outcomes) {
      if (outcome.kind !== "pulled") {
        continue;
      }
      const owner = owners.get(outcome.resource.path);
      if (owner !== undefined) {
        throw refusalError(SHARED_FILE_REFUSAL, {
          first: owner.handle,
          second: outcome.resource.handle,
          path: outcome.resource.path,
          handles: [owner.handle, outcome.resource.handle],
        });
      }
      owners.set(outcome.resource.path, outcome.resource);
    }
  }

  /**
   * Fetch one pinned revision and work out the change that writes it, without
   * writing anything.
   *
   * @remarks
   * The file is located here, before anything is written: a handle that has no
   * single file refuses the pull while the working copy is untouched.
   *
   * @param configuration - The project's published configuration.
   * @param config - The configuration on disk, as far as `pull` reads it.
   * @param pointer - The resource the release pins.
   * @returns What became of the resource.
   * @throws When the revision cannot be fetched, or its handle has no single file.
   */
  private async fetchOne(
    configuration: PublishedConfiguration,
    config: ZitadelConfig,
    pointer: ReleasePointer,
  ): Promise<PullOutcome> {
    const resource: PinnedResource = {
      kind: pointer.kind,
      handle: pointer.handle,
    };
    if (!isPullable(pointer.kind)) {
      return {
        kind: "skipped",
        resource,
      };
    }
    const body = await configuration.fetchRevision(pointer.kind, pointer.revision_id);
    if (!isJsonValue(body) || !isJsonObject(body)) {
      return {
        kind: "skipped",
        resource,
      };
    }
    const collection = PULLABLE[pointer.kind](config);
    const change = collection.placeRevision(pointer.handle, body);
    return {
      kind: "pulled",
      resource: { ...resource, path: collection.locate(pointer.handle) },
      change,
    };
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
          throw new ZitadelError("E_NOT_FOUND", "Nothing is deployed to a primary origin yet", {
            hint: `Deploy first with ${this.suggest({ id: "deploy", flags: { message: WHAT_CHANGED } })}, then pull.`,
          });
        }
        return releaseId;
      }
    }
  }
}

/**
 * The paths under the line that says what they are, for the lines under the
 * closing sentence. Listed bare in the summary box they are file names with
 * nothing naming them, so a reader has to guess whether they were written,
 * skipped or found. Empty for a pull that wrote nothing, which has no list.
 */
export function fileList(paths: readonly string[], dryRun: boolean): string[] {
  return paths.length === 0
    ? []
    : [
        dryRun ? "Files it would write:" : "Files written:",
        ...paths.map((p) => {
          return escapeControlCharacters(`  ${p}`);
        }),
      ];
}

/**
 * Warn that a release pins a resource `pull` cannot rebuild on disk yet. A
 * reported warning rides the envelope (BaseCommand merges them), so a `--json`
 * caller sees it too.
 */
function reportSkipped(resource: PinnedResource): void {
  reportWarning(
    `The release pins ${resource.kind} "${resource.handle}", which pull cannot rebuild locally yet; reconcile it by hand.`,
  );
}
