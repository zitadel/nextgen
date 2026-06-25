import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Mount a React element into a fresh DOM node and hand the node back to the
 * web-components Storybook renderer (lit-html happily renders a `Node`). This
 * is the bridge that lets the paired React components live in the same
 * web-components Storybook instance as the Lit atoms.
 *
 * Each call creates its own root; Storybook discards the previous node on
 * re-render, so there is no shared root to leak between stories.
 */
export function renderReact(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root: Root = createRoot(container);
  root.render(element);
  return container;
}
