import type {
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
} from "@zitadel/sdk-core/types";
import type { HTMLAttributes } from "svelte/elements";

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
 * (`class`, `style`, `id`, `title`, `slot`, `hidden`, `role`, `tabindex`,
 * `data-*`, `aria-*`, …), spread onto the widget element. A widget prop of the
 * same name wins, so those names are left out here rather than merged.
 */
export type ZitadelWidgetAttributes<Own> = Omit<HTMLAttributes<HTMLElement>, keyof Own>;

/** Props of `ZitadelLogin`: the widget's own plus the element's HTML attributes. */
export type ZitadelLoginElementProps = ZitadelLoginProps &
  ZitadelWidgetAttributes<ZitadelLoginProps>;

/** Props of `ZitadelLogout`: the widget's own plus the element's HTML attributes. */
export type ZitadelLogoutElementProps = ZitadelLogoutProps &
  ZitadelWidgetAttributes<ZitadelLogoutProps>;

/** Props of `ZitadelSession`: the widget's own plus the element's HTML attributes. */
export type ZitadelSessionElementProps = ZitadelSessionProps &
  ZitadelWidgetAttributes<ZitadelSessionProps>;
