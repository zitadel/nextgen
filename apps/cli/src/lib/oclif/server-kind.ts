import type { Property } from "../telemetry/property";

/**
 * Buckets the resolved backend `source` into a coarse kind. The raw URL is never
 * emitted — it can carry an internal/self-hosted hostname — only which kind of
 * backend the command targeted.
 */
class ServerKind implements Property<string, "cloud" | "local" | "self_hosted" | "unknown"> {
  public value(source: string): "cloud" | "local" | "self_hosted" | "unknown" {
    if (source === "mock") {
      return "local";
    }
    if (!URL.canParse(source)) {
      return "unknown";
    }
    const { hostname } = new URL(source);
    if (hostname === "zitadel.cloud" || hostname.endsWith(".zitadel.cloud")) {
      return "cloud";
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return "local";
    }
    return "self_hosted";
  }
}

export const serverKind = new ServerKind();
