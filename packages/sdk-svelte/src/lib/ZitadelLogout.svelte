<script lang="ts">
  import '@zitadel/components'; // registers <zitadel-logout>
  import type { ZitadelProject } from '@zitadel/api/config';

  import type { ZitadelSignoutDetail } from './types';

  let {
    project,
    postSignOutUrl,
    onSignout,
  }: {
    project: ZitadelProject;
    postSignOutUrl?: string;
    onSignout?: (detail: ZitadelSignoutDetail) => void;
  } = $props();

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (el) (el as unknown as { project?: ZitadelProject }).project = project;
  });

  $effect(() => {
    if (!el) return;
    const signout = (e: Event) => onSignout?.((e as CustomEvent<ZitadelSignoutDetail>).detail);
    el.addEventListener('zitadel-signout', signout);
    return () => el?.removeEventListener('zitadel-signout', signout);
  });
</script>

<zitadel-logout bind:this={el} post-sign-out-url={postSignOutUrl}></zitadel-logout>
