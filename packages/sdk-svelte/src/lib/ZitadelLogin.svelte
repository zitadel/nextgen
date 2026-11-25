<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelLogin as ZitadelLoginElement } from '@zitadel/components';

  import type { ZitadelLoginProps } from './types';
  import { assignGiven } from './given';
  import { withDetail } from './events';
  import { onClient, proxyPathAttr } from './attributes';

  let {
    project,
    projectId,
    proxyPath,
    purpose = 'login',
    flowName,
    postSignInUrl,
    forcePostSignInUrl,
    resumeFlowId,
    locales,
    lang,
    variant,
    theme,
    suppressHeader,
    suppressPasswordToggle,
    onFlowStep,
    onFlowInput,
    onFlowComplete,
    onFlowRedirect,
    onFlowError,
    ...rest
  }: ZitadelLoginProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

  let el: ZitadelLoginElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-login>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLoginElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, {
        lang,
        variant,
        theme,
        suppressHeader,
        suppressPasswordToggle,
        forcePostSignInUrl,
      });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const step = (event: Event): void => {
      withDetail(event, onFlowStep);
    };
    const input = (event: Event): void => {
      withDetail(event, onFlowInput);
    };
    const complete = (event: Event): void => {
      withDetail(event, onFlowComplete);
    };
    const redirect = (event: Event): void => {
      withDetail(event, onFlowRedirect);
    };
    const error = (event: Event): void => {
      withDetail(event, onFlowError);
    };
    node.addEventListener('zitadel-flow-step', step);
    node.addEventListener('zitadel-flow-input', input);
    node.addEventListener('zitadel-flow-complete', complete);
    node.addEventListener('zitadel-flow-redirect', redirect);
    node.addEventListener('zitadel-flow-error', error);
    return () => {
      node.removeEventListener('zitadel-flow-step', step);
      node.removeEventListener('zitadel-flow-input', input);
      node.removeEventListener('zitadel-flow-complete', complete);
      node.removeEventListener('zitadel-flow-redirect', redirect);
      node.removeEventListener('zitadel-flow-error', error);
    };
  });
</script>

<zitadel-login
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  {purpose}
  {locales}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-in-url={postSignInUrl}
  resume-flow-id={resumeFlowId}
  flow-name={flowName}
></zitadel-login>

<!--
  @component
  Renders the sign-in or sign-up flow as a `<zitadel-login>` custom element.

  The wrapper is compiled by the application's Svelte build, which is why the package ships its
  source through the `svelte` export condition. It writes `projectId` and `proxyPath` as the
  `project-id` and `proxy-path` attributes, so server-rendered markup already carries the
  configuration, and assigns the project handle as a property only once the browser runs, because
  the handle is not serializable into markup. Pass either the project handle or the two plain
  values; the handle wins when both are given.

  Optional widget props such as `variant`, `theme`, `lang`, `suppressHeader`,
  `suppressPasswordToggle` and `forcePostSignInUrl` are assigned only when set, so an unset prop
  keeps the element's own default instead of overwriting it with `undefined`. The `onFlow*`
  callbacks receive the element's `zitadel-flow-*` events. A promise a callback returns delays the
  navigation that follows the event for up to two seconds, so asynchronous handlers finish before
  the page unloads.

  Use it on the page that signs a visitor in or up. Props are typed by {@link ZitadelLoginProps}.
  `getElement()` returns the underlying element, or `undefined` before mount, and is reachable
  through `bind:this`. The component renders an inert element on the server and becomes
  interactive after hydration.

  @example
  <script lang="ts">
    import { ZitadelLogin } from '@zitadel/sdk-svelte';
  </script>

  <ZitadelLogin {project} purpose="login" postSignInUrl="/" />
-->
