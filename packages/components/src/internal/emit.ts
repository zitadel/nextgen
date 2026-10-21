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
 * Centralising the dispatch shape keeps every event contract identical and
 * removes the repeated `new CustomEvent(..., { bubbles: true, composed: true,
 * detail })` boilerplate.
 */
export function emit<T = undefined>(
  host: HTMLElement,
  type: string,
  detail?: T,
  options: { readonly composed?: boolean } = {},
): boolean {
  return host.dispatchEvent(
    new CustomEvent<T>(type, {
      bubbles: true,
      composed: options.composed ?? true,
      detail: detail as T,
    }),
  );
}

/** How long a navigating event waits for its listeners' `waitUntil` work before navigating anyway. */
export const LISTENER_WAIT_MS = 2000;

/**
 * Dispatch an event whose element navigates right after, then resolve once the
 * promises its listeners handed to `detail.waitUntil` have settled, or after
 * {@link LISTENER_WAIT_MS}, whichever is first. Resolves immediately when no
 * listener registers, so a synchronous host never waits.
 */
export async function emitThenSettle<T extends object>(
  host: HTMLElement,
  type: string,
  detail: T,
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  emit(host, type, {
    ...detail,
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work);
    },
  });
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
