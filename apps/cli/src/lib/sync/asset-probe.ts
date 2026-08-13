import { consola } from "consola";

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

/** Content types that are images despite not being `image/*`. */
const EXTRA_IMAGE_TYPES = new Set(["application/octet-stream"]);

export type AssetProbeVerdict =
  | { kind: "ok" }
  /** The probe could not decide — no warning is worth a false alarm. */
  | { kind: "inconclusive" }
  | { kind: "unreachable"; detail: string }
  | { kind: "status"; status: number }
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
 * `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget.
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
        async (url): Promise<[string, AssetProbeVerdict]> => [url, await probeAsset(url, timeoutMs)],
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Shape is the schema's job; an unparseable URL never reaches here.
    return { kind: "inconclusive" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { kind: "inconclusive" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    consola.debug(`asset probe ${url} failed:`, error);
    return { kind: "unreachable", detail: describeFetchError(error, timeoutMs) };
  }

  // Some origins refuse HEAD outright. That says nothing about the asset, and
  // a false "your logo is broken" is worse than staying quiet.
  if (response.status === 405 || response.status === 501) {
    return { kind: "inconclusive" };
  }
  if (!response.ok) {
    return { kind: "status", status: response.status };
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!contentType) {
    return { kind: "ok" };
  }
  if (contentType.startsWith("image/") || EXTRA_IMAGE_TYPES.has(contentType)) {
    return { kind: "ok" };
  }
  return { kind: "content-type", contentType };
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

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `no response within ${timeoutMs}ms`;
  }
  if (error instanceof Error) {
    // `fetch` wraps DNS/TLS/connection failures in a bare "fetch failed";
    // the cause carries the sentence a human can act on.
    const cause = error.cause;
    const detail = cause instanceof Error ? cause.message : error.message;
    return detail || error.name;
  }
  return String(error);
}
