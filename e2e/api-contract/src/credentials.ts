import { SESSION_COOKIE_NAME, type ConnectedZitadel } from "@zitadel/testing";

import type { SchemeCredential } from "./command";
import type { OpenApiSpec } from "./spec";

/** The header the server requires a session-cookie request that changes state to carry. */
export const CSRF_HEADER = "X-Zitadel-CSRF";

/** A signed-in end user's session: the cookie for the spec's cookie scheme, and the CSRF token the server pairs with it. */
export interface SessionCredential {
  /** The credential Schemathesis applies where the spec asks for a session cookie. */
  scheme: Record<string, SchemeCredential>;
  csrfToken: string;
}

/**
 * The credentials one instance answers to:
 *
 * - the project secret, for the spec's bearer scheme;
 * - a signed-in end user's session. Each call mints a user and a session of
 *   its own, because logging out ends the session.
 */
export class Credentials {
  private readonly zitadel: ConnectedZitadel;
  private readonly spec: OpenApiSpec;
  private readonly baseUrl: string;

  constructor(zitadel: ConnectedZitadel, spec: OpenApiSpec, baseUrl: string) {
    this.zitadel = zitadel;
    this.spec = spec;
    this.baseUrl = baseUrl;
  }

  /** The project secret, keyed by the spec's bearer scheme. */
  bearer(): Record<string, SchemeCredential> {
    return {
      [this.spec.schemeNamed("bearer")]: {
        kind: "bearer",
        value: this.zitadel.handle.projectSecret,
      },
    };
  }

  async session(): Promise<SessionCredential> {
    const minted = await this.zitadel.seedSession();
    const response = await fetch(`${this.baseUrl}/sessions/me/csrf`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${minted.cookie.value}` },
    });
    if (!response.ok) {
      throw new Error(`GET ${this.baseUrl}/sessions/me/csrf answered ${String(response.status)}`);
    }
    const body = (await response.json()) as { csrf_token: string };
    return {
      scheme: { [this.spec.schemeNamed("cookie")]: { kind: "cookie", value: minted.cookie.value } },
      csrfToken: body.csrf_token,
    };
  }
}
