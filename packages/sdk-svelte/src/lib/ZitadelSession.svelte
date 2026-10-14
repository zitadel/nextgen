<script lang="ts">
  import type { Snippet } from 'svelte';
  import '@zitadel/components';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type {
    ZitadelSessionProps,
    ZitadelSessionErrorDetail,
    ZitadelSessionMissingDetail,
    ZitadelSignoutDetail,
  } from './types';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    heading,
    logoutLabel,
    variant,
    theme,
    suppressHeader,
    onSignout,
    onSessionMissing,
    onSessionError,
    children,
  }: ZitadelSessionProps & { children?: Snippet } = $props();

  let el: ZitadelSessionElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-session>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelSessionElement | undefined {
    return el;
  }

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const onSignoutEvent = (event: Event): void =>
      onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
    const sessionMissing = (event: Event): void =>
      onSessionMissing?.((event as CustomEvent<ZitadelSessionMissingDetail>).detail);
    const sessionError = (event: Event): void =>
      onSessionError?.((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
    node.addEventListener('zitadel-signout', onSignoutEvent);
    node.addEventListener('zitadel-session-missing', sessionMissing);
    node.addEventListener('zitadel-session-error', sessionError);
    return () => {
      node.removeEventListener('zitadel-signout', onSignoutEvent);
      node.removeEventListener('zitadel-session-missing', sessionMissing);
      node.removeEventListener('zitadel-session-error', sessionError);
    };
  });
</script>

<zitadel-session
  bind:this={el}
  {project}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-out-url={postSignOutUrl}
  {heading}
  logout-label={logoutLabel}
  {variant}
  {theme}
  {suppressHeader}
>
  <!-- Light-DOM content for the element (see README). -->
  {@render children?.()}
</zitadel-session>
