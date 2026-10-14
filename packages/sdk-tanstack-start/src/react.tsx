"use client";

/**
 * React components for the Zitadel auth widgets — `@zitadel/sdk-react`'s, so a
 * TanStack Start app gets exactly the wrappers a React app does (every event,
 * `children` slots, the session card) and the two can never drift apart.
 *
 * They wrap the Lit web components from `@zitadel/components` with
 * `@lit/react`: the SDK `project` handle is bound as a DOM property and the
 * widget's `zitadel-*` events surface as typed callbacks. On the server they
 * render the inert element tag, which upgrades in the browser; the widget
 * starts its flow from config React applies after hydration.
 */
export { ZitadelLogin, ZitadelLogout, ZitadelSession } from "@zitadel/sdk-react";
export type { ZitadelLoginReactProps } from "@zitadel/sdk-react";
