import type { JSX } from "solid-js";

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
 * (`class`, `classList`, `style`, `id`, `title`, `slot`, `hidden`, `role`,
 * `tabindex`, `data-*`, `aria-*`, …), forwarded to the widget element. A widget
 * prop of the same name wins, so those names are left out here rather than
 * merged.
 */
export type ZitadelWidgetAttributes<Own> = Omit<JSX.HTMLAttributes<HTMLElement>, keyof Own | "ref">;
