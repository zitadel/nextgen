import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** What the browser brought back to the loopback redirect. */
export type Callback =
  | Readonly<{ ok: true; code: string; iss?: string }>
  | Readonly<{ ok: false; error: string; description?: string }>;

/** A loopback listener waiting for one authorization response. */
export type Loopback = Readonly<{
  /** `http://127.0.0.1:<port>/callback`, the redirect URI to send. */
  redirectUri: string;
  /** Settles with the first callback whose `state` matches. */
  callback: Promise<Callback>;
  close: () => void;
}>;

const CALLBACK_PATH = "/callback";

/**
 * Listens on a free loopback port for the authorization server's redirect, as
 * a native app does (RFC 8252 §7.3): the IP literal, not `localhost`, so no
 * resolver or other interface can intercept it, and any port, which the
 * server matches against the CLI's registered `http://127.0.0.1/callback`.
 *
 * A request with another `state` is answered and ignored: only the browser
 * this run sent can finish it.
 */
export async function listenForCallback(state: string): Promise<Loopback> {
  let settle!: (callback: Callback) => void;
  const callback = new Promise<Callback>((resolve) => {
    settle = resolve;
  });
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get("state") !== state) {
      page(
        response,
        400,
        "This sign-in link is not for this terminal. Start again with zitadel login.",
      );
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error !== null || code === null) {
      page(
        response,
        400,
        "Sign-in did not complete. You can close this tab and check the terminal.",
      );
      settle({
        ok: false,
        error: error ?? "invalid_request",
        ...(url.searchParams.get("error_description") === null
          ? {}
          : { description: url.searchParams.get("error_description") ?? "" }),
      });
      return;
    }
    page(response, 200, "Signed in. You can close this tab and return to the terminal.");
    const iss = url.searchParams.get("iss");
    settle({ ok: true, code, ...(iss === null ? {} : { iss }) });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    callback,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function page(response: import("node:http").ServerResponse, status: number, message: string): void {
  response
    .writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
    })
    .end(
      `<!doctype html><meta charset="utf-8"><title>Zitadel CLI</title><p style="font:16px system-ui;margin:3rem">${message}</p>`,
    );
}
