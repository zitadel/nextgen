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
