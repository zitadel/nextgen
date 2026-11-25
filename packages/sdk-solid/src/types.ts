import type { StandardAttributeProps } from "@zitadel/sdk-core/types";
import type { JSX } from "solid-js";

/**
 * The shared widget event and flow types from `@zitadel/sdk-core`, re-exported by name.
 *
 * The list is explicit so that the public surface is exactly what is documented: the internal
 * helpers of the core (widget tag names, standard-attribute tables, event-name constants) are
 * never forwarded. The server-middleware types live in a separate core module and stay out of
 * the browser SDK surface.
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
 * The standard HTML attributes a widget wrapper accepts besides its own props.
 *
 * Use them to position, style and label a widget without a wrapper element, for example `class`,
 * `style`, `id`, `title`, `role`, `tabindex`, `data-*` and `aria-*`. Nothing else is accepted, so
 * no prop the type allows is dropped. The attributes are passed to the widget element with Solid's
 * `attr:` prefix.
 *
 * @example
 * ```tsx
 * <ZitadelLogin project={project} class="auth-card" aria-label="Sign in" />;
 * ```
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<JSX.HTMLAttributes<HTMLElement>>;
