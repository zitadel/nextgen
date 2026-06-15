<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelProject } from '@zitadel/api/config';

  import type { ZitadelLogoutProps, ZitadelSignoutDetail } from './types';

  let { project, postSignOutUrl, onSignout }: ZitadelLogoutProps = $props();

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (el) {
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

<zitadel-logout bind:this={el} post-sign-out-url={postSignOutUrl}></zitadel-logout>
