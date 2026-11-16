import { Server } from "@/lib/server";
import type { Property } from "@/lib/telemetry/property";

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
    const server = Server.at(source);
    if (server.isCloud()) {
      return "cloud";
    }
    if (server.isLoopback()) {
      return "local";
    }
    return "self_hosted";
  }
}

export const serverKind = new ServerKind();
