/**
 * Ownership class of one scaffolded app file, recorded in the scaffold
 * manifest. `infrastructure` files (the request boundary, the provider, the
 * custom-elements declarations) are load-bearing for the auth integration —
 * a missing one fails `doctor`. `presentation` files (the generated pages)
 * are released to the user as a starting point — a missing one only warns.
 */
export type ScaffoldFileClass = "infrastructure" | "presentation";

/**
 * Embedding posture of the scaffolded auth/profile pages (ADR 044). `page`
 * pins the widgets to their full-page chrome — the fresh-scaffold default.
 * `widget` embeds the cards in a layout-neutral wrapper inside the app's own
 * shell — the default when setup meets a pre-existing route-based app (Next,
 * Nuxt). Recorded in the scaffold manifest so `doctor --fix` restores the
 * posture setup actually emitted; absence restores `page` (every scaffold
 * before this record existed was full-page).
 */
export type ScaffoldPosture = "page" | "widget";

/**
 * One scaffolded app file as recorded at `zitadel setup` time: the sha256 of
 * the bytes the CLI wrote (or found already matching), plus its ownership
 * class. Keys of the containing record are project-root-relative posix paths.
 */
export type ScaffoldFileEntry = {
  hash: string;
  class: ScaffoldFileClass;
};

/**
 * The scaffold manifest: which app files `zitadel setup` actually wrote, so
 * `doctor` can distinguish missing/edited/adopted files without guessing from
 * current templates. `scaffolded_framework` records whether setup created the
 * app skeleton itself (fresh directory) — repair needs it to know whether the
 * framework home page is CLI-managed. `dev_port` preserves the issuer port for
 * context reconstruction. `posture` records the emitted embedding posture of
 * the auth/profile pages (ADR 044) so restoration reproduces it. Absent on
 * apps scaffolded by older CLI versions; consumers fall back to
 * template-derived expectations.
 */
export type ScaffoldManifest = {
  files: Record<string, ScaffoldFileEntry>;
  scaffolded_framework?: boolean;
  dev_port?: number;
  posture?: ScaffoldPosture;
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
  framework: string;

  /**
   * The app files setup wrote, absent on apps set up before it existed.
   */
  scaffold?: ScaffoldManifest;
};
