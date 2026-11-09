import { Args } from "@oclif/core";
import { z } from "zod";

import type { ReleasePointerKind } from "@/lib/backend";
import { PublishedConfiguration } from "@/lib/publish";
import { ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import { DiskStore, type Flows, type Schemas, ZitadelConfig } from "@/lib/zitadel";
import { type Refused, taken } from "@/lib/oclif/flags";
import { reportWarning } from "@/lib/warnings";
import { prose } from "@/lib/oclif/rendering";

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
const PULLABLE: Readonly<
  Partial<Record<ReleasePointerKind, (config: ZitadelConfig) => Schemas | Flows>>
> = {
  schema: (config) => {
    return config.schemas;
  },
  flow_definition: (config) => {
    return config.flows;
  },
};

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
      defaultHelp: async () => {
        return "latest";
      },
      description:
        "What to pull: 'latest' (the live release), a release id (rel_…), or a deployment id (dep_…).",
    }),
  };

  protected async execute({ args }: Admitted<typeof Pull>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const store = new DiskStore(this.cwd);
    const config = await ZitadelConfig.loadUnchecked(store);

    const configuration = new PublishedConfiguration(client, projectId);
    const releaseId = await this.resolveReleaseId(configuration, args.target);
    const release = await configuration.release(releaseId);

    const pulled: { kind: string; handle: string; path: string }[] = [];
    const skipped: { kind: string; handle: string }[] = [];
    for (const pointer of release.pointers) {
      const collection = PULLABLE[pointer.kind]?.(config);
      const body = await configuration.revision(pointer.kind, pointer.revision_id);
      if (collection === undefined || body === undefined || !isObject(body)) {
        skipped.push({ kind: pointer.kind, handle: pointer.handle });
        continue;
      }
      if (!this.dryRun) {
        // The server's canonical form, written whole over the file that holds
        // the handle, so what lands is exactly what the release pinned.
        await collection.revision(pointer.handle, body).save(store, { overwrite: true });
      }
      pulled.push({
        kind: pointer.kind,
        handle: pointer.handle,
        path: collection.pathFor(pointer.handle),
      });
    }

    for (const resource of skipped) {
      reportSkipped(resource);
    }

    const summary = pulled
      .map((entry) => {
        return entry.path;
      })
      .join("\n");

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        pulled,
        skipped,
        ...(this.dryRun ? { dry_run: true } : {}),
      },
      next: { commands: this.dryRun ? [] : [this.suggest(DEPLOY_ARGS)] },
      pretty: prose(
        this.dryRun
          ? `Would write ${pulled.length} file${pulled.length === 1 ? "" : "s"} from ${release.id} (dry run).\n${summary}`
          : `Pulled ${pulled.length} file${pulled.length === 1 ? "" : "s"} from ${release.id}.\n${summary}`,
      ),
    });
  }

  /**
   * The release a target names: `rel_…` as given, the release a `dep_…`
   * deployment made live, or — for `latest` — the release the newest primary
   * deployment serves. A preview deployment never serves a primary origin, so
   * `latest` is the project's live configuration, not a pull-request preview.
   */
  private async resolveReleaseId(
    configuration: PublishedConfiguration,
    target: ReadablePullTarget,
  ): Promise<string> {
    switch (target.kind) {
      case "release": {
        return target.id;
      }
      case "deployment": {
        return configuration.releaseIdOfDeployment(target.id);
      }
      case "latest": {
        const releaseId = await configuration.liveReleaseId();
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
 * Warn that a release pins a resource `pull` cannot rebuild on disk yet. A
 * reported warning rides the envelope (BaseCommand merges them), so a `--json`
 * caller sees it too.
 */
function reportSkipped(resource: { kind: string; handle: string }): void {
  reportWarning(
    `The release pins ${resource.kind} "${resource.handle}", which pull cannot rebuild locally yet; reconcile it by hand.`,
  );
}
