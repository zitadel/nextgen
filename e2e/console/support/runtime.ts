import type { Page, Route } from "@playwright/test";

/**
 * Stubs for the runtime document the console and the hosted sign-in shell boot
 * from (`/console/runtime.json`). Console ADR 0004 §3 keeps three deployment
 * states apart — a server that cannot answer, one with no project yet, and a
 * provisioned one — and a lane can produce at most one of them for real: the
 * smoke lane serves no backend, the embedded lane's instance is provisioned.
 * So the cases for the others stub the endpoint per test.
 *
 * Playwright only, nothing else: the smoke lane builds no test kit.
 */

export const RUNTIME_URL = "**/console/runtime.json";

/** What a reachable server with no project yet answers (ADR 0004 §3, state 2). */
export const AWAITING_SETUP = { mode: "standalone" };

/** A response to fulfill the request with: status, content type, body. */
export type RuntimeAnswer = NonNullable<Parameters<Route["fulfill"]>[0]>;

/** Answers the runtime document with `document`, as JSON. */
export async function serveRuntime(page: Page, document: object): Promise<void> {
  await answerRuntime(page, json(document));
}

/** Answers the runtime document with `answer`, whatever it is. */
export async function answerRuntime(page: Page, answer: RuntimeAnswer): Promise<void> {
  await page.route(RUNTIME_URL, (route) => route.fulfill(answer));
}

/** Fails the runtime document's request at the network level: an unreachable server. */
export async function dropRuntime(page: Page): Promise<void> {
  await page.route(RUNTIME_URL, (route) => route.abort("failed"));
}

/**
 * Answers the runtime document with `failure` until the returned `recover` is
 * called; from then on with `recovered`, or with the real server's document
 * when there is none — for the error states' retry.
 */
export async function breakRuntime(
  page: Page,
  failure: RuntimeAnswer,
  recovered?: object,
): Promise<() => void> {
  let broken = true;
  await page.route(RUNTIME_URL, (route) => {
    if (broken) return route.fulfill(failure);
    return recovered ? route.fulfill(json(recovered)) : route.continue();
  });
  return () => {
    broken = false;
  };
}

function json(document: object): RuntimeAnswer {
  return { status: 200, contentType: "application/json", body: JSON.stringify(document) };
}
