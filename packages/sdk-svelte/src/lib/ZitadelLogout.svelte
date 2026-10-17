<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutProps, ZitadelSessionErrorDetail, ZitadelSignoutDetail } from './types';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    theme,
    onSignout,
    onSessionError,
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
    const sessionError = (event: Event): void =>
      onSessionError?.((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
    node.addEventListener('zitadel-signout', signout);
    node.addEventListener('zitadel-session-error', sessionError);
    return () => {
      node.removeEventListener('zitadel-signout', signout);
      node.removeEventListener('zitadel-session-error', sessionError);
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
