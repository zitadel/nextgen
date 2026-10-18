import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../index";

declare global {
  interface Window {
    __unsetProp?: () => void;
  }
}

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

/**
 * Renders one widget with `prop` set to `given`, then lets the spec drive that
 * prop back to unset. Lives outside the spec because Qwik loads a component's
 * QRL by importing its module, and re-importing a spec file would re-run its
 * `describe` calls. The change is exposed on `window` because this suite runs
 * without the qwikloader, so a DOM click never reaches an `onClick$` handler.
 */
export const UnsetPropHarness = component$<{
  widget: "login" | "logout" | "session";
  prop: string;
  given: string | boolean;
}>((props) => {
  const value = useSignal<string | boolean | undefined>(props.given);
  // biome-ignore lint/correctness/noQwikUseVisibleTask: the test needs a hook into the signal from outside the component.
  useVisibleTask$(
    () => {
      window.__unsetProp = () => {
        value.value = undefined;
      };
    },
    { strategy: "document-ready" },
  );
  const given = { [props.prop]: value.value };
  if (props.widget === "login") {
    return <ZitadelLogin project={project} {...given} />;
  }
  if (props.widget === "logout") {
    return <ZitadelLogout project={project} {...given} />;
  }
  return <ZitadelSession project={project} {...given} />;
});
