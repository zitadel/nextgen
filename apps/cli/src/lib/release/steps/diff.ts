import { diffConfigAgainst } from "../git";
import type { Step, StepContext } from "../pipeline";
import { listLiveDeployments, servesPrimary } from "../deployment";

/**
 * Show what `.zitadel/` changed since the release the target serves now.
 *
 * It reads the live release's `git_sha` from its metadata and runs
 * `git diff <sha> -- .zitadel/` against the working tree. There is no diff
 * library and no server fallback: when git is missing, this is not a repo, the
 * commit is not in local history, or the live release carries no `git_sha`, it
 * prints one line saying no diff is available and carries on. Colour is
 * suppressed under `--json`, `--no-color` and a non-terminal, and the whole
 * line is withheld under `--json` so the envelope travels alone on stdout.
 */
export const diffStep: Step = {
  name: "diff",
  runsFor: ["deploy", "preview"],
  async run(ctx: StepContext): Promise<void> {
    const note = (line: string): void => {
      if (!ctx.json) {
        process.stdout.write(`${line}\n`);
      }
    };

    const deployments = await listLiveDeployments(ctx.client, ctx.projectId, {
      withRelease: true,
      ...(ctx.origin === undefined ? {} : { origin: ctx.origin }),
    });
    // What the primary origins serve: a live preview deployment is never the
    // baseline, even when it is the newest one in the project.
    const sha = deployments.find(servesPrimary)?.release?.metadata?.git_sha;
    if (!sha) {
      note("No diff available: nothing is deployed yet, or the live release has no commit.");
      return;
    }

    const diff = await diffConfigAgainst(ctx.cwd, sha, ctx.color);
    if (diff === null) {
      note(`No diff available: ${sha.slice(0, 12)} is not in this repository's history.`);
      return;
    }
    if (diff.trim() === "") {
      note(`No changes to .zitadel/ since ${sha.slice(0, 12)}.`);
      return;
    }
    if (!ctx.json) {
      process.stdout.write(diff.endsWith("\n") ? diff : `${diff}\n`);
    }
  },
};
