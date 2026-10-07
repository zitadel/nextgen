/**
 * The lifecycle shared by the `msw/node` (`./vitest`) and `msw/browser`
 * (`./vitest-browser`) harnesses. Each entry supplies only how its MSW
 * substrate starts, swaps handlers, and stops.
 */
import type { RequestHandler } from "msw";

import { afterAll, beforeAll, beforeEach } from "vitest";

import { clearBranding } from "./branding.js";
import { setupMockHandlers, type MockHandle } from "./handlers.js";
import { clearSsoProviders } from "./sso-providers.js";

export interface MockFlowApi {
  /** The handle serving the current test: its flow actor and captured requests. */
  readonly current: MockHandle;
}

export interface MockSubstrate {
  start(): unknown;
  use(handlers: RequestHandler[]): void;
  stop(): unknown;
}

/**
 * Registers the suite hooks: the substrate starts once, every test gets a
 * fresh handler set (so a widget mounted by one test never sees flow state,
 * branding, or SSO providers left by another), and the substrate stops after
 * the last test. Handlers are swapped before a test rather than cleared after
 * it, so a request a widget sends while being unmounted is still answered.
 */
export function registerMockFlowApi(
  create: (handlers: RequestHandler[]) => MockSubstrate,
): MockFlowApi {
  let handle = setupMockHandlers();
  const substrate = create(handle.handlers);

  beforeAll(async () => {
    await substrate.start();
  });

  beforeEach(() => {
    handle = setupMockHandlers();
    substrate.use(handle.handlers);
    clearBranding();
    clearSsoProviders();
  });

  afterAll(async () => {
    await substrate.stop();
  });

  return {
    get current() {
      return handle;
    },
  };
}
