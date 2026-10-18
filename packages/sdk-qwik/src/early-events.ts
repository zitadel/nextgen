/**
 * Holds the widget's `zitadel-*` events from the moment this module loads until
 * a wrapper attaches its listeners.
 *
 * Under SSR (Qwik Router) the wrapper's listeners are wired by a
 * `useVisibleTask$`, which runs only after the bundle has loaded and the widget
 * has upgraded, because Qwik resumes the server markup instead of re-running
 * the `ref` binder. A widget that boots from `resume-flow-id` can reach a
 * terminal step before that task runs and emit `zitadel-flow-complete` into the
 * void, so a host that exchanges the handoff token in `onFlowComplete$` never
 * sees it. The widgets' events bubble and are composed, so one document
 * listener, installed before `@zitadel/components` registers the elements,
 * sees every one of them first and {@link listenWithReplay} replays what the
 * element emitted before its own listeners existed.
 */
const HELD_EVENTS = [
  "zitadel-flow-step",
  "zitadel-flow-input",
  "zitadel-flow-complete",
  "zitadel-flow-redirect",
  "zitadel-flow-error",
  "zitadel-signout",
] as const;

const held = new WeakMap<EventTarget, Event[]>();
const listening = new WeakSet<EventTarget>();

if (typeof document !== "undefined") {
  for (const name of HELD_EVENTS) {
    document.addEventListener(name, (event) => {
      const target = event.target;
      if (!target || listening.has(target)) {
        return;
      }
      const events = held.get(target) ?? [];
      events.push(event);
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
