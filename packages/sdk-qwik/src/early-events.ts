/**
 * Holds the few `zitadel-*` events a Qwik wrapper's callbacks must not miss,
 * from the moment this module loads until the wrapper attaches its listeners.
 *
 * Under SSR (Qwik Router) the wrapper's listeners are wired by a
 * `useVisibleTask$`, which runs only after the bundle has loaded and the widget
 * has upgraded, because Qwik resumes the server markup instead of re-running
 * the `ref` binder. A widget that boots from `resume-flow-id` can reach a
 * terminal step before that task runs and emit `zitadel-flow-complete` into the
 * void, so a host that exchanges the handoff token in `onFlowComplete$` never
 * sees it. The widgets' events bubble and are composed, so one document
 * listener, installed before `@zitadel/components` registers the elements,
 * sees them first and {@link listenWithReplay} replays what the element emitted
 * before its own listeners existed.
 *
 * This is deliberately narrow, because the listener sees the whole page:
 * - Only hosts carrying {@link WRAPPER_MARKER}, which the wrappers render and a
 *   raw `<zitadel-login>` does not, are buffered. A raw widget never drains its
 *   queue, so anything kept for it would be retained for as long as it lives.
 * - Only the terminal events are buffered. `zitadel-flow-input` carries the
 *   field name and its value, passwords included, and `zitadel-flow-step` is
 *   superseded by the next step, so neither is ever stored.
 * - At most {@link MAX_HELD} events are kept per host, dropping the oldest, and
 *   they are held in a `WeakMap` keyed by the host, so they are released with it
 *   if no wrapper ever attaches, and dropped for good once one does.
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
 * Attaches `listener` for each event name on `el`, first replaying the events
 * the element emitted before this call, in order. Returns the cleanup that
 * removes the listeners.
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
