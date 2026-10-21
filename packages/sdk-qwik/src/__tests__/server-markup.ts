import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import type { BrowserCommand } from "vitest/node";

/** The serializable props a spec renders a server login with. */
export interface ServerLoginProps {
  readonly project: { readonly projectId: string; readonly proxyPath: string };
  readonly purpose?: "login" | "register";
  readonly resumeFlowId?: string;
}

/**
 * The HTML Qwik's server renderer sends for a login. The browser project cannot
 * run the server renderer (it needs Node), so a browser-side spec asks Vitest's
 * Node side for it through this command.
 */
export const renderServerLogin: BrowserCommand<[props: ServerLoginProps]> = (_context, props) =>
  new Promise<string>((resolveHtml, reject) => {
    const worker = new Worker(resolve("src/__tests__/server-markup.worker.mjs"), {
      workerData: props,
    });
    worker.once("message", (html: string) => {
      resolveHtml(html);
      void worker.terminate();
    });
    worker.once("error", reject);
  });
