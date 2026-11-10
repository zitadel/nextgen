import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

import { log } from "@/lib/log";
import { Agent, type Dispatcher } from "undici";

import { userAgent } from "@/lib/user-agent";
import type { JsonObject } from "@/lib/zitadel";

/**
 * Branding descriptor fields whose value is a URL the login page fetches as
 * an image. Both are optional and both fail the same invisible way when the
 * URL is well-formed but dead.
 */
const ASSET_FIELDS = ["logo_url", "hero_url"] as const;

/**
 * One branding descriptor field that names an image.
 */
type AssetField = (typeof ASSET_FIELDS)[number];

/**
 * One asset URL a descriptor sets, and the field that sets it.
 */
type AssetUrl = {
  readonly field: AssetField;
  readonly url: string;
};

/**
 * Per-URL probe budget. Short on purpose: this runs on the critical path of
 * every `deploy` and `preview`, and a dead host that never answers must cost a
 * couple of seconds, not a hung command.
 */
const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Keep redirect chains bounded and re-validate every destination ourselves.
 */
const MAX_REDIRECTS = 5;

/**
 * The statuses that redirect, which the probe follows itself.
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * A network and its prefix length, as a block list takes a subnet.
 */
type Subnet = readonly [network: string, prefix: number];

/**
 * A block list holding every subnet given.
 *
 * @param family - The address family of the subnets.
 * @param subnets - The subnets.
 * @returns The block list.
 */
function blockListOf(family: "ipv4" | "ipv6", subnets: readonly Subnet[]): BlockList {
  const list = new BlockList();
  for (const subnet of subnets) {
    list.addSubnet(subnet[0], subnet[1], family);
  }
  return list;
}

/**
 * IPv4 addresses an untrusted descriptor must never make the planning host
 * contact.
 *
 * @remarks
 * The browser-side render gate still supports canonical loopback HTTP for local
 * development; the CLI probe deliberately leaves those URLs inconclusive
 * instead of turning `deploy` over repo content into a localhost/network scanner.
 */
const UNSAFE_IPV4_ADDRESSES = blockListOf("ipv4", [
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
]);

/**
 * IPv6 addresses an untrusted descriptor must never make the planning host
 * contact.
 */
const UNSAFE_IPV6_ADDRESSES = blockListOf("ipv6", [
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
]);

/**
 * Host names that never name a public asset host, by their suffix.
 */
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"] as const;

/**
 * Content types that are images despite not being `image/*`.
 */
const EXTRA_IMAGE_TYPES: ReadonlySet<string> = new Set(["application/octet-stream"]);

/**
 * What probing one asset URL found.
 */
export type AssetProbeVerdict =
  | { readonly kind: "ok" }
  /** The probe could not decide — no warning is worth a false alarm. */
  | { readonly kind: "inconclusive" }
  | { readonly kind: "unreachable"; readonly detail: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "empty"; readonly status: number }
  | { readonly kind: "content-type"; readonly contentType: string };

/**
 * Probe every asset URL the bundle's branding descriptors carry and return one
 * warning line per URL that is well-formed but will not render: an unreachable
 * host, a non-2xx status, or a response that is not an image.
 *
 * @remarks
 * Why the CLI probes at all: a bad `logo_url` clears every gate on the way in
 * (the CLI's Zod shape check, the server's save gate) and then fails silently
 * in the browser as a 0×0 `<img>` — no deploy output, no console error. The
 * probe is the only place in the pipeline that can see it.
 *
 * Deliberately non-fatal and best-effort. A developer on a plane, behind a
 * proxy, or pointing at a CDN that only resolves from production gets a
 * warning, never a failed deploy — the machine running `deploy` is not
 * necessarily the machine that renders the login page. Set
 * `ZITADEL_SKIP_ASSET_PROBE` to turn it off entirely, and
 * `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget. Only public
 * HTTPS destinations are contacted: loopback/private/internal targets and
 * redirects to them stay inconclusive so repo config cannot scan the running
 * host's network.
 *
 * @param brandings - The branding descriptors' wire bodies.
 * @returns One warning per field whose URL will not render.
 */
export async function brandingAssetWarnings(
  brandings: readonly JsonObject[],
): Promise<readonly string[]> {
  if (process.env.ZITADEL_SKIP_ASSET_PROBE) {
    log.debug("Branding asset probe skipped (ZITADEL_SKIP_ASSET_PROBE is set)");
    return [];
  }

  // One probe per distinct URL: the same logo referenced twice is one request.
  const fields = brandings.flatMap(assetUrlsOf);
  const urls = [
    ...new Set(
      fields.map((field) => {
        return field.url;
      }),
    ),
  ];
  if (urls.length === 0) {
    return [];
  }

  const timeoutMs = probeTimeoutMs();
  const verdicts = new Map(
    await Promise.all(
      urls.map(async (url): Promise<readonly [string, AssetProbeVerdict]> => {
        const verdict = await probeAsset(url, timeoutMs);
        return [url, verdict];
      }),
    ),
  );

  return fields.flatMap((field) => {
    const verdict = verdicts.get(field.url) ?? { kind: "inconclusive" };
    const warning = describeVerdict(field, verdict);
    if (warning === undefined) {
      return [];
    }
    return [warning];
  });
}

/**
 * The probe itself: a HEAD request bounded by an abort timeout.
 *
 * @remarks
 * HEAD keeps a multi-megabyte hero image off the wire — we only need the
 * status line and the content type. A redirect is followed by calling this
 * again with the next hop, sharing the same time budget.
 *
 * @param url - The URL the descriptor names.
 * @param timeoutMs - The budget for the whole chain of requests.
 * @param current - The hop being requested; the URL itself on the first call.
 * @param redirects - How many redirects were followed to reach it.
 * @param signal - The budget's abort signal, shared across every hop.
 * @returns What the probe found.
 */
export async function probeAsset(
  url: string,
  timeoutMs: number,
  current?: URL,
  redirects = 0,
  signal = AbortSignal.timeout(timeoutMs),
): Promise<AssetProbeVerdict> {
  if (!URL.canParse(url)) {
    // Shape is the schema's job; an unparseable URL never reaches here.
    return { kind: "inconclusive" };
  }
  const target = current ?? new URL(url);
  try {
    if (!isSafeProbeUrl(target)) {
      log.debug(`asset probe ${url} skipped unsafe/private target: ${target.href}`);
      return { kind: "inconclusive" };
    }

    const response = await requestHead(target, signal);

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.location;
      if (!location) {
        return { kind: "status", status: response.status };
      }
      if (redirects >= MAX_REDIRECTS) {
        return { kind: "unreachable", detail: `more than ${MAX_REDIRECTS} redirects` };
      }
      return await probeAsset(url, timeoutMs, new URL(location, target), redirects + 1, signal);
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
  } catch (error) {
    if (isUnsafeProbeTargetError(error, 0)) {
      log.debug(`asset probe ${url} skipped unsafe/private target`);
      return { kind: "inconclusive" };
    }
    log.debug(`asset probe ${url} failed:`, error);
    return { kind: "unreachable", detail: describeProbeError(error, timeoutMs) };
  }
}

/**
 * Reject targets whose URL alone proves they are unsafe.
 *
 * @remarks
 * Hostname resolution happens inside the connector lookup below so validation
 * and connection use the same DNS answer, without a rebinding window.
 *
 * @param url - The hop about to be requested.
 * @returns Whether it may be requested.
 */
function isSafeProbeUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return false;
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (hostname === "localhost" || !hostname.includes(".")) {
    return false;
  }
  const isPrivateName = PRIVATE_HOST_SUFFIXES.some((suffix) => {
    return hostname.endsWith(suffix);
  });
  if (isPrivateName) {
    return false;
  }

  const literalFamily = isIP(hostname);
  return literalFamily === 0 || !isUnsafeAddress(hostname, literalFamily);
}

/**
 * Resolve once and accept the answer only when every address is public.
 *
 * @param hostname - The host to resolve.
 * @returns Every address, or `undefined` when none resolved or any is not public.
 * @throws When the lookup itself fails.
 */
export async function resolvePublicAddresses(
  hostname: string,
): Promise<readonly LookupAddress[] | undefined> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    return undefined;
  }
  const allPublic = addresses.every((address) => {
    return !isUnsafeAddress(address.address, address.family);
  });
  if (!allPublic) {
    return undefined;
  }
  return addresses;
}

/**
 * Whether an address lies in a range a probe must never contact.
 *
 * @param address - The address.
 * @param family - Its family, 4 or 6.
 * @returns Whether it is unsafe.
 */
function isUnsafeAddress(address: string, family: number): boolean {
  if (family === 6) {
    return UNSAFE_IPV6_ADDRESSES.check(address, "ipv6");
  }
  return UNSAFE_IPV4_ADDRESSES.check(address, "ipv4");
}

/**
 * What a HEAD request answered with, as far as the probe reads it.
 */
type HeadResponse = {
  readonly status: number;
  readonly location: string | undefined;
  readonly contentType: string | undefined;
};

/**
 * The code an error carries when the lookup refused a non-public address.
 */
const UNSAFE_PROBE_TARGET_CODE = "ERR_ZITADEL_UNSAFE_ASSET_TARGET";

/**
 * The error the lookup fails with when a host resolves to a non-public address.
 *
 * @param hostname - The host.
 * @returns The error, carrying {@link UNSAFE_PROBE_TARGET_CODE}.
 */
function unsafeProbeTargetError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`asset target ${hostname} resolves to a non-public address`), {
    code: UNSAFE_PROBE_TARGET_CODE,
  });
}

/**
 * Send one HEAD request, resolving the host through a lookup that only
 * returns approved addresses.
 *
 * @remarks
 * Validating DNS in the connector's own lookup means the socket cannot perform
 * a second lookup, which closes the DNS rebinding gap while preserving the
 * hostname for TLS SNI/certificate checks.
 *
 * @param url - The hop to request.
 * @param signal - The probe's time budget.
 * @returns The status and the headers the probe reads.
 * @throws When the request fails, the host resolves to a non-public address,
 *   or the budget runs out.
 */
async function requestHead(url: URL, signal: AbortSignal): Promise<HeadResponse> {
  const safeLookup: NonNullable<RequestOptions["lookup"]> = (hostname, options, callback) => {
    resolvePublicAddresses(hostname).then(
      (addresses) => {
        if (!addresses) {
          callback(unsafeProbeTargetError(hostname), "", 0);
          return;
        }
        const wanted = options.family === 4 || options.family === 6;
        const candidates = addresses.filter((address) => {
          return !wanted || address.family === options.family;
        });
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
      (error: NodeJS.ErrnoException) => {
        callback(error, "", 0);
      },
    );
  };

  const dispatcher = new Agent({ connect: { lookup: safeLookup } });
  // The global fetch takes undici's dispatcher, which its own type leaves out.
  const init: RequestInit & { readonly dispatcher: Dispatcher } = {
    method: "HEAD",
    headers: { "user-agent": userAgent() },
    redirect: "manual",
    signal,
    dispatcher,
  };
  try {
    const response = await fetch(url, init);
    return {
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } finally {
    await dispatcher.destroy();
  }
}

/**
 * Whether an error, or one of the first few errors it was caused by, is the
 * lookup refusing a non-public address.
 *
 * @param error - What the request threw.
 * @param depth - How many causes deep this is.
 * @returns Whether it is that refusal.
 */
function isUnsafeProbeTargetError(error: unknown, depth: number): boolean {
  if (depth >= 4 || !(error instanceof Error)) {
    return false;
  }
  if ("code" in error && error.code === UNSAFE_PROBE_TARGET_CODE) {
    return true;
  }
  return isUnsafeProbeTargetError(error.cause, depth + 1);
}

/**
 * The warning a verdict earns.
 *
 * @param asset - The field and the URL it sets.
 * @param verdict - What probing the URL found.
 * @returns The warning, or `undefined` when the URL renders or the probe could
 *   not tell.
 */
function describeVerdict(asset: AssetUrl, verdict: AssetProbeVerdict): string | undefined {
  const named = `${asset.field} ${asset.url}`;
  switch (verdict.kind) {
    case "ok":
    case "inconclusive": {
      return undefined;
    }
    case "status": {
      return (
        `${named} returned HTTP ${verdict.status} — the login page renders a ` +
        `well-formed URL that serves nothing as a 0×0 image, with no error anywhere.`
      );
    }
    case "empty": {
      return (
        `${named} returned HTTP ${verdict.status} with no representation — the login ` +
        `page has no image bytes to render.`
      );
    }
    case "unreachable": {
      return (
        `${named} could not be reached (${verdict.detail}) — the login page renders ` +
        `an unreachable URL as a 0×0 image. Ignore this if the host is only reachable from ` +
        `where the login page renders; set ZITADEL_SKIP_ASSET_PROBE to stop checking.`
      );
    }
    case "content-type": {
      return (
        `${named} responded with content-type "${verdict.contentType}", not an image — ` +
        `the login page renders a non-image response as a 0×0 image.`
      );
    }
  }
}

/**
 * The `logo_url` / `hero_url` values a descriptor actually sets.
 *
 * @param body - A branding descriptor's wire body.
 * @returns Each field that holds a non-empty string, with its URL.
 */
function assetUrlsOf(body: JsonObject): readonly AssetUrl[] {
  return ASSET_FIELDS.flatMap((field) => {
    const value = body[field];
    if (typeof value !== "string" || value === "") {
      return [];
    }
    return [{ field, url: value }];
  });
}

/**
 * The per-URL budget, as `ZITADEL_ASSET_PROBE_TIMEOUT_MS` retunes it.
 *
 * @returns The budget in milliseconds.
 */
function probeTimeoutMs(): number {
  const raw = Number(process.env.ZITADEL_ASSET_PROBE_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Why a probe failed, in a few words.
 *
 * @param error - What the request threw.
 * @param timeoutMs - The budget it ran out of, when it timed out.
 * @returns The reason.
 */
function describeProbeError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause;
  const timedOut =
    error.name === "TimeoutError" || (cause instanceof Error && cause.name === "TimeoutError");
  if (timedOut) {
    return `no response within ${timeoutMs}ms`;
  }
  const detail = cause instanceof Error ? cause.message : error.message;
  return detail || error.name;
}
