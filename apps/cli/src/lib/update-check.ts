import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import semver from "semver";

import { npmDistTagForCliVersion } from "./public-cli";
import { isCI } from "./skills-hint";
import { telemetryConfigDir } from "./telemetry/identity";

/** `@zitadel/cli`, escaped as npm itself escapes a scoped name in a registry path. */
const DIST_TAGS_PATH = "/-/package/@zitadel%2fcli/dist-tags";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A lookup's answer, kept between runs so a command asks the registry at most once a day. */
type CachedLookup = {
  checked_at: number;
  dist_tag: string;
  registry: string;
  version?: string;
};

/** Whether this run stays off the registry: asked to, or on CI, where no person reads a notice. */
export function updateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
  return env.ZITADEL_UPDATE_CHECK === "0" || isCI(env);
}

/**
 * The newest version on this CLI's dist-tag, or `undefined` when nobody can
 * say. Never throws: a lookup is advice, so an offline machine, a registry that
 * does not answer or an unwritable cache costs the answer, not the command.
 *
 * A failed lookup is remembered as well, keeping the version known before it,
 * so an offline machine does not wait out the timeout on every run. `fresh`
 * skips the cache and returns only what the registry answered now.
 */
export async function latestCliVersion(options: {
  cliVersion: string;
  env: NodeJS.ProcessEnv;
  fresh?: boolean;
}): Promise<string | undefined> {
  const { cliVersion, env, fresh = false } = options;
  const distTag = npmDistTagForCliVersion(cliVersion);
  const registry = registryOf(env);
  const file = cacheFile(env);
  const cached = file === undefined ? undefined : await readCache(file, distTag, registry);
  if (!fresh && cached !== undefined && Date.now() - cached.checked_at < CACHE_MAX_AGE_MS) {
    return cached.version;
  }
  const version = await fetchDistTag(distTag, registry);
  if (file !== undefined) {
    await writeCache(file, {
      checked_at: Date.now(),
      dist_tag: distTag,
      registry,
      ...((version ?? cached?.version) === undefined
        ? {}
        : { version: version ?? cached?.version }),
    });
  }
  return fresh ? version : (version ?? cached?.version);
}

/** Whether `latest` is a newer release than `current`; a version that is not semver never is. */
export function isNewerVersion(latest: string | undefined, current: string): boolean {
  return (
    latest !== undefined &&
    semver.valid(latest) !== null &&
    semver.valid(current) !== null &&
    semver.gt(latest, current)
  );
}

/**
 * The registry to ask. `npm_config_registry` is where npm and npx themselves
 * were pointed, so a mirror keeps working and a private registry sees the
 * request npx made.
 */
function registryOf(env: NodeJS.ProcessEnv): string {
  return (env.npm_config_registry?.trim() || DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/** Asks the registry for the package's dist-tags alone, far less than its full document. */
async function fetchDistTag(distTag: string, registry: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${registry}${DIST_TAGS_PATH}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    const tags = (await response.json()) as Record<string, unknown>;
    const version = tags[distTag];
    return typeof version === "string" && semver.valid(version) !== null ? version : undefined;
  } catch {
    return undefined;
  }
}

function cacheFile(env: NodeJS.ProcessEnv): string | undefined {
  const dir = telemetryConfigDir(env);
  return dir === undefined ? undefined : join(dir, "update-check.json");
}

/** The answer kept for this dist-tag on this registry; another registry's says nothing about it. */
async function readCache(
  file: string,
  distTag: string,
  registry: string,
): Promise<CachedLookup | undefined> {
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as CachedLookup;
    if (
      cached.dist_tag !== distTag ||
      cached.registry !== registry ||
      typeof cached.checked_at !== "number"
    ) {
      return undefined;
    }
    // The version is held to what the registry would have had to answer to get
    // here, because a file is as much an answer from outside as the response
    // was: anything else in it is a cache to ask again rather than a version.
    return cached.version === undefined || semver.valid(cached.version) !== null
      ? cached
      : { ...cached, version: undefined };
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, lookup: CachedLookup): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(lookup)}\n`);
  } catch {
    // A home that cannot be written only means asking again next time.
  }
}
