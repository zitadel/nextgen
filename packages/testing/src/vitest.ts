// Peer floor `vitest >=4.0`: Vitest 3.2.4 reads worker state when `vitest` is
// imported, so this entry would throw inside global setup; 4.0.0 made it lazy.
import { inject } from "vitest";
import type { TestProject } from "vitest/node";

import { connectZitadel, startLocalZitadel, type StartLocalZitadelOptions } from "./index";
import { stopLocalServerSync } from "./lifecycle";
import type { ConnectedZitadel, InstanceHandle } from "./types";

/**
 * The `provide`/`inject` key the global setup hands the handle over under.
 * Not exported: `injectZitadel()` is the only reader, so the key can change
 * without breaking a consumer.
 */
const HANDLE_KEY = "@zitadel/testing:handle";

const LOG = "[zitadel-testing]";
const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Boot options for the instance: exactly what `startLocalZitadel` takes.
 */
export type ZitadelGlobalSetupOptions = StartLocalZitadelOptions;

/**
 * Vitest global setup that boots a local instance with
 * `startLocalZitadel(options)`, provides its serializable handle to the test
 * files, and stops it when the run ends or is interrupted (SIGINT, SIGTERM).
 * Vitest runs a global setup once per project that lists it, so list it in
 * one place. Default-export its result from the module the config names in
 * `test.globalSetup`:
 *
 * ```ts
 * // zitadel.global-setup.ts
 * import { zitadelGlobalSetup } from "@zitadel/testing/vitest";
 * export default zitadelGlobalSetup({ appOrigins: ["http://localhost:3000"] });
 * ```
 *
 * Tests read the instance with {@link injectZitadel}.
 */
export function zitadelGlobalSetup(
  options: ZitadelGlobalSetupOptions = {},
): (project: TestProject) => Promise<() => Promise<void>> {
  return async (project) => {
    // Whether something else already ends the process on each signal (the
    // Vitest CLI does). Read before adding ours, which would otherwise turn
    // off Node's default exit for that signal.
    const othersExit = new Map(
      SIGNALS.map((signal) => [signal, process.listenerCount(signal) > 0]),
    );
    const zitadel = await startLocalZitadel(options);

    // `vitest run` skips global teardown on SIGINT and SIGTERM and exits a
    // tick after the signal, so an awaited stop never finishes and the
    // detached server would outlive the run. Stop it synchronously instead,
    // as the Playwright supervisor stops its instance on the same signals.
    const onSignal = (signal: NodeJS.Signals): void => {
      removeHandlers();
      try {
        stopLocalServerSync(zitadel.runtime.dir, options);
      } catch (error) {
        console.error(
          `${LOG} ${signal} received; stopping the instance failed: ` +
            `${error instanceof Error ? error.message : String(error)}\n` +
            `${LOG} \`zitadel stop --all\` stops every instance the CLI started.`,
        );
      }
      if (!othersExit.get(signal as (typeof SIGNALS)[number])) {
        // Nobody else ends the process: restore Node's default for the signal.
        process.kill(process.pid, signal);
      }
    };
    const removeHandlers = (): void => {
      for (const signal of SIGNALS) {
        process.off(signal, onSignal);
      }
    };
    for (const signal of SIGNALS) {
      process.once(signal, onSignal);
    }

    // The handle is the cross-process contract (JSON-serializable), which is
    // what provide() requires. The key is not declared on ProvidedContext so
    // the entry adds nothing to the consumer's vitest types.
    (project.provide as (key: string, value: InstanceHandle) => void)(HANDLE_KEY, zitadel.handle);
    return async () => {
      removeHandlers();
      await zitadel.stop();
    };
  };
}

/**
 * The instance the global setup provided, connected in this test worker: the
 * same `seedUser` / `seedUsers` / `seedSession` / `identity` / `api` surface
 * `connectZitadel` returns. Call it in a test or hook; seed a fresh user per
 * test, since the test files share the instance.
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
