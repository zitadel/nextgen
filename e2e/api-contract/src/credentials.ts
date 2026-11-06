import { SESSION_COOKIE_NAME, type ConnectedZitadel } from "@zitadel/testing";

import type { SchemeCredential } from "./command";
import type { Family, OpenApiSpec } from "./spec";

/** The header the server requires a session-cookie request that changes state to carry. */
const CSRF_HEADER = "X-Zitadel-CSRF";

/** What a family's requests carry: plain headers, and credentials for security schemes. */
export interface Credential {
  headers: Record<string, string>;
  schemes: Record<string, SchemeCredential>;
}

/**
 * The credentials each family's requests carry against one instance:
 *
 * - `public`: none.
 * - `management`: the project secret, for the spec's bearer scheme.
 * - `session` and `logout`: a signed-in end user's session cookie, for the
 *   spec's cookie scheme, and the CSRF token the server pairs with it. Each
 *   gets a user and a session of its own, because logging out ends the session.
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

  async forFamily(family: Family): Promise<Credential> {
    switch (family) {
      case "public":
        return { headers: {}, schemes: {} };
      case "management":
        return {
          headers: {},
          schemes: {
            [this.spec.schemeNamed("bearer")]: {
              kind: "bearer",
              value: this.zitadel.handle.projectSecret,
            },
          },
        };
      case "session":
      case "logout":
        return this.session();
    }
  }

  private async session(): Promise<Credential> {
    const minted = await this.zitadel.seedSession();
    const response = await fetch(`${this.baseUrl}/sessions/me/csrf`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${minted.cookie.value}` },
    });
    if (!response.ok) {
      throw new Error(`GET ${this.baseUrl}/sessions/me/csrf answered ${String(response.status)}`);
    }
    const body = (await response.json()) as { csrf_token: string };
    return {
      headers: { [CSRF_HEADER]: body.csrf_token },
      schemes: {
        [this.spec.schemeNamed("cookie")]: { kind: "cookie", value: minted.cookie.value },
      },
    };
  }
}
