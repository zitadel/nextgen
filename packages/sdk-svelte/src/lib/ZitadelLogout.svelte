<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutProps, ZitadelSignoutDetail } from './types';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    theme,
    onSignout,
  }: ZitadelLogoutProps = $props();

  let el: ZitadelLogoutElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-logout>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLogoutElement | undefined {
    return el;
  }

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const signout = (event: Event): void =>
      onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
    node.addEventListener('zitadel-signout', signout);
    return () => {
      node.removeEventListener('zitadel-signout', signout);
    };
  });
</script>

<zitadel-logout
  bind:this={el}
  {project}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-out-url={postSignOutUrl}
  {theme}
></zitadel-logout>
