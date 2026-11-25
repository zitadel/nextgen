/**
 * The ownership classes a scaffolded app file can have.
 *
 * @remarks
 * `infrastructure` files (the request boundary, the provider, the
 * custom-elements declarations) are load-bearing for the auth integration — a
 * missing one fails `doctor`. `presentation` files (the generated pages) are
 * released to the user as a starting point — a missing one only warns.
 */
export const SCAFFOLD_FILE_CLASSES = ["infrastructure", "presentation"] as const;

/**
 * Ownership class of one scaffolded app file, recorded in the scaffold manifest.
 */
export type ScaffoldFileClass = (typeof SCAFFOLD_FILE_CLASSES)[number];

/**
 * The embedding postures of the scaffolded auth/profile pages (ADR 044).
 *
 * @remarks
 * `page` pins the widgets to their full-page chrome — the fresh-scaffold
 * default. `widget` embeds the cards in a layout-neutral wrapper inside the
 * app's own shell — the default when setup meets a pre-existing route-based
 * app (Next, Nuxt).
 */
export const SCAFFOLD_POSTURES = ["page", "widget"] as const;

/**
 * Embedding posture of the scaffolded auth/profile pages (ADR 044).
 *
 * @remarks
 * Recorded in the scaffold manifest so `doctor --fix` restores the posture
 * setup actually emitted; absence restores `page` (every scaffold before this
 * record existed was full-page).
 */
export type ScaffoldPosture = (typeof SCAFFOLD_POSTURES)[number];

/**
 * One scaffolded app file as recorded at `zitadel setup` time: the sha256 of
 * the bytes the CLI wrote (or found already matching), plus its ownership
 * class.
 */
export type ScaffoldFileEntry = {
  readonly hash: string;
  readonly class: ScaffoldFileClass;
};

/**
 * The scaffold manifest: which app files `zitadel setup` actually wrote, so
 * `doctor` can distinguish missing/edited/adopted files without guessing from
 * current templates.
 *
 * @remarks
 * `scaffolded_framework` records whether setup created the app skeleton itself
 * (fresh directory) — repair needs it to know whether the framework home page
 * is CLI-managed. `dev_port` preserves the issuer port for context
 * reconstruction. `posture` records the emitted embedding posture of the
 * auth/profile pages (ADR 044) so restoration reproduces it. Absent on apps
 * scaffolded by older CLI versions; consumers fall back to template-derived
 * expectations.
 */
export type ScaffoldManifest = {
  /**
   * Each file setup wrote, by its project-root-relative posix path.
   */
  readonly files: { readonly [path: string]: ScaffoldFileEntry };
  readonly scaffolded_framework?: boolean;
  readonly dev_port?: number;
  readonly posture?: ScaffoldPosture;
};

/**
 * The persisted contents of `.zitadel/state.json`: the framework id captured
 * during `zitadel setup` and, since the manifest was introduced, the scaffold
 * manifest of generated app files.
 *
 * @remarks
 * Older projects also hold a `resources` section, which nothing writes any
 * more; `publishedIds` in `state.ts` still reads it.
 */
export type ZitadelState = {
  /**
   * The framework setup patched the app for.
   */
  readonly framework: string;

  /**
   * The app files setup wrote, absent on apps set up before it existed.
   */
  readonly scaffold?: ScaffoldManifest;
};

/**
 * `.zitadel/state.json` as read, before any of its sections is checked.
 *
 * @remarks
 * The file is hand-editable and written by every CLI version, so each reader
 * narrows the section it needs ({@link ZitadelState} is what setup writes,
 * not what a read can promise).
 */
export type StoredState = { readonly [section: string]: unknown };
