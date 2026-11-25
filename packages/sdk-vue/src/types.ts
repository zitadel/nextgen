import type {
  StandardAttributeProps,
  ZitadelLoginProps as CoreLoginProps,
  ZitadelLogoutProps as CoreLogoutProps,
  ZitadelSessionProps as CoreSessionProps,
} from "@zitadel/sdk-core/types";
import type { HTMLAttributes } from "vue";

// The public set is named one by one on purpose: a barrel would also forward
// the core's internals (widget tag tables, event-name constants, event maps),
// and the server-middleware types live in a separate core module that stays out
// of the browser SDK surface.
export type {
  ZitadelFlowPurpose,
  ZitadelFlowStep,
  ZitadelFlowBehavior,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

/**
 * The complete props type of {@link ZitadelLogin}.
 *
 * It combines the widget props that `@zitadel/sdk-core` documents, the `onFlow*` callbacks that
 * are Vue's listeners for the re-emitted events, and the standard HTML attributes.
 */
export type ZitadelLoginProps = CoreLoginProps & ZitadelWidgetAttributes;

/**
 * The complete props type of {@link ZitadelLogout}.
 *
 * It combines the widget props that `@zitadel/sdk-core` documents, the `onSignout` callback and
 * the standard HTML attributes.
 */
export type ZitadelLogoutProps = CoreLogoutProps & ZitadelWidgetAttributes;

/**
 * The complete props type of {@link ZitadelSession}.
 *
 * It combines the widget props that `@zitadel/sdk-core` documents, the `onSignout` callback and
 * the standard HTML attributes.
 */
export type ZitadelSessionProps = CoreSessionProps & ZitadelWidgetAttributes;

/**
 * The standard HTML attributes that a widget component accepts besides its own props.
 *
 * The component passes these attributes to the widget element and nothing else, so no prop that
 * the type accepts is dropped. The `class` and `style` attributes are left out because Vue types
 * them on every component. Event handlers, `srcdoc` and `part` are not forwarded, because the
 * component passes only this allow-list to the element. A `data-*` pattern is not declared because a prop pattern like that
 * breaks Vue's own overloads. A template accepts a `data-*` attribute anyway, except under
 * `strictTemplates`, which rejects it.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  Omit<HTMLAttributes, "class" | "style"> & {
    /**
     * The name of the slot of a parent custom element that the widget element is assigned to.
     */
    slot?: string;
  }
>;

/**
 * A widget component type with {@link ZitadelWidgetAttributes} added to its props.
 *
 * The components declare only their own props and take the standard HTML attributes through
 * `attrs`, so Vue's type checker would not know them. This type adds them to the `$props` of the
 * constructor without changing the runtime shape of the component, so a template can write
 * `class`, `id` or `aria-label` on a widget and still type-check.
 *
 * @typeParam Component - The component constructor type to extend.
 */
export type WithZitadelWidgetAttributes<Component extends AbstractWidgetConstructor> = Component &
  WidgetAttributesConstructor;

/**
 * Any component constructor, abstract or not.
 *
 * It is the constructor type that Vue's `defineComponent` returns for a component.
 */
export type AbstractWidgetConstructor = abstract new () => object;

/**
 * A constructor whose instances carry {@link ZitadelWidgetAttributes} as `$props`.
 */
export interface WidgetAttributesConstructor {
  /**
   * Builds the instance shape that Vue's type checker reads `$props` from.
   *
   * @returns An object whose `$props` hold the standard HTML attributes that a template may set
   * on the widget element.
   */
  new (): {
    /**
     * The standard HTML attributes that a template may set on the widget element.
     */
    $props: ZitadelWidgetAttributes;
  };
}
