import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A deployment platform the CLI can scaffold a production edge proxy for. SPA
 * frameworks have no server runtime, so the same-origin `/__nextgen/*` proxy
 * that injects the project secret must run as a platform edge function/worker.
 */
export type DeployTarget = "cloudflare" | "vercel" | "netlify";

type TargetSpec = Readonly<{
  target: DeployTarget;
  /** The platform CLI binary whose presence signals the user deploys there. */
  cli: string;
  /** Config files that, when present, confirm the project targets this platform. */
  configFiles: ReadonlyArray<string>;
}>;

/**
 * Resolution order when more than one platform CLI is installed and no config
 * file disambiguates. Cloudflare first because it is the only target that
 * strictly requires a worker (Pages `_redirects` cannot proxy an external
 * origin), so a Cloudflare user has the least fallback if we guess wrong.
 */
const TARGETS: ReadonlyArray<TargetSpec> = [
  {
    target: "cloudflare",
    cli: "wrangler",
    configFiles: ["wrangler.toml", "wrangler.jsonc", "wrangler.json"],
  },
  { target: "vercel", cli: "vercel", configFiles: ["vercel.json", ".vercel"] },
  { target: "netlify", cli: "netlify", configFiles: ["netlify.toml"] },
];

/** Injectable probes so tests can resolve a target without spawning processes. */
export type DeployTargetProbes = Readonly<{
  isCliInstalled: (cli: string) => boolean;
  configFileExists: (cwd: string, file: string) => boolean;
}>;

/** Returns `true` when `cli` is on PATH (spawns `<cli> --version`). */
export function isCliInstalled(cli: string): boolean {
  const result = spawnSync(cli, ["--version"], { encoding: "utf8", timeout: 5000 });
  // `error` is set only when the spawn itself fails (ENOENT = not on PATH).
  // A non-zero exit still means the binary exists, so treat that as installed.
  return result.error === undefined;
}

const DEFAULT_PROBES: DeployTargetProbes = {
  isCliInstalled,
  configFileExists: (cwd, file) => existsSync(join(cwd, file)),
};

/**
 * Detects which platform to scaffold the production edge proxy for by looking
 * at which platform CLI is installed. When several are installed, a present
 * platform config file in `cwd` disambiguates; absent that, the first installed
 * target in {@link TARGETS} priority order wins. Returns `undefined` when no
 * platform CLI is installed — the caller then skips edge-proxy scaffolding.
 */
export function detectDeployTarget(
  cwd: string,
  probes: DeployTargetProbes = DEFAULT_PROBES,
): DeployTarget | undefined {
  const installed = TARGETS.filter((spec) => probes.isCliInstalled(spec.cli));
  // When several CLIs are installed, a present platform config file in `cwd`
  // disambiguates; otherwise the first installed target in priority order wins.
  const configured = installed.find((spec) =>
    spec.configFiles.some((file) => probes.configFileExists(cwd, file)),
  );
  const chosen = configured ?? installed[0];
  return chosen?.target;
}
