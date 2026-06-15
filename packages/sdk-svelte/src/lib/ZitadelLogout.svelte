<script lang="ts">
  import '@zitadel/components'; // registers <zitadel-logout>
  import type { ZitadelProject } from '@zitadel/api/config';

  let {
    project,
    postSignOutUrl,
  }: {
    project: ZitadelProject;
    postSignOutUrl?: string;
  } = $props();

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (el) (el as unknown as { project?: ZitadelProject }).project = project;
  });
</script>

<zitadel-logout bind:this={el} post-sign-out-url={postSignOutUrl}></zitadel-logout>
