import type { ZitadelClient } from "@zitadel/api/client";

/**
 * Credentials of the reserved platform project, captured by the kit at
 * provisioning time. The shape follows the direction settled in PR #876's
 * review (root ADR 052 §9 and Console ADR 0004 §2 — both still Proposed
 * there): bootstrap mints **no platform project secret** — the publishable
 * key is the only default credential, the platform-homed automation
 * principal is deferred to the PAT / service-user decision §5 defers (no
 * wire format exists yet), and "test infrastructure obtains credentials
 * through the testkit's boot contract rather than through a seed default."
 *
 * Stub today: the server's platform-project provisioner does not exist yet,
 * so `startLocalZitadel` never populates this field. The shape is fixed now
 * so fixtures can code against it without churning when the provisioner
 * lands; if the proposal shifts before acceptance, this inert slot moves
 * with it.
 */
export interface PlatformCredentials {
  /** Reserved platform project id — the Console sign-in target. */
  projectId: string;
  /**
   * Browser-safe publishable key. Required: it is the one credential
   * bootstrap always provisions (sign-in needs it), so a platform block
   * without it is malformed.
   */
  publishableKey: string;
  /**
   * Platform-homed automation credential, captured at creation — the server
   * returns it exactly once. Present only when the boot options explicitly
   * request one; there is no ambient platform secret to capture. The
   * concrete principal (storage, issuance, wire format) is deferred to the
   * future PAT / service-user ADR, so this stays a reserved slot until it
   * lands.
   */
  platformKey?: string;
  /**
   * Operator session minted through the real login flow at boot, for suites
   * that drive Console/management surfaces without re-running sign-in.
   */
  operatorSession?: MintedSession;
}

/**
 * Serializable description of a bootstrapped instance + project. This is the
 * contract that crosses process boundaries (boot script -> Playwright workers)
 * — and the credential surface of the kit: every credential the server mints
 * during provisioning is captured here, so tests and dev loops read them from
 * the handle instead of hand-set environment or a server-side test door (a
 * server flag that mints deterministic credentials must not exist).
 */
export interface InstanceHandle {
  baseUrl: string;
  projectId: string;
  /**
   * The seeded customer project's operator credential, captured from
   * `POST /projects` — the server returns it exactly once, at creation.
   * Bearer for the management API (`api`) and every seed op.
   */
  projectSecret: string;
  /**
   * First registered app origin. Flow submissions enforce the project's
   * origin allowlist, so headless drivers (seedSession) send it as the
   * Origin header the way a browser request through the app would.
   */
  appOrigin?: string;
  /**
   * Server-assigned id of the seeded user schema. User documents must
   * reference it via their `$schema` field, so seeding needs it alongside the
   * project credential.
   */
  schemaId: string;
  /**
   * The same project's browser-plane credential (the publishable-key
   * predecessor from root ADR 036), also captured at creation.
   */
  previewSecret?: string;
  /**
   * Platform-plane credential slot. Unpopulated until the platform-project
   * provisioner (Console ADR 0004 §2) lands server-side; see
   * `PlatformCredentials` for the settled contract and why it stays empty
   * today.
   */
  platform?: PlatformCredentials;
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
