import { shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import { errorMessage } from "@/lib/errors";

export type DockerRuntimeGuidance = {
  hint: string;
  nextActions: string[];
  /** The command that checks Docker answers; the retry follows it. */
  check: SuggestedCommand;
  /** The run to repeat once Docker answers, as it was typed. */
  retry: SuggestedCommand;
};

export function dockerUnavailableMessage(error: unknown): string {
  const detail = errorMessage(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Docker is not reachable${suffix}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
}

/**
 * What to do when Docker does not answer: start it, check it, and rerun.
 *
 * @param retry - The run to repeat once it answers, as it was typed
 *   (`this.again`), so its `--runtime`, `--image` and `--port` are kept.
 * @returns The guidance.
 */
export function dockerRuntimeGuidance(retry: SuggestedCommand): DockerRuntimeGuidance {
  return {
    hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
    nextActions: [
      "Start Docker Desktop, Docker Engine, or a Docker-compatible runtime such as Colima.",
      `Run \`docker version\`, then rerun ${retry}.`,
      "If you are not using the managed local runtime, run setup with `--server <url>` instead.",
    ],
    check: shellCommand("docker version"),
    retry,
  };
}
