import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

import { ZitadelLogin } from "../index";

declare global {
  interface Window {
    __unsetSuppressPasswordToggle?: () => void;
    __unsetResumeFlowId?: () => void;
  }
}

/**
 * Harnesses that drive a `ZitadelLogin` prop from a value back to unset. They
 * live outside the spec because Qwik loads a component's QRL by importing its module, and
 * re-importing a spec file would re-run its `describe` calls. Each change is
 * exposed on `window` because this suite runs without the qwikloader, so a
 * DOM click never reaches an `onClick$` handler.
 */
export const PasswordToggleHarness = component$(() => {
  const suppress = useSignal<boolean | undefined>(true);
  // biome-ignore lint/correctness/noQwikUseVisibleTask: the test needs a hook into the signal from outside the component.
  useVisibleTask$(
    () => {
      window.__unsetSuppressPasswordToggle = () => {
        suppress.value = undefined;
      };
    },
    { strategy: "document-ready" },
  );
  return (
    <ZitadelLogin
      project={{ projectId: "proj-test", proxyPath: "/__nextgen" }}
      suppressPasswordToggle={suppress.value}
    />
  );
});

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
