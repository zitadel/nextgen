import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types.js";
import { forceAttr } from "./forceAttr";

/**
 * The un-augmented component that {@link ZitadelLogout} is typed from, before the
 * standard HTML attributes are added to its props. It is exported only so the
 * published declaration file can name it; import {@link ZitadelLogout} instead.
 */
export const Base = defineComponent({
  name: "ZitadelLogout",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    /**
     * The handle returned by `configureZitadel(...)`. Bound as a DOM property
     * (raw, not Vue's reactive proxy, because the widget does identity checks
     * on it), and its fields are also written as `project-id`, `proxy-path` and
     * `url` attributes so server-rendered markup carries them. Wins over the
     * discrete {@link projectId} and {@link proxyPath} props.
     */
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    /**
     * Project id, read when no {@link project} handle is passed. Written as the
     * `project-id` attribute so it reaches server-rendered markup.
     */
    projectId: { type: String, default: undefined },
    /**
     * Same-origin path prefix the widget calls (the `/__nextgen` proxy when
     * unset). Read when no {@link project} handle is passed, and written as the
     * `proxy-path` attribute so it reaches server-rendered markup.
     */
    proxyPath: { type: String, default: undefined },
    /** Where to navigate after sign-out. Unset leaves navigation to the widget's default. */
    postSignOutUrl: { type: String, default: undefined },
    /**
     * Colour mode: `light`, `dark`, or `auto` (follow `prefers-color-scheme`).
     * Unset defaults to `auto`. Bound as an attribute so an unset prop keeps the element's default.
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
  },
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
        "proxy-path": props.project?.proxyPath ?? props.proxyPath,
        url: props.project?.url,
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        "post-sign-out-url": props.postSignOutUrl,
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
 * Vue wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLogin} for the rendering strategy. Supply the SDK handle from
 * `configureZitadel(...)` as `:project`, or the discrete `:project-id` /
 * `:proxy-path` the widget reads instead — the widget uses whichever is
 * present. The widget's `zitadel-signout` event is re-emitted with its detail
 * as `signout`.
 *
 * A Vue `ref` on this component resolves to the component *instance*, not the
 * inner element, so the rendered `<zitadel-logout>` DOM node is exposed as
 * `element` (a `Ref` whose `.value` is the `ZitadelLogout` element from `@zitadel/components`, or
 * `null` before mount). A consumer with `<ZitadelLogout ref="r" />` reads it via
 * `r.value.element`.
 */
const ZitadelLogout: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelLogout;
