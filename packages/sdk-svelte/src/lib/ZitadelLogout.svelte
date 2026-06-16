<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelProject } from '@zitadel/api/config';

  import type { ZitadelLogoutProps, ZitadelSignoutDetail } from './types';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    onSignout,
  }: ZitadelLogoutProps = $props();

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (!el) {
      return;
    }
    const target = el as unknown as {
      project?: ZitadelProject;
      projectId?: string;
      proxyPath?: string;
    };
    if (project !== undefined) {
      target.project = project;
    }
    if (projectId !== undefined) {
      target.projectId = projectId;
    }
    if (proxyPath !== undefined) {
      target.proxyPath = proxyPath;
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
