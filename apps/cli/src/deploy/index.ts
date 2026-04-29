import { createDeployAdapters, NoDeployAdapter } from "./adapters";
import type { CommandRunner, DeployAdapter, DeployPlatformId } from "./types";

export type {
  CommandRunner,
  DeployAdapter,
  DeployConfigureResult,
  DeployEnvVars,
  DeployPlatformId,
  DeployStatus,
} from "./types";

export async function detectDeployTarget(
  cwd: string,
  requested?: string,
  runner?: CommandRunner,
): Promise<DeployAdapter> {
  const adapters = createDeployAdapters(runner);
  if (requested) {
    const adapter = adapters.find((candidate) => candidate.id === normalizePlatform(requested));
    return adapter ?? new NoDeployAdapter();
  }

  for (const adapter of adapters) {
    if (await adapter.detect(cwd)) {
      return adapter;
    }
  }

  return new NoDeployAdapter();
}

function normalizePlatform(value: string): DeployPlatformId {
  if (value === "cloudflare-pages") return "cloudflare";
  if (value === "vercel" || value === "netlify" || value === "cloudflare") return value;
  return "none";
}
