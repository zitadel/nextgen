import type { Plugin } from "vite";

/**
 * `vite-plugin-web-components-hmr` handles Lit `.ts` updates. Inlined `?inline`
 * CSS from sibling packages does not invalidate atom modules when only `.css`
 * changes — force a full reload for those paths.
 */
const RELOAD_IF_PATH_INCLUDES = [
  "/packages/shared-component-styles/",
  "/packages/design-tokens/",
  "/packages/components/dev/playground-chrome.css",
  "/packages/components/dev/pages/",
] as const;

export function workspaceStylesFullReload(): Plugin {
  return {
    name: "workspace-styles-full-reload",
    apply: "serve",
    handleHotUpdate({ file, server }) {
      const normalized = file.replaceAll("\\", "/");
      if (RELOAD_IF_PATH_INCLUDES.some((fragment) => normalized.includes(fragment))) {
        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
    },
  };
}
