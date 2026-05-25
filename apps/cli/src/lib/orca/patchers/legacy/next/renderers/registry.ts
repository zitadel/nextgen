import { ZitadelError } from "../../../../../errors";
import { litRenderer } from "./lit";
import { reactRenderer } from "./react";
import { isRendererId, type RendererId, type RendererSpec } from "./types";

export const RENDERERS: Record<RendererId, RendererSpec> = {
  react: reactRenderer,
  "web-component": litRenderer,
};

/**
 * Returns the renderer spec for the given identifier.
 * Throws if the id is unknown or if the renderer is not yet implemented.
 */
export function getRenderer(id: string): RendererSpec {
  if (!isRendererId(id)) {
    throw new ZitadelError("E_VALIDATION", `Unknown renderer "${id}"`, {
      hint: `Available renderers: ${Object.keys(RENDERERS).join(", ")}`,
    });
  }
  const renderer = RENDERERS[id];
  if (renderer.status === "not-implemented") {
    throw new ZitadelError(
      "E_NOT_IMPLEMENTED",
      `Renderer "${id}" is declared but not yet published`,
      {
        hint: "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
      },
    );
  }
  return renderer;
}

/**
 * Returns a summary of all registered renderers for display purposes.
 */
export function listRenderers(): Array<{
  id: RendererId;
  status: string;
  frameworks: string[];
  displayName: string;
}> {
  return Object.values(RENDERERS).map((renderer) => ({
    id: renderer.id,
    status: renderer.status,
    frameworks: renderer.frameworks,
    displayName: renderer.displayName,
  }));
}
