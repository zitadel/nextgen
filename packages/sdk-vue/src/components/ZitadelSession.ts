import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types.js";
import { forceAttr } from "./forceAttr";

/**
 * The un-augmented component that {@link ZitadelSession} is typed from, before the
 * standard HTML attributes are added to its props. It is exported only so the
 * published declaration file can name it; import {@link ZitadelSession} instead.
 */
export const Base = defineComponent({
  name: "ZitadelSession",
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
    /** Heading text override; unset keeps the widget's own ("Signed in as"). */
    heading: { type: String, default: undefined },
    /** Sign-out action label override; unset keeps the widget's own ("Sign out"). */
    logoutLabel: { type: String, default: undefined },
    /**
     * `widget` is content-sized and paints no page chrome; `page` claims the
     * viewport and paints the surface background. Unset keeps the element's
     * default (`widget`). Bound as an attribute so an unset prop is removed.
     */
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    /**
     * Colour mode: `light`, `dark`, or `auto` (follow `prefers-color-scheme`).
     * Unset follows the variant default (`dark` for `page`, `auto` for `widget`). Bound as an attribute so an unset prop keeps the element's default.
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    /**
     * Visually hides the widget's own heading block while keeping it in the
     * accessibility tree, for pages that already carry the heading. Unset keeps
     * the element's default (`false`).
     */
    suppressHeader: { type: Boolean, default: undefined },
  },
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
 * Vue wrapper for the `<zitadel-session>` Lit web component — the post-sign-in
 * "signed in as" card. See {@link ZitadelLogin} for the rendering strategy.
 * Supply the SDK handle from `configureZitadel(...)` as `:project`, or the
 * discrete `:project-id` / `:proxy-path` the widget reads instead. The widget's
 * `zitadel-signout` event is re-emitted with its detail as `signout`.
 *
 * A Vue `ref` on this component resolves to the component *instance*; the
 * rendered `<zitadel-session>` DOM node is exposed as `element`.
 */
const ZitadelSession: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelSession;
