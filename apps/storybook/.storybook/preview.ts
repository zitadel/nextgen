import { configureZitadel } from "@zitadel/api/config";
import type { Preview } from "@storybook/web-components-vite";
import { html } from "lit";

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
  decorators: [(story) => html`<div class="sb-canvas">${story()}</div>`],
};

export default preview;
