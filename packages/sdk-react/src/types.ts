import type { ZitadelStandardAttributeProps } from "@zitadel/sdk-core/types";
import type * as React from "react";

/**
 * The standard HTML attributes a widget wrapper accepts besides its own props.
 *
 * They are `className`, `style`, `id`, `title`, `slot`, `hidden`, `role`, `tabIndex`, `data-*` and
 * `aria-*`, and they are passed to the widget element. Use them to position, style and label the
 * widget without an extra wrapper element.
 *
 * Nothing else reaches the element: the type admits only these, so a prop the type accepts is
 * never silently dropped, and any other prop is ignored.
 *
 * @internal
 */
export type ZitadelWidgetAttributes = ZitadelStandardAttributeProps<
  React.HTMLAttributes<HTMLElement>
>;
export const knipProbe = 1;
