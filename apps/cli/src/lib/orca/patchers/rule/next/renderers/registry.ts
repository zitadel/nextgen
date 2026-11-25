import { OrcaRendererPendingError, OrcaRendererUnknownError } from "@/lib/orca/errors";
import { litRenderer } from "./lit";
import { reactRenderer } from "./react";
import type { RendererId, RendererSpec } from "./types";

/**
 * Runtime mirror of the {@link RendererId} union, used by {@link isRendererId}
 * to validate untrusted strings (a TS union has no runtime presence). Must stay
 * in sync with the {@link RendererId} type.
 */
export const RENDERER_IDS: RendererId[] = ["react", "web-component"];

/**
 * Type guard narrowing an arbitrary value to a {@link RendererId}, used to
 * validate renderer ids read from config before indexing {@link RENDERERS}.
 */
export function isRendererId(value: unknown): value is RendererId {
  return typeof value === "string" && (RENDERER_IDS as string[]).includes(value);
}

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
 * The subset of {@link RENDERER_IDS} that {@link getRenderer} resolves rather
 * than rejects (`status: "available"`). Anything advertising renderer choices
 * — flag options, error hints — must derive from this list, not
 * {@link RENDERER_IDS}: a declared-but-unpublished renderer (ADR 006) keeps
 * its registry entry to reserve the id, but must never be offered as a usable
 * value.
 */
export const AVAILABLE_RENDERER_IDS: RendererId[] = RENDERER_IDS.filter((id) => {
  return RENDERERS[id].status === "available";
});

/**
 * Resolves a renderer id (an untrusted string from config) to its spec,
 * throwing a typed {@link OrcaRendererUnknownError} or
 * {@link OrcaRendererPendingError} rather than returning `undefined` so callers
 * get an actionable message. Rejects unknown ids and declared but unpublished
 * ids, guaranteeing the returned spec is safe to scaffold from.
 */
export function getRenderer(id: string): RendererSpec {
  if (!isRendererId(id)) {
    throw new OrcaRendererUnknownError(`Unknown renderer "${id}"`, {
      hint: `Available renderers: ${AVAILABLE_RENDERER_IDS.join(", ")}.`,
      details: { id, available: AVAILABLE_RENDERER_IDS },
    });
  }
  const renderer = RENDERERS[id];
  if (renderer.status === "not-implemented") {
    throw new OrcaRendererPendingError(`Renderer "${id}" is declared but not yet published`, {
      hint: `Available renderers: ${AVAILABLE_RENDERER_IDS.join(", ")}; the <zitadel-flow> web component ships in a later package.`,
      details: { id, available: AVAILABLE_RENDERER_IDS },
    });
  }
  return renderer;
}
