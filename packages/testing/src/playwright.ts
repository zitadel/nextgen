import { test as base } from "@playwright/test";

import { readHandshakeSync } from "./handshake";
import { connectZitadel } from "./index";
import type { ConnectedZitadel, SeededUser, SeedUserInput } from "./types";

export interface ZitadelTestFixtures {
  /** Per-test seeding; each call mints a unique user on the shared instance. */
  seed: {
    user(input?: SeedUserInput): Promise<SeededUser>;
  };
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
  seed: async ({ zitadel }, use) => {
    await use({ user: (input) => zitadel.seedUser(input) });
  },
});

export { expect } from "@playwright/test";
export type { ConnectedZitadel, SeededUser, SeedUserInput } from "./types";
