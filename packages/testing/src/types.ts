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
   * First registered app origin. Flow submissions enforce the project's
   * origin allowlist, so headless drivers (seedSession) send it as the
   * Origin header the way a browser request through the app would.
   */
  appOrigin?: string;
  /**
   * Server-assigned id of the seeded user schema. A user names it in `schema`
   * and puts the schema-defined content under `attributes`, so seeding needs
   * it alongside the project credential.
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

/** An unused identity: seeded nowhere, ready for registration-flow specs. */
export interface Identity {
  email: string;
  password: string;
}

/** Injectable mirror of the server's session cookie (session.go). */
export interface SessionCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
  path: string;
}

export interface MintedSession {
  user: SeededUser;
  /** Bearer for session management APIs (e.g. `GET /sessions/me`). */
  sessionToken: string;
  expiresAt: string;
  cookie: SessionCookie;
}

export interface SeedSessionInput extends SeedUserInput {
  /** Mint for an existing user instead of seeding a fresh one. */
  user?: SeededUser;
  /** Specific flow definition; the project default when omitted. */
  flowDefinitionName?: string;
  /**
   * Origin header for the flow calls (must be on the project's allowlist).
   * Defaults to the handle's registered app origin; the Playwright fixtures
   * pass the suite's baseURL.
   */
  origin?: string;
}

export interface SeedUsersTemplate {
  email?: (index: number) => string;
  password?: (index: number) => string;
  attributes?: (index: number) => Record<string, unknown>;
}

export interface ConnectedZitadel {
  handle: InstanceHandle;
  /** Authenticated platform API client (bearer = project secret). */
  api: ZitadelClient;
  /** Env vars an SDK-based app needs to talk to this instance/project. */
  appEnv: Record<string, string>;
  seedUser(input?: SeedUserInput): Promise<SeededUser>;
  /** Batch-seed users; the template makes fixture data deterministic. */
  seedUsers(count: number, template?: SeedUsersTemplate): Promise<SeededUser[]>;
  /** A unique unused email+password — nothing is created on the instance. */
  identity(): Identity;
  /**
   * Seed (or take) a user and drive the real login flow headlessly to a
   * session: tests inject `cookie` to start authenticated, backend tests use
   * `sessionToken` directly. Password flows only.
   */
  seedSession(input?: SeedSessionInput): Promise<MintedSession>;
}

export interface LocalZitadelRuntime {
  port: number;
  pid: number;
  /** State directory holding `.zitadel/local/` (data dir, logs, runtime.json). */
  dir: string;
  logPath: string;
}

export interface LocalZitadel extends ConnectedZitadel, AsyncDisposable {
  runtime: LocalZitadelRuntime;
  stop(): Promise<void>;
}
