import { shellCommand, type Suggestion, type SuggestedCommand } from "@/lib/suggestion";
import { errorMessage } from "@/lib/errors";

export type DockerRuntimeGuidance = {
  hint: string;
  nextActions: string[];
  /** The command that checks Docker answers; the retry follows it. */
  check: SuggestedCommand;
  /** The command to rerun once Docker answers, for the caller to render. */
  retry: Suggestion;
};

export function dockerUnavailableMessage(error: unknown): string {
  const detail = errorMessage(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Docker is not reachable${suffix}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
}

/**
 * What to do when Docker does not answer: start it, check it, and rerun.
 *
 * @param retryCommand - The command to rerun once it answers.
 * @param rerun - That command as the run renders it, for the prose that names
 *   it; a failure raised with no run at hand names it in its commands alone.
 * @returns The guidance.
 */
export function dockerRuntimeGuidance(
  retryCommand: "doctor" | "start",
  rerun?: SuggestedCommand,
): DockerRuntimeGuidance {
  return {
    hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
    nextActions: [
      "Start Docker Desktop, Docker Engine, or a Docker-compatible runtime such as Colima.",
      rerun === undefined
        ? "Run `docker version`, then rerun the command below."
        : `Run \`docker version\`, then rerun ${rerun}.`,
      "If you are not using the managed local runtime, run setup with `--server <url>` instead.",
    ],
    check: shellCommand("docker version"),
    retry: retryCommand === "doctor" ? { id: "doctor" } : { id: "start" },
  };
}
