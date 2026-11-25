import type { StandardAttributeProps } from "@zitadel/sdk-core/types";
import type { HTMLAttributes } from "vue";

// The public set is named one by one on purpose: a barrel would also forward
// the core's internals (widget tag tables, event-name constants, event maps),
// and the server-middleware types live in a separate core module that stays out
// of the browser SDK surface.
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
 * the widget element. `class` and `style` are left out, since Vue types them on
 * every component. `data-*` is not declared: a prop pattern like that breaks
 * Vue's own overloads, and a template accepts a `data-*` attribute anyway
 * (`strictTemplates` is the exception, and rejects it).
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  Omit<HTMLAttributes, "class" | "style"> & {
    /** The named slot of a parent custom element that the widget element is assigned to. */
    slot?: string;
  }
>;

/**
 * A widget component's type with {@link ZitadelWidgetAttributes} added to its props.
 *
 * The wrappers declare only their own props and take the standard HTML
 * attributes through `attrs`, so Vue's type checker would not know them. This
 * adds them to the constructor's `$props` without touching the component's
 * runtime shape, so a template can write `class`, `id` or `aria-label` on a
 * widget and still type-check.
 *
 * @typeParam Component - The component constructor type to extend.
 */
export type WithZitadelWidgetAttributes<Component extends AbstractWidgetConstructor> = Component &
  WidgetAttributesConstructor;

/**
 * Any component constructor, abstract or not, which is what Vue's
 * `defineComponent` returns for a component type.
 */
export type AbstractWidgetConstructor = abstract new () => object;

/** A constructor whose instances carry {@link ZitadelWidgetAttributes} as `$props`. */
export interface WidgetAttributesConstructor {
  /**
   * Builds the instance shape that Vue's type checker reads `$props` from.
   *
   * @returns An object whose `$props` hold the standard HTML attributes a
   * template may set on the widget element.
   */
  new (): {
    /** The standard HTML attributes a template may set on the widget element. */
    $props: ZitadelWidgetAttributes;
  };
}
