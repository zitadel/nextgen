<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type { ZitadelSessionProps, ZitadelSignoutDetail } from './types';
  import { assignGiven } from './given';

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
  }: ZitadelSessionProps = $props();

  let el: ZitadelSessionElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-session>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelSessionElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, { heading, logoutLabel, variant, theme, suppressHeader });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const onSignoutEvent = (event: Event): void =>
      onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
    node.addEventListener('zitadel-signout', onSignoutEvent);
    return () => {
      node.removeEventListener('zitadel-signout', onSignoutEvent);
    };
  });
</script>

<zitadel-session
  bind:this={el}
  {project}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-out-url={postSignOutUrl}
></zitadel-session>
