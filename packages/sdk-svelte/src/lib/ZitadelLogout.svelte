<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutSvelteProps } from './types';
  import { assignGiven } from './given';
  import { withDetail } from './events';
  import { onClient, proxyPathAttr } from './attributes';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    theme,
    onSignout,
    ...rest
  }: ZitadelLogoutSvelteProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

  let el: ZitadelLogoutElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-logout>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLogoutElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, { theme });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const signout = (event: Event): void => {
      withDetail(event, onSignout);
    };
    node.addEventListener('zitadel-signout', signout);
    return () => {
      node.removeEventListener('zitadel-signout', signout);
    };
  });
</script>

<zitadel-logout
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-out-url={postSignOutUrl}
></zitadel-logout>

<!--
  @component
  Renders the sign-out control as a `<zitadel-logout>` custom element.

  Like the other wrappers it writes `projectId` and `proxyPath` as the
  `project-id` and `proxy-path` attributes for server markup, assigns the
  `project` handle as a property in the browser, and forwards the element's
  `zitadel-signout` event to `onSignout`; a promise the callback returns delays
  the post-sign-out navigation for up to two seconds.

  Use it where the app offers a stand-alone sign-out button; use the session
  card when the user's identity should be shown as well. Props are typed by
  {@link ZitadelLogoutSvelteProps}. `getElement()` returns the underlying
  element, or `undefined` before mount, via `bind:this`.

  @example
  <ZitadelLogout {project} postSignOutUrl="/login" />
-->
