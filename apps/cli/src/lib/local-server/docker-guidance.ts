import { shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import { errorMessage } from "@/lib/errors";

export type DockerRuntimeGuidance = {
  hint: string;
  nextActions: string[];
  /** The command that checks Docker answers; the retry follows it. */
  check: SuggestedCommand;
  /** The command to rerun once Docker answers, for the caller to suggest. */
  retry: "doctor" | "start";
};

export function dockerUnavailableMessage(error: unknown): string {
  const detail = errorMessage(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Docker is not reachable${suffix}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
}

export function dockerRuntimeGuidance(retryCommand: "doctor" | "start"): DockerRuntimeGuidance {
  return {
    hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
    nextActions: [
      "Start Docker Desktop, Docker Engine, or a Docker-compatible runtime such as Colima.",
      `Run \`docker version\`, then rerun ${retryCommand}.`,
      "If you are not using the managed local runtime, run setup with `--server <url>` instead.",
    ],
    check: shellCommand("docker version"),
    retry: retryCommand,
  };
}
