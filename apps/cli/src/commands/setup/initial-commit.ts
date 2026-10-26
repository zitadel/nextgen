import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with zitadel setup";

/**
 * Identity used only when the machine has none configured. A commit cannot be
 * made without one, and refusing to commit would leave the first release
 * without a `git_sha` — the whole reason the commit exists.
 */
const FALLBACK_IDENTITY = { name: "Zitadel Setup", email: "setup@zitadel.local" };

/** Paths that must never be committed, whatever `.gitignore` happens to say. */
function isSecretPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (path === ".zitadel/secret" || path.endsWith("/.zitadel/secret")) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

/** What {@link ensureInitialCommit} did, for setup to report. */
export type InitialCommitOutcome =
  /** A repository was created and the project committed into it. */
  | { readonly kind: "created"; readonly sha: string }
  /** The project is already inside a repository; its git is the developer's. */
  | { readonly kind: "existing-repository" }
  /** `--no-git`. */
  | { readonly kind: "skipped" }
  /** git is missing, or init/add/commit failed. */
  | { readonly kind: "unavailable"; readonly reason: string };

/** Run git in `cwd`; throws with git's own stderr when it fails. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** Whether `cwd` already sits inside a git repository. */
async function insideRepository(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Whether git has an author identity it can commit with. */
async function hasIdentity(cwd: string): Promise<boolean> {
  try {
    const email = (await git(cwd, ["config", "--get", "user.email"])).trim();
    const name = (await git(cwd, ["config", "--get", "user.name"])).trim();
    return email !== "" && name !== "";
  } catch {
    return false;
  }
}

/**
 * Give the scaffolded project a git repository with one commit, so the release
 * setup builds next records a real `git_sha` and the deploy after it can diff
 * against this commit instead of reporting that no diff is available.
 *
 * Only when there is no repository at all. A project already under version
 * control is the developer's, and committing their uncommitted work into it —
 * work setup did not write and cannot judge — is not setup's to do. That is
 * also why the scaffolders pass `--no-git`: a nested repository inside an
 * existing one is worse than no repository.
 *
 * Nothing here prompts, so it behaves the same interactively and in CI, and no
 * failure is fatal: the worst case is the first release carrying no commit,
 * which is what happened before this existed.
 */
export async function ensureInitialCommit(cwd: string): Promise<InitialCommitOutcome> {
  if (await insideRepository(cwd)) {
    return { kind: "existing-repository" };
  }
  try {
    await git(cwd, ["init", "--quiet"]);
    await git(cwd, ["add", "--all", "--", "."]);
    // `.gitignore` is the first line of defence and the scaffold writes one,
    // but a secret committed once cannot be scrubbed later, so the staged set
    // is checked rather than trusted.
    const staged = (await git(cwd, ["diff", "--cached", "--name-only"]))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const secrets = staged.filter(isSecretPath);
    if (secrets.length > 0) {
      await git(cwd, ["reset", "--quiet", "--", ...secrets]);
    }
    if (staged.length === secrets.length) {
      return { kind: "unavailable", reason: "there was nothing to commit" };
    }
    const identity = (await hasIdentity(cwd))
      ? []
      : [
          `-c`,
          `user.name=${FALLBACK_IDENTITY.name}`,
          `-c`,
          `user.email=${FALLBACK_IDENTITY.email}`,
        ];
    // Signing is disabled for this commit alone: a configured GPG key would
    // otherwise block setup on a passphrase prompt it never asked for.
    await git(cwd, [
      ...identity,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "--message",
      INITIAL_COMMIT_SUBJECT,
    ]);
    return { kind: "created", sha: (await git(cwd, ["rev-parse", "HEAD"])).trim() };
  } catch (error) {
    return { kind: "unavailable", reason: messageOf(error) };
  }
}

/** git's own stderr where it has one, so the warning names the real cause. */
function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") {
    return stderr.trim().split("\n")[0] ?? stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
