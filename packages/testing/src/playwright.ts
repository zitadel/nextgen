import { test as base, type Page } from "@playwright/test";

import { waitForHandshake } from "./handshake";
import { connectZitadel } from "./index";
import { enableVirtualPasskey, type VirtualPasskey } from "./passkey";
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
  /**
   * Virtual passkey authenticator attached to the default `page`, disposed on
   * teardown. On-demand: tests that don't request it pay nothing. Chromium
   * only — see `enableVirtualPasskey` for the constraints.
   */
  passkey: VirtualPasskey;
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
      // Wait, don't read-once: the supervisor's Playwright readiness URL is
      // the instance's /healthz, which answers as soon as the *server* is up
      // — the handshake lands only after *bootstrap* (project, schema,
      // flows) completes a moment later. Suites with an `app` entry never
      // see the gap (the app runner waits for the handshake before the app
      // reports ready), but in app-less mode the first worker can get here
      // first. Bootstrap after health is seconds at most, so the default
      // wait is generous; a bootstrap failure surfaces as this timeout.
      await use(connectZitadel(await waitForHandshake(handshakePath)));
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
  passkey: async ({ page }, use) => {
    const passkey = await enableVirtualPasskey(page);
    await use(passkey);
    await passkey.dispose();
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
export {
  clickFlowAction,
  fillFlowField,
  flowAction,
  flowField,
  loginWithPassword,
  loginWithPasskey,
  registerWithPassword,
  registerWithPasskey,
} from "./flows";
export type {
  FlowActionOptions,
  FlowFieldOptions,
  LoginCredentials,
  PasswordRegistrationDetails,
  ProfileEntry,
  RegistrationDetails,
} from "./flows";
export { enableVirtualPasskey } from "./passkey";
export type { VirtualPasskey } from "./passkey";
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
