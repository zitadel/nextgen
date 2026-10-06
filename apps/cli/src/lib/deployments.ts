import type { ZitadelClient } from "./api-client";
import { ZitadelError } from "./errors";

/** The label the CLI prints for the empty origin, which is the project default. */
export const DEFAULT_TARGET = "(default)";

/** One deployment row as every listing shows it. */
export type DeploymentRow = Readonly<{
  id: string;
  deploy_id: string;
  origin: string;
  release_id: string;
  deployed_at: string;
  expires_at?: string | null;
  metadata: { reason?: string; message?: string | null; rollback_of?: string | null };
}>;

export const targetLabel = (origin: string): string => (origin === "" ? DEFAULT_TARGET : origin);

/** `10-02 14:10` for a timestamp, the way the listings print it. */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** `in 6d`, `in 3h`, `expired`: how long a preview row stays live. */
export function relativeExpiry(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return "";
  }
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) {
    return iso;
  }
  if (ms <= 0) {
    return "expired";
  }
  const hours = Math.round(ms / 3_600_000);
  return hours >= 48 ? `in ${Math.round(hours / 24)}d` : `in ${hours}h`;
}

/** The newest row per target: what each one serves right now. */
export async function liveDeployments(
  client: ZitadelClient,
  projectId: string,
): Promise<DeploymentRow[]> {
  const { deployments } = await client.listDeployments({ project_id: projectId, live: true });
  return deployments as DeploymentRow[];
}

/** The release each origin served before a deploy, keyed by origin. */
export function servingByOrigin(rows: readonly DeploymentRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.origin, row.release_id]));
}

/** `7d`, `24h`, `30m` or a bare number of seconds, as `ttl_seconds`. */
export function parseTtl(raw: string): number {
  const match = /^(\d+)([dhms]?)$/.exec(raw.trim());
  if (!match) {
    throw new ZitadelError("E_VALIDATION", `Invalid --ttl ${JSON.stringify(raw)}`, {
      hint: "Write a duration like 7d, 24h or 30m.",
    });
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const seconds =
    unit === "d" ? amount * 86_400 : unit === "h" ? amount * 3_600 : unit === "m" ? amount * 60 : amount;
  if (seconds < 60 || seconds > 2_592_000) {
    throw new ZitadelError("E_VALIDATION", `--ttl must be between 1m and 30d, got ${raw}`);
  }
  return seconds;
}

/**
 * The preview URLs a platform build reports, the branch-stable one and the
 * per-deployment one, or none outside a platform build.
 */
export function platformPreviewOrigins(
  env: NodeJS.ProcessEnv,
): { platform: string; origins: Array<{ url: string; variable: string }> } | undefined {
  const withScheme = (host: string) => (/^https?:\/\//.test(host) ? host : `https://${host}`);
  if (env.VERCEL_BRANCH_URL || env.VERCEL_URL) {
    const origins: Array<{ url: string; variable: string }> = [];
    if (env.VERCEL_BRANCH_URL) {
      origins.push({ url: withScheme(env.VERCEL_BRANCH_URL), variable: "VERCEL_BRANCH_URL" });
    }
    if (env.VERCEL_URL) {
      origins.push({ url: withScheme(env.VERCEL_URL), variable: "VERCEL_URL" });
    }
    return { platform: "vercel", origins };
  }
  if (env.DEPLOY_PRIME_URL || env.DEPLOY_URL) {
    const origins: Array<{ url: string; variable: string }> = [];
    if (env.DEPLOY_PRIME_URL) {
      origins.push({ url: withScheme(env.DEPLOY_PRIME_URL), variable: "DEPLOY_PRIME_URL" });
    }
    if (env.DEPLOY_URL) {
      origins.push({ url: withScheme(env.DEPLOY_URL), variable: "DEPLOY_URL" });
    }
    return { platform: "netlify", origins };
  }
  if (env.CF_PAGES_URL || env.CF_PAGES_BRANCH) {
    const origins: Array<{ url: string; variable: string }> = [];
    // The branch alias is not exported; it is built from the branch and the
    // project name the per-deployment URL carries (`<hash>.<project>.pages.dev`).
    const project = env.CF_PAGES_URL ? /^https?:\/\/[^.]+\.(.+)$/.exec(env.CF_PAGES_URL)?.[1] : undefined;
    if (env.CF_PAGES_BRANCH && project) {
      const label = env.CF_PAGES_BRANCH.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      origins.push({ url: `https://${label}.${project}`, variable: "CF_PAGES_BRANCH" });
    }
    if (env.CF_PAGES_URL) {
      origins.push({ url: withScheme(env.CF_PAGES_URL), variable: "CF_PAGES_URL" });
    }
    return { platform: "cloudflare-pages", origins };
  }
  return undefined;
}

/** The variables `platformPreviewOrigins` looks for, for the error that finds none. */
export const PREVIEW_URL_VARIABLES = ["VERCEL_BRANCH_URL", "DEPLOY_PRIME_URL", "CF_PAGES_BRANCH"];

const dedupe = (urls: string[]): string[] => [...new Set(urls)];

/** Normalises an origin typed on the command line to `scheme://host[:port]`. */
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new ZitadelError("E_VALIDATION", `Invalid origin ${JSON.stringify(raw)}`, {
      hint: "An origin is scheme://host[:port], like https://app.example.com.",
    });
  }
  return url.origin;
}

export const normalizeOrigins = (raws: readonly string[]): string[] =>
  dedupe(raws.map(normalizeOrigin));

/** Whether an origin is covered by an allowlist pattern (`*` is one or more non-dot characters). */
export function matchesPattern(pattern: string, origin: string): boolean {
  const escaped = pattern
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^.]+");
  return new RegExp(`^${escaped}$`).test(origin.toLowerCase());
}
