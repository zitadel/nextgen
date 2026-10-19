import type { HTMLAttributes } from "vue";

/** What Vue's `HTMLAttributes` leaves out: `slot`. */
type ExtraAttributes = { slot?: string };

/**
 * A widget component's type with the element's standard HTML attributes added
 * to its props (`id`, `title`, `slot`, `hidden`, `role`, `tabindex`,
 * `aria-*`, …; `class` and `style` Vue already allows, as it does any `data-*`). They are merged onto the
 * rendered widget element, and the widget's own props win over any of the same
 * name, so the widget's declared props are left out of the attribute type.
 */
export type WithZitadelWidgetAttributes<
  Component extends abstract new (
    ...args: never
  ) => { $props: object },
> = Component &
  (new (
    ...args: never
  ) => {
    $props: Omit<HTMLAttributes & ExtraAttributes, keyof InstanceType<Component>["$props"]>;
  });
