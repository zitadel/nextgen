import { defineComponent, h, onMounted } from "vue";

/**
 * Vue wrapper for the framework-agnostic `<zitadel-logout>` Lit web component,
 * auto-imported by the `@zitadel/sdk-nuxt` module.
 *
 * See {@link ZitadelLogin} for the rendering strategy: render-function string
 * tag (no `isCustomElement` config), SSR emits the inert element, and the
 * element registry is imported in `onMounted` (browser-only). Config comes from
 * the SDK `globalThis` singleton set by the module's plugin, so no `project`
 * prop is needed.
 */
export default defineComponent({
  name: "ZitadelLogout",
  props: {
    /** URL to navigate to after sign-out. */
    postSignOutUrl: { type: String, default: "" },
  },
  setup(props) {
    onMounted(() => {
      void import("@zitadel/components");
    });
    return () =>
      h("zitadel-logout", {
        "post-sign-out-url": props.postSignOutUrl,
      });
  },
});
