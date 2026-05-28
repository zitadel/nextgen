/**
 * The closed set of renderer identifiers the CLI supports. Persisted into
 * config and matched against {@link RENDERER_IDS} at runtime, so adding a
 * member here requires extending that array too.
 */
export type RendererId = "react" | "web-component";

/**
 * Runtime mirror of {@link RendererId} used by {@link isRendererId} to
 * validate untrusted strings, since a TS union has no runtime presence.
 * Must stay in sync with the {@link RendererId} union.
 */
export const RENDERER_IDS: RendererId[] = ["react", "web-component"];

/**
 * Whether a renderer can actually scaffold (`available`) or is only
 * declared as a placeholder (`not-implemented`); the latter is rejected by
 * `getRenderer` so unpublished renderers fail loudly instead of silently.
 */
export type RendererStatus = "available" | "not-implemented";

/**
 * Output of the `authPage` template: the rendered file `contents` plus the
 * `mode` it was built for, echoed back so callers can branch without
 * re-deriving it.
 */
export type RendererAuthPage = {
  mode: "login" | "register";
  contents: string;
};

/** Output of the optional `profilePage` template: the rendered file contents. */
export type RendererProfilePage = {
  contents: string;
};

/**
 * Output of the optional `customElementsDts` template: the contents of the
 * `custom-elements.d.ts` ambient declaration file that types the renderer's
 * JSX custom elements.
 */
export type RendererCustomElementsDts = {
  contents: string;
};

/**
 * The file-generating templates a renderer exposes. `authPage` is required
 * (every renderer must scaffold login/register); the rest are optional
 * because not all renderers need a provider wrapper, profile page, or JSX
 * type declarations.
 */
export type RendererTemplates = {
  provider?: { filename: string; contents: string };
  authPage(mode: "login" | "register"): RendererAuthPage;
  profilePage?(): RendererProfilePage;
  customElementsDts?(): RendererCustomElementsDts;
};

/**
 * Complete description of a renderer: its identity, the frameworks it
 * supports, the SDK dependency it requires, and the templates that produce
 * scaffolded files. Adapters consume this to build a scaffold plan.
 */
export type RendererSpec = {
  id: RendererId;
  displayName: string;
  status: RendererStatus;
  frameworks: string[];
  dependency: { name: string; version: string };
  templates: RendererTemplates;
};

/**
 * Type guard narrowing an arbitrary value to a {@link RendererId}, used to
 * validate renderer ids read from config before indexing the renderer
 * registry.
 */
export function isRendererId(value: unknown): value is RendererId {
  return typeof value === "string" && (RENDERER_IDS as string[]).includes(value);
}
