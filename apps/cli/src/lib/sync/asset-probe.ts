import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

import { consola } from "consola";
import { Agent } from "undici";

import type { SyncAction, SyncActionWarning } from "./types.js";

/**
 * Branding descriptor fields whose value is a URL the login page fetches as
 * an image. Both are optional and both fail the same invisible way when the
 * URL is well-formed but dead.
 */
const ASSET_FIELDS = ["logo_url", "hero_url"] as const;

/**
 * Per-URL probe budget. Short on purpose: this runs on the critical path of
 * every `plan` and `apply`, and a dead host that never answers must cost a
 * couple of seconds, not a hung command.
 */
const DEFAULT_TIMEOUT_MS = 2500;

/** Keep redirect chains bounded and re-validate every destination ourselves. */
const MAX_REDIRECTS = 5;

/**
 * Addresses an untrusted descriptor must never make the planning host contact.
 * The browser-side render gate still supports canonical loopback HTTP for local
 * development; the CLI probe deliberately leaves those URLs inconclusive
 * instead of turning `plan` over repo content into a localhost/network scanner.
 */
const UNSAFE_IPV4_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  UNSAFE_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
const UNSAFE_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  // Global unicast currently lives in 2000::/3. Excluding everything outside
  // it also covers mapped IPv4, translation, ULA, link-local, and multicast.
  ["::", 3],
  ["4000::", 2],
  ["8000::", 1],
  // Special-purpose ranges inside 2000::/3 are not public asset hosts.
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  UNSAFE_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** Content types that are images despite not being `image/*`. */
const EXTRA_IMAGE_TYPES = new Set(["application/octet-stream"]);

export type AssetProbeVerdict =
  | { kind: "ok" }
  /** The probe could not decide — no warning is worth a false alarm. */
  | { kind: "inconclusive" }
  | { kind: "unreachable"; detail: string }
  | { kind: "status"; status: number }
  | { kind: "empty"; status: number }
  | { kind: "content-type"; contentType: string };

/**
 * Annotate every branding action in a plan with warnings for asset URLs that
 * are well-formed but will not render: an unreachable host, a non-2xx status,
 * or a response that is not an image.
 *
 * Why the CLI probes at all: a bad `logo_url` clears every gate on the way in
 * (the CLI's Zod shape check, the server's save gate) and then fails silently
 * in the browser as a 0×0 `<img>` — no plan output, no apply output, no
 * console error. The probe is the only place in the pipeline that can see it.
 *
 * Deliberately non-fatal and best-effort. A developer on a plane, behind a
 * proxy, or pointing at a CDN that only resolves from production gets a
 * warning, never a failed plan — the machine running `plan` is not
 * necessarily the machine that renders the login page. Set
 * `ZITADEL_SKIP_ASSET_PROBE` to turn it off entirely, and
 * `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget. Only public
 * HTTPS destinations are contacted: loopback/private/internal targets and
 * redirects to them stay inconclusive so repo config cannot scan the planning
 * host's network.
 *
 * Mutates `actions` in place, like {@link validatePlannedFlows} — the caller
 * (`buildSyncPlan`) owns the array it just built.
 */
export async function annotateAssetWarnings(actions: SyncAction[]): Promise<void> {
  if (process.env.ZITADEL_SKIP_ASSET_PROBE) {
    consola.debug("Branding asset probe skipped (ZITADEL_SKIP_ASSET_PROBE is set)");
    return;
  }

  const targets = actions.filter(
    (action): action is Extract<SyncAction, { kind: "create" | "update" | "revise" }> =>
      (action.kind === "create" || action.kind === "update" || action.kind === "revise") &&
      action.syncer.kind === "branding",
  );
  if (targets.length === 0) {
    return;
  }

  // One probe per distinct URL: the same logo referenced twice is one request.
  const urls = new Set<string>();
  for (const action of targets) {
    for (const { url } of assetUrlsOf(action.content)) {
      urls.add(url);
    }
  }
  if (urls.size === 0) {
    return;
  }

  const timeoutMs = probeTimeoutMs();
  const verdicts = new Map(
    await Promise.all(
      [...urls].map(
        async (url): Promise<[string, AssetProbeVerdict]> => [
          url,
          await probeAsset(url, timeoutMs),
        ],
      ),
    ),
  );

  for (const action of targets) {
    const warnings: SyncActionWarning[] = [];
    for (const { field, url } of assetUrlsOf(action.content)) {
      const warning = describeVerdict(field, url, verdicts.get(url) ?? { kind: "inconclusive" });
      if (warning) {
        warnings.push(warning);
      }
    }
    if (warnings.length > 0) {
      action.warnings = [...(action.warnings ?? []), ...warnings];
    }
  }
}

/**
 * The probe itself: a HEAD request bounded by an abort timeout. HEAD keeps a
 * multi-megabyte hero image off the wire — we only need the status line and
 * the content type.
 */
export async function probeAsset(url: string, timeoutMs: number): Promise<AssetProbeVerdict> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    // Shape is the schema's job; an unparseable URL never reaches here.
    return { kind: "inconclusive" };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      if (!isSafeProbeUrl(current)) {
        consola.debug(`asset probe ${url} skipped unsafe/private target: ${current.href}`);
        return { kind: "inconclusive" };
      }

      const response = await requestHead(current, signal);

      if (isRedirect(response.status)) {
        const location = response.location;
        if (!location) {
          return { kind: "status", status: response.status };
        }
        if (redirects >= MAX_REDIRECTS) {
          return { kind: "unreachable", detail: `more than ${MAX_REDIRECTS} redirects` };
        }
        current = new URL(location, current);
        continue;
      }

      // Some origins refuse HEAD outright. That says nothing about the asset,
      // and a false "your logo is broken" is worse than staying quiet.
      if (response.status === 405 || response.status === 501) {
        return { kind: "inconclusive" };
      }
      if (response.status < 200 || response.status >= 300) {
        return { kind: "status", status: response.status };
      }
      // These successful statuses are explicitly bodyless. Treating them as
      // healthy because they also omit Content-Type recreates the exact
      // "well-formed URL that serves nothing" failure this probe exists for.
      if (response.status === 204 || response.status === 205) {
        return { kind: "empty", status: response.status };
      }

      const contentType = response.contentType?.split(";")[0]?.trim().toLowerCase();
      if (!contentType) {
        return { kind: "ok" };
      }
      if (contentType.startsWith("image/") || EXTRA_IMAGE_TYPES.has(contentType)) {
        return { kind: "ok" };
      }
      return { kind: "content-type", contentType };
    }
  } catch (error) {
    if (isUnsafeProbeTargetError(error)) {
      consola.debug(`asset probe ${url} skipped unsafe/private target`);
      return { kind: "inconclusive" };
    }
    consola.debug(`asset probe ${url} failed:`, error);
    return { kind: "unreachable", detail: describeProbeError(error, timeoutMs) };
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Reject targets whose URL alone proves they are unsafe. Hostname resolution
 * happens inside the connector lookup below so validation and connection use
 * the same DNS answer, without a rebinding window.
 */
function isSafeProbeUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return false;
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home.arpa")
  ) {
    return false;
  }

  const literalFamily = isIP(hostname);
  return literalFamily === 0 || !isUnsafeAddress(hostname, literalFamily);
}

/** Resolve once and accept the answer only when every address is public. */
export async function resolvePublicAddresses(
  hostname: string,
): Promise<LookupAddress[] | undefined> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.length > 0 &&
    addresses.every(({ address, family }) => !isUnsafeAddress(address, family))
    ? addresses
    : undefined;
}

function isUnsafeAddress(address: string, family: number): boolean {
  return family === 6
    ? UNSAFE_IPV6_ADDRESSES.check(address, "ipv6")
    : UNSAFE_IPV4_ADDRESSES.check(address, "ipv4");
}

interface HeadResponse {
  status: number;
  location?: string;
  contentType?: string;
}

const UNSAFE_PROBE_TARGET_CODE = "ERR_ZITADEL_UNSAFE_ASSET_TARGET";

function unsafeProbeTargetError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`asset target ${hostname} resolves to a non-public address`), {
    code: UNSAFE_PROBE_TARGET_CODE,
  });
}

/**
 * Validate DNS in the connector's own lookup and return only approved
 * addresses. The socket cannot perform a second lookup, which closes the DNS
 * rebinding gap while preserving the hostname for TLS SNI/certificate checks.
 */
async function requestHead(url: URL, signal: AbortSignal): Promise<HeadResponse> {
  const safeLookup: NonNullable<RequestOptions["lookup"]> = (hostname, options, callback) => {
    resolvePublicAddresses(hostname).then(
      (addresses) => {
        if (!addresses) {
          callback(unsafeProbeTargetError(hostname), "", 0);
          return;
        }
        const candidates =
          options.family === 4 || options.family === 6
            ? addresses.filter(({ family }) => family === options.family)
            : addresses;
        const candidate = candidates[0];
        if (!candidate) {
          callback(unsafeProbeTargetError(hostname), "", 0);
          return;
        }
        if (options.all) {
          callback(null, candidates);
          return;
        }
        callback(null, candidate.address, candidate.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };

  const dispatcher = new Agent({ connect: { lookup: safeLookup } });
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal,
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    return {
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } finally {
    await dispatcher.destroy();
  }
}

function isUnsafeProbeTargetError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === UNSAFE_PROBE_TARGET_CODE) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function describeVerdict(
  field: string,
  url: string,
  verdict: AssetProbeVerdict,
): SyncActionWarning | undefined {
  switch (verdict.kind) {
    case "ok":
    case "inconclusive":
      return undefined;
    case "status":
      return {
        rule: "warn/asset-unreachable",
        message:
          `${field} ${url} returned HTTP ${verdict.status} — the login page renders a ` +
          `well-formed URL that serves nothing as a 0×0 image, with no error anywhere.`,
      };
    case "empty":
      return {
        rule: "warn/asset-unreachable",
        message:
          `${field} ${url} returned HTTP ${verdict.status} with no representation — the login ` +
          `page has no image bytes to render.`,
      };
    case "unreachable":
      return {
        rule: "warn/asset-unreachable",
        message:
          `${field} ${url} could not be reached (${verdict.detail}) — the login page renders ` +
          `an unreachable URL as a 0×0 image. Ignore this if the host is only reachable from ` +
          `where the login page renders; set ZITADEL_SKIP_ASSET_PROBE to stop checking.`,
      };
    case "content-type":
      return {
        rule: "warn/asset-content-type",
        message:
          `${field} ${url} responded with content-type "${verdict.contentType}", not an image — ` +
          `the login page renders a non-image response as a 0×0 image.`,
      };
  }
}

/** The `logo_url` / `hero_url` values a descriptor actually sets. */
function assetUrlsOf(content: object): Array<{ field: string; url: string }> {
  const body = content as Record<string, unknown>;
  const out: Array<{ field: string; url: string }> = [];
  for (const field of ASSET_FIELDS) {
    const value = body[field];
    if (typeof value === "string" && value !== "") {
      out.push({ field, url: value });
    }
  }
  return out;
}

function probeTimeoutMs(): number {
  const raw = Number(process.env.ZITADEL_ASSET_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function describeProbeError(error: unknown, timeoutMs: number): string {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      (error.cause instanceof Error && error.cause.name === "TimeoutError"))
  ) {
    return `no response within ${timeoutMs}ms`;
  }
  if (error instanceof Error) {
    const cause = error.cause;
    const detail = cause instanceof Error ? cause.message : error.message;
    return detail || error.name;
  }
  return String(error);
}
