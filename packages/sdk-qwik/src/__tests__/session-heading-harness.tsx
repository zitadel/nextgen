import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

import { ZitadelSession } from "../index";

declare global {
  interface Window {
    __unsetSessionLabels?: () => void;
  }
}

/**
 * Drives `heading` and `logoutLabel` from a string back to unset. Lives outside
 * the spec for the same reason as the password toggle harness: Qwik loads a
 * component's QRL by importing its module.
 */
export const SessionHeadingHarness = component$(() => {
  const label = useSignal<string | undefined>("Hi");
  // biome-ignore lint/correctness/noQwikUseVisibleTask: the test needs a hook into the signal from outside the component.
  useVisibleTask$(
    () => {
      window.__unsetSessionLabels = () => {
        label.value = undefined;
      };
    },
    { strategy: "document-ready" },
  );
  return (
    <ZitadelSession
      project={{ projectId: "proj-test", proxyPath: "/__nextgen" }}
      heading={label.value}
      logoutLabel={label.value}
    />
  );
});
