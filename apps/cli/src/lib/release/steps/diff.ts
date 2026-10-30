import consola from "consola";

import { brandingReferencePaths } from "../../branding";
import { type ConfigDiffFile, diffConfigAgainst, diffConfigFilesAgainst } from "../git";
import type { Step, StepContext, StepReport } from "../pipeline";
import { listLiveDeployments, servesPrimary } from "../deployment";

/**
 * The diff as `--json` reports it, in `data.diff`: what the terminal shows,
 * split by file.
 */
export interface ConfigDiff {
  /** The commit of the release the primary origins serve: what the diff is against. */
  readonly against: string | null;
  /**
   * One entry per changed file: empty when nothing changed, null when no diff
   * can be shown, with `note` saying why.
   */
  readonly files: readonly ConfigDiffFile[] | null;
  /** The line the terminal prints instead of the diff, or above it. */
  readonly note?: string;
}

/**
 * Show what `.zitadel/` changed since the release the target serves now.
 *
 * It reads the live release's `git_sha` from its metadata and runs
 * `git diff <sha> -- .zitadel/` against the working tree. There is no diff
 * library and no server fallback: when git is missing, this is not a repo, the
 * commit is not in local history, or the live release carries no `git_sha`, it
 * prints one line saying no diff is available and carries on. Colour is
 * suppressed under `--no-color` and a non-terminal. Under `--json` nothing is
 * printed, so the envelope travels alone on stdout: the diff, split by file, or
 * the line saying why there is none, is reported as `diff` instead.
 *
 * It says all of that through `consola`, never `process.stdout` directly: a
 * step is handed a {@link StepContext}, which carries no UI, and while a
 * command's chain is open the narration bridge draws `consola` lines inside it.
 * Written straight to the stream, this step's output landed above the chain's
 * opening `┌`.
 */
export const diffStep: Step = {
  name: "diff",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<StepReport | undefined> {
    const deployments = await listLiveDeployments(ctx.client, ctx.projectId, {
      withRelease: true,
    });
    // What the primary origins serve: a live preview deployment is never the
    // baseline, even when it is the newest one in the project.
    const live = deployments.find(servesPrimary)?.release?.metadata;
    const sha = live?.git_sha;
    if (!sha) {
      return noDiff(
        ctx,
        null,
        "No diff available: nothing is deployed yet, or the live release has no commit.",
      );
    }
    // A release built from an uncommitted tree records the commit it was built
    // from, not the content it pinned, so a diff against it can come back empty
    // while this deploy would still change what is live.
    if (live?.git_dirty) {
      return noDiff(
        ctx,
        sha,
        `No reliable diff available: the live release was built from an uncommitted tree at ${sha.slice(0, 12)}.`,
      );
    }

    // The deploy lands on every primary origin, and they need not serve the
    // same release: the diff is against the newest one, so it is said aloud
    // that another origin moves from something else.
    const releases = new Set(deployments.filter(servesPrimary).map((entry) => entry.release_id));
    const note =
      releases.size > 1
        ? `The primary origins serve ${releases.size} different releases; the diff is against the newest, ${sha.slice(0, 12)}.`
        : undefined;
    const unknown = `No diff available: ${sha.slice(0, 12)} is not in this repository's history.`;

    const referenced = ctx.brandingSources.flatMap((descriptor) =>
      brandingReferencePaths(ctx.cwd, descriptor),
    );
    if (ctx.json) {
      const files = await diffConfigFilesAgainst(ctx.cwd, sha, referenced);
      if (files === null) {
        return noDiff(ctx, sha, unknown);
      }
      const diff: ConfigDiff = { against: sha, files, ...(note === undefined ? {} : { note }) };
      return { diff };
    }

    if (note !== undefined) {
      consola.info(note);
    }
    const diff = await diffConfigAgainst(ctx.cwd, sha, ctx.color, referenced);
    if (diff === null) {
      return noDiff(ctx, sha, unknown);
    }
    const shown = diff.trim() === "" ? `No changes to .zitadel/ since ${sha.slice(0, 12)}.` : diff;
    // The diff itself carries no mark: it is the thing being shown, not a
    // remark about it.
    consola.log(shown.replace(/\n+$/, ""));
    return undefined;
  },
};

/** No diff to show: the line saying why, printed, or reported under `--json`. */
function noDiff(ctx: StepContext, against: string | null, note: string): StepReport | undefined {
  if (!ctx.json) {
    consola.info(note);
    return undefined;
  }
  const diff: ConfigDiff = { against, files: null, note };
  return { diff };
}
