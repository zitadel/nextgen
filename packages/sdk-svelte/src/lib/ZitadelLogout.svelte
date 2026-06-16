<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelProject } from '@zitadel/api/config';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutProps, ZitadelSignoutDetail } from './types';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
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
    if (!el) {
      return;
    }
    if (project !== undefined) {
      (el as unknown as { project?: ZitadelProject }).project = project;
    }
  });

  $effect(() => {
    if (!el) {
      return;
    }
    const signout = (event: Event): void =>
      onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
    el.addEventListener('zitadel-signout', signout);
    return () => {
      el?.removeEventListener('zitadel-signout', signout);
    };
  });
</script>

<zitadel-logout
  bind:this={el}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-out-url={postSignOutUrl}
></zitadel-logout>
