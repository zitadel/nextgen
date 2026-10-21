/**
 * Forwards a widget event's detail to the app callback, and registers the
 * callback's returned promise — from an async handler or a Qwik QRL — on the
 * detail's `waitUntil`. The three navigating events (flow-complete,
 * flow-redirect, signout) then wait for it before the widget navigates; other
 * events carry no `waitUntil`, so the call is a no-op.
 */
export function withDetail<Detail>(
  event: Event,
  handler: ((detail: Detail) => void | Promise<unknown>) | undefined,
): void {
  if (!(event instanceof CustomEvent) || !handler) {
    return;
  }
  const result = handler(event.detail);
  event.detail.waitUntil?.(result);
}
