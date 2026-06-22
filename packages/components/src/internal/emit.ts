/**
 * Dispatch a custom event with the project-wide defaults (`bubbles` +
 * `composed`) so it crosses the shadow boundary and reaches delegated
 * listeners — whether it's an atom's `zl-*` event or the orchestrator's
 * public `zitadel-*` event.
 *
 * Centralising the dispatch shape keeps every event contract identical and
 * removes the repeated `new CustomEvent(..., { bubbles: true, composed: true,
 * detail })` boilerplate.
 */
export function emit<T = undefined>(host: HTMLElement, type: string, detail?: T): boolean {
  return host.dispatchEvent(
    new CustomEvent<T>(type, { bubbles: true, composed: true, detail: detail as T }),
  );
}
