import type {
  StandardAttributeProps,
  ZitadelLoginProps as ZitadelLoginWidgetProps,
  ZitadelLogoutProps as ZitadelLogoutWidgetProps,
  ZitadelSessionProps as ZitadelSessionWidgetProps,
} from "@zitadel/sdk-core/types";
import type { HTMLAttributes } from "svelte/elements";

/**
 * The shared SPA widget types, re-exported by name from `@zitadel/sdk-core`.
 *
 * The list is explicit so the package's public surface is exactly what is named
 * here: the config and handler layers, the event-name constants, the event maps
 * and the standard-attribute helpers of the core stay internal. The server-middleware types live in a
 * separate core module and stay out of the browser SDK surface.
 */
export type {
  ZitadelFlowPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/**
 * The standard HTML attributes a widget wrapper accepts besides its own props,
 * and nothing else, so no prop the type accepts is dropped.
 *
 * These are `class`, `style`, `id`, `title`, `slot`, `hidden`, `role`,
 * `tabindex`, `data-*` and `aria-*`. The wrapper passes them to the widget
 * element, so a page can position, style and label the widget without an extra
 * wrapper element. Any other prop is ignored. A Svelte quirk applies: removing
 * the `title` prop leaves `title="null"` on the element, because Svelte assigns
 * it as a property.
 */
type ZitadelWidgetAttributes = StandardAttributeProps<HTMLAttributes<HTMLElement>>;

/**
 * Props of {@link ZitadelLogin}: the widget's own props and event callbacks
 * plus the standard HTML attributes.
 *
 * Every widget prop is optional; one that is unset keeps the widget's own
 * default.
 */
export type ZitadelLoginProps = ZitadelLoginWidgetProps & ZitadelWidgetAttributes;

/**
 * Props of {@link ZitadelLogout}: the widget's own props and event callback
 * plus the standard HTML attributes.
 *
 * Every widget prop is optional; one that is unset keeps the widget's own
 * default.
 */
export type ZitadelLogoutProps = ZitadelLogoutWidgetProps & ZitadelWidgetAttributes;

/**
 * Props of {@link ZitadelSession}: the widget's own props and event callback
 * plus the standard HTML attributes.
 *
 * Every widget prop is optional; one that is unset keeps the widget's own
 * default.
 */
export type ZitadelSessionProps = ZitadelSessionWidgetProps & ZitadelWidgetAttributes;
