import { once } from "node:events";
import { resolve } from "node:path";
import { MessageChannel, Worker } from "node:worker_threads";

import type { BrowserCommand } from "vitest/node";

/** The serializable props a spec renders a server login with. */
export interface ServerLoginProps {
  readonly project: { readonly projectId: string; readonly proxyPath: string };
  readonly purpose?: "login" | "register";
  readonly resumeFlowId?: string;
}

let serverBuild: Promise<Worker> | undefined;

/**
 * The worker holding the login's server build, started on first use. Loading
 * the build is nearly all of a render's cost, so every render reuses it.
 */
function loadedServerBuild(): Promise<Worker> {
  serverBuild ??= (async () => {
    const worker = new Worker(resolve("src/__tests__/server-markup.worker.mjs"));
    // Never keep Vitest from exiting, even if no spec closes the worker.
    worker.unref();
    await once(worker, "message");
    return worker;
  })();
  return serverBuild;
}

/** Loads the login's server build, so a spec can wait for it before its tests start. */
export const loadServerLogin: BrowserCommand<[]> = async () => {
  await loadedServerBuild();
};

/**
 * The HTML Qwik's server renderer sends for a login. The browser project cannot
 * run the server renderer (it needs Node), so a browser-side spec asks Vitest's
 * Node side for it through this command.
 */
export const renderServerLogin: BrowserCommand<[props: ServerLoginProps]> = async (
  _context,
  props,
) => {
  const { port1, port2 } = new MessageChannel();
  (await loadedServerBuild()).postMessage({ props, reply: port2 }, [port2]);
  const [{ html, error }] = await once(port1, "message");
  port1.close();
  if (error) {
    throw error;
  }
  return html;
};

/** Stops the server build's worker, so the next run of a spec loads the source again. */
export const closeServerLogin: BrowserCommand<[]> = async () => {
  const closing = serverBuild;
  serverBuild = undefined;
  await closing?.then(
    (worker) => worker.terminate(),
    () => undefined,
  );
};
