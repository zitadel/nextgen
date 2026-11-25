import type { StandardAttributeProps } from "@zitadel/sdk-core/types";
import type { JSX } from "solid-js";

/**
 * The shared SPA widget types from `@zitadel/sdk-core`, re-exported by name.
 *
 * The list is explicit so that the package's public surface is exactly what is
 * documented: the core's internal helpers (widget tag names, standard-attribute
 * tables, event-name constants) are never forwarded. The server-middleware
 * types live in a separate core module and stay out of the browser SDK surface.
 */
export type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLoginProps,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelLogoutProps,
  ZitadelNavigationDetail,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/**
 * The standard HTML attributes a widget wrapper accepts besides its own props,
 * and nothing else, so no prop the type accepts is dropped. They are passed to
 * the widget element.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<JSX.HTMLAttributes<HTMLElement>>;
