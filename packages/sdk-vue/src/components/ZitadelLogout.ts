import type { ZitadelProject } from "@zitadel/sdk-core/config";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types.js";
import { forceAttr, proxyPathAttr } from "./forceAttr";

/**
 * The component that {@link ZitadelLogout} is typed from, before the standard HTML attributes are added to
 * its props.
 *
 * Import {@link ZitadelLogout} instead, which has the same runtime value and the complete props type.
 */
const Base = defineComponent({
  name: "ZitadelLogout",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    /**
     * The project handle that the widget signs users out of.
     *
     * Pass the value that {@link configureZitadel} returns. The component binds it as a DOM
     * property, raw and not as Vue's reactive proxy, because the widget compares it by identity.
     * It also writes the handle's fields as the `project-id`, `proxy-path`, `url` and
     * `publishable-key` attributes, so server-rendered markup carries them before hydration. The
     * publishable key is browser-safe by design. It wins over
     * {@link ZitadelLogoutProps.projectId} and {@link ZitadelLogoutProps.proxyPath}.
     *
     * @example
     * ```html
     * <ZitadelLogout :project="project" />
     * ```
     */
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    /**
     * The project id that the widget belongs to.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelLogoutProps.project} is set.
     * The component writes it as the `project-id` attribute, so it reaches server-rendered markup.
     *
     * @example
     * ```html
     * <ZitadelLogout project-id="296547382910273" />
     * ```
     */
    projectId: { type: String, default: undefined },
    /**
     * The same-origin proxy path that the widget calls.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelLogoutProps.project} is set.
     * The component writes it as the `proxy-path` attribute, so it reaches server-rendered markup.
     * The host or dev server of the app must serve the path.
     *
     * @defaultValue "/__nextgen"
     */
    proxyPath: { type: String, default: undefined },
    /**
     * The address to navigate to after a completed sign-out.
     *
     * Unset, the widget uses its own default navigation.
     *
     * @example
     * ```html
     * <ZitadelLogout :project="project" post-sign-out-url="/" />
     * ```
     */
    postSignOutUrl: { type: String, default: undefined },
    /**
     * The color mode of the widget: `"light"`, `"dark"` or `"auto"`.
     *
     * The value `"auto"` follows `prefers-color-scheme`. The component binds it as an attribute, so
     * an unset prop keeps the default of the element and is not turned into an empty string.
     *
     * @defaultValue "auto"
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
  },
  /**
   * The events that the component re-emits from the widget.
   *
   * The `signout` event carries a {@link ZitadelSignoutDetail} when the sign-out completes.
   *
   * A handler may return a promise, but the component emits an event and cannot capture a return
   * value, so nothing waits for it. To delay the navigation, call `waitUntil(promise)` on the
   * event detail inside the handler: the widget then waits for it, for at most two seconds, before
   * it navigates. Only the `signout` detail carries `waitUntil`.
   */
  emits: ["signout"],
  setup(props, { attrs, emit, expose }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLogoutElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes are the only extra props the element takes.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(widgetTags.logout, {
        ...attributes,
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy:
        // the widget does identity checks on it (and `render` from test-utils
        // would otherwise pass a wrapped clone).
        project: toRaw(props.project),
        // Kebab-case attributes are what the element reads at upgrade, and the
        // only form a server-rendered page carries (the camelCase keys below
        // render as `projectid=`-style names the element never reads). The
        // handle's fields are mirrored, and win over the discrete props as they
        // do in the widget's `resolveApi`, so a page that passes only `project`
        // is configured before hydration and both channels agree.
        "project-id": props.project?.projectId ?? props.projectId,
        "proxy-path": proxyPathAttr(props.project?.proxyPath ?? props.proxyPath),
        url: props.project?.url,
        "publishable-key": props.project?.publishableKey,
        projectId: props.projectId,
        proxyPath: proxyPathAttr(props.proxyPath),
        "post-sign-out-url": props.postSignOutUrl || undefined,
        // A string prop with a default is bound as an attribute (the "^" prefix on
        // the client, see `forceAttr`): Vue assigns an unset property as "", which
        // the element cannot tell from an intended empty string, while an unset
        // attribute is simply removed.
        [`${attr}theme`]: props.theme,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit("signout", event.detail);
        },
      });
    };
  },
});

/**
 * Renders the sign-out control, the `<zitadel-logout>` web component, inside a Vue template.
 *
 * Use it in the chrome of the app, such as a header menu, to end the session of the user. It
 * renders the same way as {@link ZitadelLogin}: a render function creates the element by its
 * string tag, so no `compilerOptions.isCustomElement` setting is needed, and the server markup
 * carries the `project-id` and `proxy-path` attributes with nothing inside until hydration.
 *
 * Pass the project handle from {@link configureZitadel} as `project`, or the discrete `project-id`
 * and `proxy-path` props. The widget event is re-emitted with its detail as `signout`. Unset
 * string props are bound as attributes on the client and removed, so the element keeps its own
 * default, and a server render writes plain attributes. The kebab-case attributes are the form the
 * widget reads when it upgrades before Vue hydrates.
 *
 * A Vue `ref` on this component resolves to the component instance and not to the inner element.
 * The rendered element is exposed as `element`, a `Ref` whose value is the `ZitadelLogout` element
 * from `@zitadel/components`, or `null` before mount.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * import { ZitadelLogout, configureZitadel } from "@zitadel/sdk-vue";
 *
 * const project = configureZitadel({ projectId: "296547382910273" });
 * </script>
 *
 * <template>
 *   <ZitadelLogout :project="project" post-sign-out-url="/" @signout="onSignout" />
 * </template>
 * ```
 */
const ZitadelLogout: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelLogout;
