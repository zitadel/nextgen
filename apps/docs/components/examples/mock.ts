// The Flow API the live examples' <zitadel-login> talks to: the handlers of
// @zitadel/api-mock in MSW's service worker, the same mock the storybook's
// orchestrator stories run on. Nothing a reader types leaves the page.

/**
 * The API path the examples' logins call. It lies under /docs, so a call the
 * worker misses answers 404 from the docs instead of reaching a server.
 */
export const MOCK_API = "/docs/mock-api";

// Served by app/docs/mock-service-worker.js. Under /docs/ the worker's scope
// stays inside the docs, so it never answers for the console on the cloud's
// host.
const WORKER = "/docs/mock-service-worker.js";
const RELOADED_FOR_CONTROL = "zitadel-docs:mock-control-reload";

let started: Promise<void> | undefined;

/** Starts the mock once per page, for whichever example needs it first. */
export function startMock(): Promise<void> {
  started ??= start();
  return started;
}

async function start() {
  const [{ setupWorker }, { http, passthrough }, { setupMockHandlers }] = await Promise.all([
    import("msw/browser"),
    import("msw"),
    import("@zitadel/api-mock"),
  ]);
  const worker = setupWorker(
    // The worker's scope limits which pages it controls, not which URLs
    // those pages fetch. The shared handlers match any API base, so keep
    // the playground's real API calls out of them after client navigation.
    http.all("*", ({ request }) => {
      const url = new URL(request.url);
      if (url.origin !== location.origin || !url.pathname.startsWith(`${MOCK_API}/`)) {
        return passthrough();
      }
      return undefined;
    }),
    ...setupMockHandlers().handlers,
  );
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
    serviceWorker: { url: WORKER, options: { scope: "/docs/" } },
  });

  // MSW's worker unregisters itself when its last page closes. A page opened
  // while that settles registers the same, still active worker, which then
  // claims nothing, and the login's calls would reach the docs. The storybook
  // meets the same (apps/storybook/.storybook/preview.ts) and reloads once;
  // the flag stops a loop if the page stays uncontrolled.
  if (navigator.serviceWorker.controller) {
    sessionStorage.removeItem(RELOADED_FOR_CONTROL);
  } else if (!sessionStorage.getItem(RELOADED_FOR_CONTROL)) {
    sessionStorage.setItem(RELOADED_FOR_CONTROL, "1");
    location.reload();
    await new Promise(() => {
      // Never settles: the reload replaces the page before the login starts.
    });
  }
}
