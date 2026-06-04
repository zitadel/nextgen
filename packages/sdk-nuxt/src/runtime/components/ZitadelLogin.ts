import { defineComponent, h, onMounted } from 'vue';

/**
 * Vue wrapper for the framework-agnostic `<zitadel-login>` Lit web component,
 * auto-imported by the `@zitadel/sdk-nuxt` module.
 *
 * Uses a render function with a string tag, so Vue never tries to resolve
 * `zitadel-login` as a Vue component — the consumer needs no
 * `vue.compilerOptions.isCustomElement` entry. The tag is rendered on both
 * server and client (SSR emits the inert element); the element-registry import
 * (`@zitadel/components`, which calls `customElements.define`) runs in
 * `onMounted`, i.e. only in the browser, so the client upgrades the tag after
 * hydration.
 *
 * Config (proxy path + project id) is read from the SDK `globalThis` singleton
 * that the module's runtime plugin sets via `configureZitadel()`, so no
 * per-instance `project` prop is required.
 */
export default defineComponent({
  name: 'ZitadelLogin',
  props: {
    /** Flow purpose — `"login"` (default) or `"register"`. */
    purpose: { type: String, default: 'login' },
    /** URL to navigate to after a successful embedded sign-in. */
    postSignInUrl: { type: String, default: '' },
  },
  setup(props) {
    onMounted(() => {
      void import('@zitadel/components');
    });
    return () =>
      h('zitadel-login', {
        purpose: props.purpose,
        'post-sign-in-url': props.postSignInUrl,
      });
  },
});
