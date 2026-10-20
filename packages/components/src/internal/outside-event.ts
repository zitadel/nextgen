/**
 * Calls `handler` for every `type` event that happens outside `host`, and
 * returns what removes the listeners.
 *
 * It cannot ask `event.composedPath()` whether the host is on the path: when
 * the host sits inside another element's closed shadow root, the path a
 * document listener sees omits it, so every event would read as outside.
 * Instead the host marks the events that reach it, in the capture phase so a
 * handler inside it that stops propagation cannot hide one. The document
 * listener is a capture listener too, so a page handler that stops
 * propagation cannot hide an outside event, and it decides after the dispatch,
 * by which time the host has had its say.
 */
export function onOutsideEvent(host: Element, type: string, handler: () => void): () => void {
  const inside = new WeakSet<Event>();
  const mark = (event: Event): void => {
    inside.add(event);
  };
  const watch = (event: Event): void => {
    setTimeout(() => {
      if (!inside.has(event)) handler();
    });
  };
  host.addEventListener(type, mark, true);
  document.addEventListener(type, watch, true);
  return () => {
    host.removeEventListener(type, mark, true);
    document.removeEventListener(type, watch, true);
  };
}
