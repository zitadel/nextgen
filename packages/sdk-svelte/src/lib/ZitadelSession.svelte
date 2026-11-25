<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type { ZitadelSessionProps } from './types';
  import { assignGiven } from './given';
  import { withDetail } from './events';
  import { onClient, proxyPathAttr } from './attributes';

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
    ...rest
  }: ZitadelSessionProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

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
    const onSignoutEvent = (event: Event): void => {
      withDetail(event, onSignout);
    };
    node.addEventListener('zitadel-signout', onSignoutEvent);
    return () => {
      node.removeEventListener('zitadel-signout', onSignoutEvent);
    };
  });
</script>

<zitadel-session
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-out-url={postSignOutUrl}
></zitadel-session>

<!--
  @component
  Renders the signed-in session card as a `<zitadel-session>` custom element.

  The card shows who is signed in and offers a sign-out action. Optional props such as `heading`,
  `logoutLabel`, `variant`, `theme` and `suppressHeader` are assigned only when set, so an unset
  prop keeps the element's own default instead of blanking it. `projectId` and `proxyPath` are
  written as the `project-id` and `proxy-path` attributes so server-rendered markup carries them;
  the project handle is assigned as a property in the browser and wins over the plain values when
  both are given. `onSignout` receives the element's `zitadel-signout` event, and a promise it
  returns delays the post-sign-out navigation for up to two seconds.

  Use it to show the current user, for example on a profile or dashboard page. Props are typed by
  {@link ZitadelSessionProps}. `getElement()` returns the underlying element, or `undefined`
  before mount, and is reachable through `bind:this`.

  @example
  <script lang="ts">
    import { ZitadelSession } from '@zitadel/sdk-svelte';
  </script>

  <ZitadelSession {project} postSignOutUrl="/login" />
-->
