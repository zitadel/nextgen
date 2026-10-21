/**
 * Dispatch a custom event with the project-wide defaults (`bubbles` +
 * `composed`) so it crosses the shadow boundary and reaches delegated
 * listeners — whether it's an atom's `zl-*` event or the orchestrator's
 * public `zitadel-*` event.
 *
 * Pass `{ composed: false }` for an event that carries something private to
 * the widget: it still bubbles to listeners in the same shadow tree (the
 * orchestrator's own), but is never seen from the page, capture phase included.
 *
 * With `{ waitForListeners: true }` the detail carries `waitUntil(promise)` and
 * the returned promise settles once the listeners' work has, or after
 * {@link LISTENER_WAIT_MS}; otherwise it resolves at once.
 *
 * Centralising the dispatch shape keeps every event contract identical and
 * removes the repeated `new CustomEvent(..., { bubbles: true, composed: true,
 * detail })` boilerplate.
 */
export async function emit<T extends object = object>(
  host: HTMLElement,
  type: string,
  detail?: T,
  options: { readonly composed?: boolean; readonly waitForListeners?: boolean } = {},
): Promise<void> {
  const pending: unknown[] = [];
  host.dispatchEvent(
    new CustomEvent(type, {
      bubbles: true,
      composed: options.composed ?? true,
      detail: options.waitForListeners
        ? {
            ...detail,
            waitUntil: (work: unknown) => {
              if (work) {
                pending.push(work);
              }
            },
          }
        : detail,
    }),
  );
  if (pending.length === 0) {
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, LISTENER_WAIT_MS);
  });
  await Promise.race([Promise.allSettled(pending), expired]);
  clearTimeout(timeout);
}

/** How long a navigating event waits for its listeners' `waitUntil` work. */
export const LISTENER_WAIT_MS = 2000;
