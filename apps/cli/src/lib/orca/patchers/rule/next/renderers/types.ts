/**
 * The closed set of renderer identifiers the CLI supports. Persisted into
 * config and validated at runtime by `isRendererId` (in `registry.ts`), so
 * adding a member here requires extending that runtime list too.
 */
export type RendererId = "react" | "web-component";

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
 * Setup-time knobs `authPage` may branch on beyond the login/register mode.
 * `useCase` mirrors `PatchContext.useCase` (`SETUP_USE_CASES` in
 * @zitadel/config): `"business"` overlays work-email copy on the widget's
 * neutral built-in dictionaries; any other value (or absence) keeps them.
 * The field is required-but-optional-valued so every caller must state what
 * it knows — a restoring `doctor --fix` then regenerates the same markup the
 * original setup wrote.
 */
export type RendererAuthPageContext = {
  readonly useCase: string | undefined;
};

/**
 * The file-generating templates a renderer exposes. `authPage` is required
 * (every renderer must scaffold login/register); the rest are optional
 * because not all renderers need a provider wrapper, profile page, or JSX
 * type declarations.
 */
export type RendererTemplates = {
  provider?: { filename: string; contents: string };
  authPage(mode: "login" | "register", context: RendererAuthPageContext): RendererAuthPage;
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
