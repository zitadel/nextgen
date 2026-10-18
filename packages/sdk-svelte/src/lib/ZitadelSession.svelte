<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type { ZitadelSessionProps, ZitadelSessionErrorDetail, ZitadelSignoutDetail } from './types';

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
    onSessionError,
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

  // Listeners are bound as event attributes at element creation, before the
  // widget is attached and can start loading. An `$effect` runs only after
  // mount, so it would miss a failure the widget raises the moment it mounts.
  // The handlers read the props when the event fires, so they stay current.
  const handleSignout = (event: Event): void =>
    onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
  const handleSessionError = (event: Event): void =>
    onSessionError?.((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
</script>

<zitadel-session
  bind:this={el}
  onzitadel-signout={handleSignout}
  onzitadel-session-error={handleSessionError}
  {project}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-out-url={postSignOutUrl}
  {heading}
  logout-label={logoutLabel}
  {variant}
  {theme}
  {suppressHeader}
></zitadel-session>
