import type { ClassList, HTMLElementAttrs } from "@qwik.dev/core";
import type { StandardAttributeProps } from "@zitadel/sdk-core/types";

/**
 * Re-exports the shared event detail types that the `on...$` callbacks receive.
 *
 * The types are re-exported by name from `@zitadel/sdk-core` rather than through a barrel. Naming
 * them keeps the public surface exactly this list, so an internal helper added to the core types
 * never leaks into this package by accident. The server-middleware types live in a separate core
 * module and stay out of the browser SDK surface.
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
 * They are passed to the widget element, and nothing else is, so no prop the type accepts is
 * silently dropped. Use them for attributes such as `id`, `style`, `aria-*` and `data-*`.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  HTMLElementAttrs & {
    /**
     * The CSS classes for the widget element.
     *
     * Accepts any form Qwik's `class` accepts: a string, an array or an object. It is declared
     * here because `class` is the Qwik spelling of the attribute and is not part of the base
     * attribute type.
     *
     * @example
     * ```tsx
     * <ZitadelLogin project={project} class={["card", { wide: true }]} />;
     * ```
     */
    class?: ClassList;
  }
>;
