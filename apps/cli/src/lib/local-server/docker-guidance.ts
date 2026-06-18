import { publicCliCommand } from "../public-cli";

export type DockerRuntimeGuidance = {
  hint: string;
  nextActions: string[];
  nextCommands: string[];
};

export function dockerUnavailableMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Docker is not reachable${suffix}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
}

export function dockerRuntimeGuidance(
  retryCommand: "doctor" | "start",
  cliVersion: string,
): DockerRuntimeGuidance {
  return {
    hint:
      "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
    nextActions: [
      "Start Docker Desktop, Docker Engine, or a Docker-compatible runtime such as Colima.",
      `Run \`docker version\`, then rerun \`${publicCliCommand(retryCommand, cliVersion)}\`.`,
      "If you are not using the managed local runtime, run setup with `--server <url>` instead.",
    ],
    nextCommands: ["docker version", publicCliCommand(retryCommand, cliVersion)],
  };
}
