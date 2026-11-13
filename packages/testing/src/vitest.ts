import { inject } from "vitest";
import type { TestProject } from "vitest/node";

import { connectZitadel, startLocalZitadel, type StartLocalZitadelOptions } from "./index";
import type { ConnectedZitadel, InstanceHandle } from "./types";

/**
 * The `provide`/`inject` key the global setup hands the handle over under.
 * Not exported: `injectZitadel()` is the only reader, so the key can change
 * without breaking a consumer.
 */
const HANDLE_KEY = "@zitadel/testing:handle";

/**
 * Boot options for the run's instance: exactly what `startLocalZitadel`
 * takes.
 */
export type ZitadelGlobalSetupOptions = StartLocalZitadelOptions;

/** The function a Vitest `globalSetup` module default-exports. */
export type ZitadelGlobalSetup = (project: TestProject) => Promise<() => Promise<void>>;

/**
 * Vitest global setup that boots one local instance for the whole run with
 * `startLocalZitadel(options)`, provides its serializable handle to every
 * test file, and stops it when the run ends. Default-export its result from
 * the module the config names in `test.globalSetup`:
 *
 * ```ts
 * // zitadel.global-setup.ts
 * import { zitadelGlobalSetup } from "@zitadel/testing/vitest";
 * export default zitadelGlobalSetup({ appOrigins: ["http://localhost:3000"] });
 * ```
 *
 * Tests read the instance with {@link injectZitadel}.
 */
export function zitadelGlobalSetup(options: ZitadelGlobalSetupOptions = {}): ZitadelGlobalSetup {
  return async (project) => {
    const zitadel = await startLocalZitadel(options);
    // The handle is the cross-process contract (JSON-serializable), which is
    // what provide() requires. The key is not declared on ProvidedContext so
    // the entry adds nothing to the consumer's vitest types.
    (project.provide as (key: string, value: InstanceHandle) => void)(HANDLE_KEY, zitadel.handle);
    return zitadel.stop;
  };
}

/**
 * The run's instance, connected in this test worker: the same `seedUser` /
 * `seedUsers` / `seedSession` / `identity` / `api` surface `connectZitadel`
 * returns. Call it in a test or hook; seed a fresh user per test, since every
 * test file shares the one instance.
 */
export function injectZitadel(): ConnectedZitadel {
  const handle = (inject as (key: string) => InstanceHandle | undefined)(HANDLE_KEY);
  if (!handle) {
    throw new Error(
      "injectZitadel() found no instance. Add a globalSetup module that default-exports " +
        "zitadelGlobalSetup() to the Vitest config's `test.globalSetup` " +
        "(see the @zitadel/testing README).",
    );
  }
  return connectZitadel(handle);
}

export { identity } from "./seed";
export { browserSessionCookieName, SESSION_COOKIE_NAME, sessionCookieName } from "./session";
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
