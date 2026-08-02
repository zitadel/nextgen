import { test as base, type Page } from "@playwright/test";

import { readHandshakeSync } from "./handshake";
import { connectZitadel } from "./index";
import type {
  ConnectedZitadel,
  Identity,
  MintedSession,
  SeededUser,
  SeedSessionInput,
  SeedUserInput,
  SeedUsersTemplate,
} from "./types";

export interface AuthenticatedPage {
  /** A page in its own context, already carrying the session cookie. */
  page: Page;
  user: SeededUser;
  session: MintedSession;
}

export interface ZitadelTestFixtures {
  /** Per-test seeding; each call mints unique data on the shared instance. */
  seed: {
    user(input?: SeedUserInput): Promise<SeededUser>;
    users(count: number, template?: SeedUsersTemplate): Promise<SeededUser[]>;
    /** Unused email+password for registration flows — creates nothing. */
    identity(): Identity;
    /** Seeded user + headless real-flow login; password flows only. */
    session(input?: SeedSessionInput): Promise<MintedSession>;
  };
  /**
   * Start the test authenticated: a fresh user, a real session minted through
   * the flow API, and the cookie injected into a dedicated browser context —
   * the default `page` stays signed out for login-flow tests. Requires
   * `use.baseURL` (every withZitadel consumer sets it).
   */
  authenticatedPage: AuthenticatedPage;
}

export interface ZitadelWorkerFixtures {
  /** Connection to the suite's instance, resolved once per worker. */
  zitadel: ConnectedZitadel;
}

export const test = base.extend<ZitadelTestFixtures, ZitadelWorkerFixtures>({
  zitadel: [
    // Playwright derives fixture dependencies from the destructuring pattern,
    // so the empty pattern is required here.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const handshakePath = process.env.ZITADEL_TESTING_HANDSHAKE;
      if (!handshakePath) {
        throw new Error(
          "ZITADEL_TESTING_HANDSHAKE is not set. Point it at the handshake file " +
            "written by the script that boots the instance (see @zitadel/testing docs).",
        );
      }
      await use(connectZitadel(readHandshakeSync(handshakePath)));
    },
    { scope: "worker" },
  ],
  seed: async ({ zitadel, baseURL }, use) => {
    await use({
      user: (input) => zitadel.seedUser(input),
      users: (count, template) => zitadel.seedUsers(count, template),
      identity: () => zitadel.identity(),
      // The suite's baseURL is the app origin the project allowlists.
      session: (input) => zitadel.seedSession({ origin: baseURL, ...input }),
    });
  },
  authenticatedPage: async ({ browser, zitadel, baseURL }, use) => {
    if (!baseURL) {
      throw new Error(
        "authenticatedPage requires `use.baseURL` so the session cookie can be " +
          "scoped to the app under test.",
      );
    }
    const session = await zitadel.seedSession({ origin: baseURL });
    const context = await browser.newContext({ baseURL });
    // `addCookies` takes either url or domain/path; url derives the rest.
    const { path: _path, ...cookie } = session.cookie;
    await context.addCookies([{ ...cookie, url: baseURL }]);
    const page = await context.newPage();
    await use({ page, user: session.user, session });
    await context.close();
  },
});

export { expect } from "@playwright/test";
export { applyAppEnvTemplate, nextAppEnv } from "./app-env";
export type { AppEnvTemplate } from "./app-env";
export { withZitadel } from "./playwright-config";
export type { WithZitadelOptions } from "./playwright-config";
export type {
  ConnectedZitadel,
  Identity,
  InstanceHandle,
  MintedSession,
  SeededUser,
  SeedSessionInput,
  SeedUserInput,
  SeedUsersTemplate,
} from "./types";
