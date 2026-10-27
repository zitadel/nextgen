/**
 * One row in the local state file: the platform `id` returned at create time
 * and the content `hash` last successfully synced. Both fields are optional so
 * the engine can recover from partial writes. For revisioned resources,
 * `previousId` records the revision the current `id` superseded — the planner
 * uses it to recover flow re-pins when a run died between publishing the
 * revision and rewriting the pinned flows.
 */
export type ResourceEntry = {
  id?: string;
  hash?: string;
  name?: string;
  status?: string;
  previousId?: string;
};

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
 * The persisted contents of `.zitadel/state.json`. Maps each managed file path
 * (relative to the project root) to its sync entry, plus the framework id
 * captured during `zitadel setup` and, since the manifest was introduced, the
 * scaffold manifest of generated app files.
 */
export type ZitadelState = {
  framework: string;
  resources: Record<string, ResourceEntry>;
  scaffold?: ScaffoldManifest;
};
