import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

import { ZitadelLogin } from "../index";

declare global {
  interface Window {
    __unsetResumeFlowId?: () => void;
  }
}

/**
 * Drives `resumeFlowId` from a handle back to unset. Lives outside the spec for
 * the same reason as the password toggle harness: Qwik loads a component's QRL
 * by importing its module, and the change is exposed on `window` because this
 * suite runs without the qwikloader.
 */
export const ResumeFlowIdHarness = component$(() => {
  const handle = useSignal<string | undefined>("flow_123");
  // biome-ignore lint/correctness/noQwikUseVisibleTask: the test needs a hook into the signal from outside the component.
  useVisibleTask$(
    () => {
      window.__unsetResumeFlowId = () => {
        handle.value = undefined;
      };
    },
    { strategy: "document-ready" },
  );
  return (
    <ZitadelLogin
      project={{ projectId: "proj-test", proxyPath: "/__nextgen" }}
      resumeFlowId={handle.value}
    />
  );
});
