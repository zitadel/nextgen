import type { StandardAttributeProps } from "@zitadel/sdk-core/types";
import type { HTMLAttributes } from "vue";

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
 * The standard HTML attributes a widget wrapper accepts besides its own props,
 * and nothing else, so no prop the type accepts is dropped. They are passed to
 * the widget element. `class` and `style` are left out, since Vue types them on
 * every component. `data-*` is not declared: a prop pattern like that breaks
 * Vue's own overloads, and a template accepts a `data-*` attribute anyway
 * (`strictTemplates` is the exception, and rejects it).
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  Omit<HTMLAttributes, "class" | "style"> & { slot?: string }
>;

/** A widget component's type with {@link ZitadelWidgetAttributes} added to its props. */
export type WithZitadelWidgetAttributes<Component extends abstract new (...args: never) => object> =
  Component &
    (new (
      ...args: never
    ) => {
      $props: ZitadelWidgetAttributes;
    });
