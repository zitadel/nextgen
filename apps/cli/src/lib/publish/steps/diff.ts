import type { DiffedFile } from "@/lib/git";
import { diffConfigAgainst, diffConfigFilesAgainst } from "@/lib/publish/git";
import type { Learned, Step, StepContext, StepResult } from "@/lib/publish/pipeline";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel";

/**
 * The directories whose changes can lock existing users out, which decide
 * whether the lockout step reads them.
 *
 * @remarks
 * Branding, policies and connections cannot lock anyone out.
 */
const LOCKOUT_DIRECTORIES = [CONFIG_DIRECTORIES.schemas, CONFIG_DIRECTORIES.flows] as const;

/**
 * How many characters of a commit sha a message shows.
 */
const SHORT_SHA = 12;

/**
 * The diff as `--json` reports it, in `data.diff`: what the terminal shows,
 * split by file.
 */
export type ConfigDiff = {
  /**
   * The commit of the release the primary origins serve: what the diff is against.
   */
  readonly against: string | null;

  /**
   * One entry per changed file: empty when nothing changed, null when no diff
   * can be shown, with `note` saying why.
   */
  readonly files: readonly DiffedFile[] | null;

  /**
   * The line the terminal prints instead of the diff, or above it.
   */
  readonly note?: string;
};

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
 * Whether the schemas or flows changed is handed to the steps after it as
 * `learned`.
 */
export const diffStep: Step = {
  name: "diff",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<StepResult | undefined> {
    // What the primary origins serve: a live preview deployment is never the
    // baseline, even when it is the newest one in the project.
    const deployments = await ctx.deployments.primary({ expand: ["release"] });
    const live = deployments[0]?.release?.metadata;
    const sha = live?.git_sha;
    if (!sha) {
      return noDiff(
        ctx,
        null,
        "No diff available: nothing is deployed yet, or the live release has no commit.",
      );
    }
    const short = sha.slice(0, SHORT_SHA);
    // A release built from an uncommitted tree records the commit it was built
    // from, not the content it pinned, so a diff against it can come back empty
    // while this deploy would still change what is live.
    if (live?.git_dirty) {
      return noDiff(
        ctx,
        sha,
        `No reliable diff available: the live release was built from an uncommitted tree at ${short}.`,
      );
    }

    // The deploy lands on every primary origin, and they need not serve the
    // same release: the diff is against the newest one, so it is said aloud
    // that another origin moves from something else.
    const releases = new Set(
      deployments.map((entry) => {
        return entry.release_id;
      }),
    );
    const note = noteOnReleases(releases.size, short);
    const unknown = `No diff available: ${short} is not in this repository's history.`;

    const touched = await diffConfigFilesAgainst(ctx.cwd, sha, []);
    // Origins serving different releases each move from their own baseline, so
    // a diff against the newest says nothing about the others.
    const learned = learnedFrom(touched, releases.size);

    const referenced = ctx.config.branding.all.flatMap((branding) => {
      return branding.listReferencedPaths(ctx.store);
    });
    if (ctx.json) {
      const files = await diffConfigFilesAgainst(ctx.cwd, sha, referenced);
      if (files === null) {
        return { ...noDiff(ctx, sha, unknown), learned };
      }
      const diff: ConfigDiff = { against: sha, files, note };
      return { data: { diff }, learned };
    }

    const notices = note === undefined ? [] : [`${note}\n`];
    const diff = await diffConfigAgainst(ctx.cwd, sha, ctx.color, referenced);
    if (diff === null) {
      return { notices: [...notices, `${unknown}\n`], learned };
    }
    return { notices: [...notices, shownDiff(diff, short)], learned };
  },
};

/**
 * The line that says the primary origins serve more than one release.
 *
 * @param releases - How many releases the primary origins serve.
 * @param short - The short sha the diff is against.
 * @returns The line, or `undefined` when they serve one.
 */
function noteOnReleases(releases: number, short: string): string | undefined {
  if (releases <= 1) {
    return undefined;
  }
  return `The primary origins serve ${releases} different releases; the diff is against the newest, ${short}.`;
}

/**
 * What the lockout step may build on: whether a schema or a flow changed.
 *
 * @param touched - The files that changed, or null when no diff could be made.
 * @param releases - How many releases the primary origins serve.
 * @returns Whether a schema or flow changed, or nothing when the diff cannot
 *   say: there was none, or the origins serve different releases.
 */
function learnedFrom(touched: readonly DiffedFile[] | null, releases: number): Learned {
  if (touched === null || releases !== 1) {
    return {};
  }
  const changed = touched.some((file) => {
    const paths = [file.path, file.previous_path ?? ""];
    return paths.some((path) => {
      return LOCKOUT_DIRECTORIES.some((directory) => {
        return path.startsWith(`${directory}/`);
      });
    });
  });
  return { schemasOrFlowsChanged: changed };
}

/**
 * The diff as the terminal shows it, ending in a newline.
 *
 * @param diff - The coloured diff.
 * @param short - The short sha it is against.
 * @returns The diff, or a line saying nothing changed.
 */
function shownDiff(diff: string, short: string): string {
  if (diff.trim() === "") {
    return `No changes to .zitadel/ since ${short}.\n`;
  }
  if (diff.endsWith("\n")) {
    return diff;
  }
  return `${diff}\n`;
}

/**
 * No diff to show: the line saying why, printed, or reported under `--json`.
 *
 * @param ctx - The step's context.
 * @param against - The commit there is no diff against, if known.
 * @param note - Why there is no diff.
 * @returns The step's result.
 */
function noDiff(ctx: StepContext, against: string | null, note: string): StepResult {
  if (!ctx.json) {
    return { notices: [`${note}\n`] };
  }
  const diff: ConfigDiff = { against, files: null, note };
  return { data: { diff } };
}
