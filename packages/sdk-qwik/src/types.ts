import type { ClassList, HTMLElementAttrs } from "@qwik.dev/core";
import type { StandardAttributeProps } from "@zitadel/sdk-core/types";

/**
 * The Qwik wrapper props are built from these shared SPA types, so they are
 * re-exported by name from `@zitadel/sdk-core` rather than through a barrel.
 * Naming them keeps the public surface exactly this list: an internal helper
 * added to the core types never leaks into this package by accident. The
 * server-middleware types live in a separate core module and stay out of the
 * browser SDK surface.
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
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelNavigationDetail,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/**
 * The standard HTML attributes a widget wrapper accepts besides its own props,
 * and nothing else, so no prop the type accepts is dropped. They are passed to
 * the widget element.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  HTMLElementAttrs & {
    /**
     * CSS classes for the widget element, in any form Qwik's `class` accepts
     * (string, array or object). Declared here because `class` is the Qwik
     * spelling of the attribute and is not part of `HTMLElementAttrs`.
     */
    class?: ClassList;
  }
>;
