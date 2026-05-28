import { ZitadelError } from "../../../../../errors";
import { litRenderer } from "./lit";
import { reactRenderer } from "./react";
import { isRendererId, type RendererId, type RendererSpec } from "./types";

/**
 * The single source of truth mapping each {@link RendererId} to its spec.
 * Keyed by id so {@link getRenderer} can look up and validate a renderer
 * chosen from persisted config (an arbitrary string) at runtime.
 */
export const RENDERERS: Record<RendererId, RendererSpec> = {
  react: reactRenderer,
  "web-component": litRenderer,
};

/**
 * Resolves a renderer id (an untrusted string from config) to its spec,
 * throwing a typed {@link ZitadelError} rather than returning `undefined`
 * so callers get an actionable message. Rejects ids that are unknown
 * (`E_VALIDATION`) or declared-but-unpublished (`E_NOT_IMPLEMENTED`),
 * guaranteeing the returned spec is safe to scaffold from.
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
