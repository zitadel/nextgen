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
 * A widget component's type with the element's standard HTML attributes added
 * to its props (`id`, `title`, `slot`, `hidden`, `role`, `tabindex`, `aria-*`, …;
 * `class` and `style` Vue already allows, as it does any `data-*`). They are
 * merged onto the rendered widget element, and the widget's own props win over
 * any of the same name, so those are left out of the attribute type.
 */
export type WithZitadelWidgetAttributes<
  Component extends abstract new (
    ...args: never
  ) => { $props: object },
> = Component &
  (new (
    ...args: never
  ) => {
    $props: Omit<HTMLAttributes & { slot?: string }, keyof InstanceType<Component>["$props"]>;
  });
