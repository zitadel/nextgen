import { createHash } from "node:crypto";

import type { Property } from "@/lib/telemetry/property";

/**
 * A one-way hash of the project a command acts on, so an event the CLI sends
 * and an event the server sends about the same project can be matched without
 * either carrying the project's id. The server hashes its own id the same way:
 * SHA-256, in lowercase hex.
 */
class ProjectHash implements Property<string | undefined, string | undefined> {
  public value(projectId: string | undefined): string | undefined {
    if (projectId === undefined) {
      return undefined;
    }

    return createHash("sha256").update(projectId).digest("hex");
  }
}

export const projectHash = new ProjectHash();
