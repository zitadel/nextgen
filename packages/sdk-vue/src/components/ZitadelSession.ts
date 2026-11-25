import type { ZitadelProject } from "@zitadel/sdk-core/config";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types.js";
import { forceAttr } from "./forceAttr";

/**
 * The component that {@link ZitadelSession} is typed from, before the standard HTML attributes are added to
 * its props.
 *
 * It is exported only so that the published declaration file can name it. Import
 * {@link ZitadelSession} instead, which has the same runtime value and the complete props type.
 */
export const Base = defineComponent({
  name: "ZitadelSession",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    /**
     * The project handle that the widget signs users out of.
     *
     * Pass the value that {@link configureZitadel} returns. The component binds it as a DOM
     * property, raw and not as Vue's reactive proxy, because the widget compares it by identity.
     * It also writes the handle's fields as the `project-id`, `proxy-path` and `url` attributes, so
     * server-rendered markup carries them before hydration. It wins over
     * {@link ZitadelSessionProps.projectId} and {@link ZitadelSessionProps.proxyPath}.
     *
     * @example
     * ```html
     * <ZitadelSession :project="project" />
     * ```
     */
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    /**
     * The project id that the widget belongs to.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelSessionProps.project} is set.
     * The component writes it as the `project-id` attribute, so it reaches server-rendered markup.
     *
     * @example
     * ```html
     * <ZitadelSession project-id="296547382910273" />
     * ```
     */
    projectId: { type: String, default: undefined },
    /**
     * The same-origin proxy path that the widget calls.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelSessionProps.project} is set.
     * The component writes it as the `proxy-path` attribute, so it reaches server-rendered markup.
     * The host or dev server of the app must serve the path.
     *
     * @defaultValue "/__nextgen"
     */
    proxyPath: { type: String, default: undefined },
    /**
     * The address to navigate to after a completed sign-out.
     *
     * Unset, the widget uses its own default navigation. The widget navigates right after it emits
     * `signout`, so a handler must run synchronously or register its work with the `waitUntil` hook
     * of the event detail, which delays the navigation for at most two seconds.
     *
     * @example
     * ```html
     * <ZitadelSession :project="project" post-sign-out-url="/" />
     * ```
     */
    postSignOutUrl: { type: String, default: undefined },
    /**
     * The text of the heading of the card.
     *
     * Unset, the widget keeps its own text, "Signed in as". The component binds it as an
     * attribute, so an unset prop removes the attribute. Bound as a property, Vue would have
     * rendered an empty heading.
     */
    heading: { type: String, default: undefined },
    /**
     * The label of the sign-out action.
     *
     * Unset, the widget keeps its own label, "Sign out". The component binds it as an attribute,
     * so an unset prop removes the attribute.
     */
    logoutLabel: { type: String, default: undefined },
    /**
     * The layout of the widget: `"widget"` or `"page"`.
     *
     * The `"widget"` layout is sized by its content and paints no page chrome. The `"page"` layout
     * claims the viewport and paints the surface background. The component binds it as an
     * attribute, so an unset prop removes the attribute and the element keeps its default.
     *
     * @defaultValue "widget"
     */
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    /**
     * The color mode of the widget: `"light"`, `"dark"` or `"auto"`.
     *
     * The value `"auto"` follows `prefers-color-scheme`. Unset, the widget follows the default of
     * the {@link ZitadelSessionProps.variant}: `"dark"` for `"page"` and `"auto"` for `"widget"`.
     * The component binds it as an attribute, so an unset prop keeps the default of the element.
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    /**
     * Whether to hide the heading block of the widget visually while keeping it in the accessibility
     * tree.
     *
     * Set it on a page that already carries its own heading. The component binds it as a property.
     * Vue turns an unset boolean into `false`, which is the default, so an unset prop is safe.
     *
     * @defaultValue false
     */
    suppressHeader: { type: Boolean, default: undefined },
  },
  /**
   * The events that the component re-emits from the widget.
   *
   * The `signout` event carries a {@link ZitadelSignoutDetail} when the sign-out completes.
   */
  emits: ["signout"],
  setup(props, { attrs, emit, expose }) {
    const element = ref<ZitadelSessionElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes are the only extra props the element takes.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(widgetTags.session, {
        ...attributes,
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy.
        project: toRaw(props.project),
        // Kebab-case attributes are what the element reads at upgrade, and the
        // only form a server-rendered page carries (the camelCase keys below
        // render as `projectid=`-style names the element never reads). The
        // handle's fields are mirrored, and win over the discrete props as they
        // do in the widget's `resolveApi`, so a page that passes only `project`
        // is configured before hydration and both channels agree.
        "project-id": props.project?.projectId ?? props.projectId,
        "proxy-path": props.project?.proxyPath ?? props.proxyPath,
        url: props.project?.url,
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        "post-sign-out-url": props.postSignOutUrl,
        // A string prop with a default is bound as an attribute (the "^" prefix on
        // the client, see `forceAttr`): Vue assigns an unset property as "", which
        // the element cannot tell from an intended empty string, while an unset
        // attribute is simply removed.
        [`${attr}heading`]: props.heading,
        [`${attr}logout-label`]: props.logoutLabel,
        [`${attr}variant`]: props.variant,
        [`${attr}theme`]: props.theme,
        suppressHeader: props.suppressHeader,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit("signout", event.detail);
        },
      });
    };
  },
});

/**
 * Renders the "signed in as" card, the `<zitadel-session>` web component, inside a Vue template.
 *
 * Use it after sign-in to show who is signed in and to offer the sign-out action. It renders the
 * same way as {@link ZitadelLogin}: a render function creates the element by its string tag, and
 * the server markup carries the `project-id` and `proxy-path` attributes with nothing inside until
 * hydration.
 *
 * Pass the project handle from {@link configureZitadel} as `project`, or the discrete `project-id`
 * and `proxy-path` props. The widget event is re-emitted with its detail as `signout`. Unset
 * string props are bound as attributes on the client and removed, so the element keeps its own
 * default, and a server render writes plain attributes. The kebab-case attributes are the form the
 * widget reads when it upgrades before Vue hydrates.
 *
 * A Vue `ref` on this component resolves to the component instance and not to the inner element.
 * The rendered element is exposed as `element`, a `Ref` whose value is the `ZitadelSession`
 * element from `@zitadel/components`, or `null` before mount.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * import { ZitadelSession, configureZitadel } from "@zitadel/sdk-vue";
 *
 * const project = configureZitadel({ projectId: "296547382910273" });
 * </script>
 *
 * <template>
 *   <ZitadelSession :project="project" heading="Your account" @signout="onSignout" />
 * </template>
 * ```
 */
const ZitadelSession: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelSession;
