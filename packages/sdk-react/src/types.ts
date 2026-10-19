import type * as React from "react";

/**
 * Re-exports the shared SPA widget types from `@zitadel/sdk-core`.
 *
 * `export type *` keeps this surface in lockstep with the core SPA contract: a
 * type added there is re-exported here automatically, and none can be dropped by
 * hand. The server-middleware types live in a separate core module and stay out
 * of the browser SDK surface.
 */
export type * from "@zitadel/sdk-core/types";

/**
 * The standard HTML attributes a widget wrapper accepts besides its own props
 * (`className`, `style`, `id`, `title`, `slot`, `hidden`, `role`, `tabIndex`,
 * `data-*`, `aria-*`, …), forwarded to the widget element. A widget prop of the
 * same name wins, so those names are left out here rather than merged.
 */
export type ZitadelWidgetAttributes<Element extends HTMLElement, Own> = Omit<
  React.HTMLAttributes<Element>,
  keyof Own | "children"
>;
