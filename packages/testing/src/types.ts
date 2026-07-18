import type { ZitadelClient } from "@zitadel/api/client";

/**
 * Serializable description of a bootstrapped instance + project. This is the
 * contract that crosses process boundaries (boot script -> Playwright workers).
 */
export interface InstanceHandle {
  baseUrl: string;
  projectId: string;
  projectSecret: string;
  /**
   * Server-assigned id of the seeded user schema. User documents must
   * reference it via their `$schema` field, so seeding needs it alongside the
   * project credential.
   */
  schemaId: string;
  previewSecret?: string;
}

export interface SeedUserInput {
  email?: string;
  password?: string;
  /** Extra schema-defined user properties merged into the create body. */
  attributes?: Record<string, unknown>;
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

export interface ConnectedZitadel {
  handle: InstanceHandle;
  /** Authenticated platform API client (bearer = project secret). */
  api: ZitadelClient;
  /** Env vars an SDK-based app needs to talk to this instance/project. */
  appEnv: Record<string, string>;
  seedUser(input?: SeedUserInput): Promise<SeededUser>;
}

export interface LocalZitadelRuntime {
  port: number;
  pid: number;
  /** State directory holding `.zitadel/local/` (data dir, logs, runtime.json). */
  dir: string;
  logPath: string;
}

export interface LocalZitadel extends ConnectedZitadel {
  runtime: LocalZitadelRuntime;
  stop(): Promise<void>;
}
