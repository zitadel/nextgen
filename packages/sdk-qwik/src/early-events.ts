/**
 * The attribute that marks a widget element as rendered by a Qwik wrapper.
 *
 * The early event buffer keeps events only for elements that carry it. The wrappers render it and
 * a raw `<zitadel-login>` does not, because a raw widget never drains its queue, so anything kept
 * for it would be retained for as long as it lives. The value is an empty string.
 *
 * ## The early event buffer
 *
 * This module holds the few `zitadel-*` events a wrapper's callbacks must not miss, from the
 * moment it loads until the wrapper attaches its listeners.
 *
 * Under server rendering in Qwik Router the wrapper's listeners are wired by a visible task, which
 * runs only after the bundle has loaded and the widget has upgraded, because Qwik resumes the
 * server markup instead of re-running the `ref` binder. A widget that boots from a resume flow
 * handle can reach a terminal step before that task runs and emit `zitadel-flow-complete` into the
 * void, so a host that exchanges the handoff token in `onFlowComplete$` never sees it. The widgets'
 * events bubble and are composed, so one document listener, installed before `@zitadel/components`
 * registers the elements, sees them first, and {@link listenWithReplay} replays what the element
 * emitted before its own listeners existed. The import order in the entry point is load-bearing:
 * this module must load directly before the components.
 *
 * The buffer is deliberately narrow, because its listener sees the whole page:
 * - Only hosts that carry the marker are buffered.
 * - Only the terminal events are buffered: `zitadel-flow-complete`, `zitadel-flow-redirect`,
 *   `zitadel-flow-error` and `zitadel-signout`. `zitadel-flow-input` carries the field name and
 *   its value, passwords included, and `zitadel-flow-step` is superseded by the next step, so
 *   neither is ever stored.
 * - At most eight events are kept per host, dropping the oldest. They are held in a `WeakMap`
 *   keyed by the host, so they are released with it if no wrapper ever attaches, and dropped for
 *   good once one does.
 *
 * Nothing is buffered on the server, where there is no `document`.
 */
export const WRAPPER_MARKER = "data-zitadel-wrapper";

const HELD_EVENTS = [
  "zitadel-flow-complete",
  "zitadel-flow-redirect",
  "zitadel-flow-error",
  "zitadel-signout",
] as const;

const MAX_HELD = 8;

const held = new WeakMap<EventTarget, Event[]>();
const listening = new WeakSet<EventTarget>();

if (typeof document !== "undefined") {
  for (const name of HELD_EVENTS) {
    document.addEventListener(name, (event) => {
      const target = event.composedPath()[0] ?? event.target;
      if (
        !(target instanceof Element) ||
        !target.hasAttribute(WRAPPER_MARKER) ||
        listening.has(target)
      ) {
        return;
      }
      const events = held.get(target) ?? [];
      events.push(event);
      if (events.length > MAX_HELD) {
        events.shift();
      }
      held.set(target, events);
    });
  }
}

/**
 * Attaches a listener for each event name on an element, first replaying the buffered events the
 * element emitted before this call.
 *
 * Replayed events reach the matching listener in the order they were emitted, then the buffer for
 * the element is dropped and the element stops being buffered. Events without a matching listener
 * are discarded. Call the returned cleanup when the component unmounts or its props change.
 *
 * @param el - The widget element to listen on.
 * @param listeners - The listeners, keyed by event name.
 * @returns A cleanup function that removes the listeners.
 *
 * @example
 * ```ts
 * const stop = listenWithReplay(el, { "zitadel-signout": (event) => onSignout(event) });
 * stop();
 * ```
 */
export function listenWithReplay(
  el: EventTarget,
  listeners: Readonly<Record<string, (event: Event) => void>>,
): () => void {
  const early = held.get(el) ?? [];
  held.delete(el);
  listening.add(el);
  for (const event of early) {
    listeners[event.type]?.(event);
  }
  for (const [name, listener] of Object.entries(listeners)) {
    el.addEventListener(name, listener);
  }
  return () => {
    for (const [name, listener] of Object.entries(listeners)) {
      el.removeEventListener(name, listener);
    }
  };
}
