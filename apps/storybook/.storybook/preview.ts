import { configureZitadel } from "@zitadel/api/config";
import type { Preview } from "@storybook/web-components-vite";
import { html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";

// Dev-only: make custom-element registration idempotent. The `<zl-*>` atoms run
// from source here, and any module re-execution (Vite dep-optimization reloads,
// Storybook soft re-renders) re-runs Lit's `@customElement` → `define`, which
// throws "already been used with this registry" and breaks the preview. A real
// reload (forced by the workspace-source watcher in `main.ts`) starts from an
// empty registry, so the first `define` wins and picks up the edited source.
// Confined to Storybook so the component library keeps Lit's strict behaviour.
const nativeDefine = customElements.define.bind(customElements);
customElements.define = (name, constructor, options) => {
  if (customElements.get(name)) return;
  nativeDefine(name, constructor, options);
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

// The MSW worker unregisters itself when its last client closes. A page opened
// while that is settling re-registers the same, already active worker: no
// `activate` fires, so nothing claims the page, and its requests reach the dev
// server (`POST /flow` answers 404). MSW reloads an uncontrolled page only when
// it can already see the registration, which it cannot at that moment. Apply
// the same remedy once the worker has started; the flag stops a reload loop if
// the page stays uncontrolled.
const RELOADED_FOR_CONTROL = "zitadel-storybook:msw-control-reload";
const startWorker = async () => {
  const worker = setupWorker();
  await worker.start({ onUnhandledRequest: "bypass" });
  if (navigator.serviceWorker.controller) {
    sessionStorage.removeItem(RELOADED_FOR_CONTROL);
  } else if (!sessionStorage.getItem(RELOADED_FOR_CONTROL)) {
    sessionStorage.setItem(RELOADED_FOR_CONTROL, "1");
    location.reload();
    await new Promise(() => {
      // Never settles: the reload replaces this page before a story renders.
    });
  }
  return worker;
};

const preview: Preview = {
  loaders: [mswLoader(startWorker)],
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
