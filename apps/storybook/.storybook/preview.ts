import { configureZitadel } from "@zitadel/api/config";
import type { Preview } from "@storybook/web-components-vite";
import { html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { initialize } from "msw-storybook-addon";

// Dev-only: make custom-element registration idempotent. The `<zl-*>` atoms run
// from source here, and any module re-execution (Vite dep-optimization reloads,
// Storybook soft re-renders) re-runs Lit's `@customElement` → `define`, which
// throws "already been used with this registry" and breaks the preview. A real
// reload (forced by the workspace-source watcher in `main.ts`) starts from an
// empty registry, so the first `define` wins and picks up the edited source.
// Confined to Storybook so the component library keeps Lit's strict behaviour.
const nativeDefine = customElements.define.bind(customElements);
customElements.define = (name, ctor, options) => {
  if (customElements.get(name)) return;
  nativeDefine(name, ctor, options);
};

// Design-system variables on :root so the atoms resolve `var(--zl-*)`.
import "@zitadel/design-tokens/css/tokens.css";
// Side-effect: register every `<zl-*>` atom AND the `<zitadel-login>` orchestrator.
import "@zitadel/components";
// Workbench chrome (dark canvas to match the Figma dark mode).
import "../src/preview.css";

// Point the typed Flow API client at the story origin so the orchestrator's
// MSW mock (wired per-story in orchestrator.stories.ts) has an absolute URL to
// intercept. The host need not resolve — the api-mock handlers match `*/flow*`
// regardless. Harmless for atom stories, which make no requests.
configureZitadel({ proxyPath: window.location.origin, projectId: "storybook" });

// One worker for the whole preview, started before any story module runs.
//
// Not lazily per story file, which is what this used to do: `initialize()`
// builds a worker object, and a second call while mocking is already enabled
// logs "redundant worker.start()" and leaves that second object inert. The
// per-story `mswLoader` then applies the story's handlers to whichever object
// its own module closed over -- and when that is the inert one, nothing is
// intercepted, `onUnhandledRequest: "bypass"` lets the call through to the dev
// server, and the story fails with a 404 from Storybook itself. Crossing from
// a story in one file to a story in another was enough to trigger it.
//
// Starting it here costs the atom stories nothing: a worker with no matching
// handler does not intercept, and the atoms make no requests at all.
initialize({ onUnhandledRequest: "bypass" });

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { expanded: true },
    a11y: { test: "error" },
  },
  // The design system ships a single dark mode (ADR 014); atoms render light
  // text intended for a dark surface. Wrapping every story in the dark canvas
  // (rather than only styling `body.sb-show-main`) means the addon-vitest a11y
  // run sees the intended background, so contrast checks pass. Orchestrator
  // stories use `layout: "fullscreen"` and paint their own branding surface.
  // Key the story subtree so lit-html tears the DOM down and rebuilds it rather
  // than reusing it across renders. The mock-backed stories hold a stateful
  // custom element (`<zitadel-login>` / `<zitadel-session>`); without a fresh
  // element, a flow driven to its terminal "signed-in" step leaks into the next
  // render -- the next story renders blank, or a knob change silently does
  // nothing -- until a full reload.
  //
  // MSW is orchestrator-only here, so `parameters.msw` marks exactly the
  // stateful stories (not matched by title, which is brittle). Those key on the
  // args too, so they also remount when a knob changes, not only when switching
  // stories. Atoms are stateless and key on the story id alone.
  decorators: [
    (story, context) => {
      const key = context.parameters?.msw
        ? `${context.id}:${JSON.stringify(context.args)}`
        : context.id;
      return html`${keyed(key, html`<div class="sb-canvas">${story()}</div>`)}`;
    },
  ],
};

export default preview;
