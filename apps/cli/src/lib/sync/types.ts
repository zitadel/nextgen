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

/**
 * The contract each per-resource adapter implements. `directory` is the
 * project-root-relative path the sync loop scans; `mutable` controls whether
 * file-content changes trigger an update or get skipped; `revisioned` opts
 * into "publish a new immutable revision on hash change" instead of update
 * or skip. `revisioned` implies immutability of the previous state on the
 * platform; the previous row keeps existing under a stable id (see ADR 009).
 * Concrete syncers call the orval-generated operations directly; bearer auth
 * and base URL come from `@zitadel/api/runtime/{auth,base-url}` module-globals
 * the command layer sets at boot.
 */
export interface ResourceSyncer {
  readonly kind: string;
  readonly directory: string;
  readonly mutable: boolean;
  readonly revisioned: boolean;
  /**
   * When set, this syncer owns exactly one descriptor file with this
   * basename inside `directory`, and the scan fails (`E_VALIDATION`) on any
   * other `*.json` found there. For a revisioned singleton like branding, a
   * stray descriptor copy would otherwise be treated as one more resource
   * and published as its own revision — last upload wins the live slot.
   */
  readonly singletonFile?: string;
  /**
   * Assert that a single on-disk file body is valid for this resource.
   * Throws `E_VALIDATION` (a `ZitadelError`) on the first invalid input.
   * The sync engine calls this for every file it reads, so a malformed
   * schema or flow fails the run before any platform mutation — `plan`
   * and `apply` both go through here.
   */
  validate(data: object): void;
  /**
   * Create the resource on the platform. `canonical` is the server's
   * stored representation when the response (or a follow-up fetch)
   * provides one; the sync loop writes it back to the local file so
   * repo config matches live state byte-for-byte.
   */
  create(data: object): Promise<{ id: string; canonical?: object }>;
  /** Replace the resource. `canonical` as in {@link create}. */
  update(id: string, data: object): Promise<{ canonical?: object }>;
  delete(id: string): Promise<void>;
  fetch?(id: string): Promise<object>;
  /**
   * Reduce a body to its canonical comparison form: strip server-echoed
   * noise (empty `audience`) and spelled-out meta-schema defaults
   * (`x-editable` et al) so hashing and diff rendering treat semantically
   * identical bodies as identical. Comparison only — never applied to
   * upload payloads or written to files (the server does not materialize
   * the stripped defaults, so dropping them from stored bytes would lose
   * them).
   */
  normalize?(data: object): object;
  /**
   * Reduce a canonical server body to what belongs in the local file
   * during write-back: strip pure transport noise (detail-envelope keys,
   * the empty `audience` echo) and nothing else. Unlike {@link normalize},
   * this must preserve every semantically meaningful field — defaulted or
   * not — because its output becomes the bytes the next apply uploads.
   * Absent means the canonical body is written verbatim.
   */
  normalizeWrite?(data: object): object;
}

/**
 * Counts of the non-`skip` actions in a sync plan, used for the `plan` /
 * `apply --dry-run` JSON payload. Produced by `summarizePlan`.
 */
export type SyncPlanSummary = {
  creates: number;
  updates: number;
  revisions: number;
  deletes: number;
  total: number;
};

/**
 * One unit of work in a sync plan. The engine emits exactly one `SyncAction`
 * per resource file (or per state-only entry, for deletes). Discriminated by
 * `kind`; `oldContent` carries the platform's current value for diff rendering.
 *
 * `revise` is the new-immutable-revision path used by revisioned syncers. The
 * platform assigns a new id per revision; the previous row keeps validating
 * anything it was pinned to. `affectedPaths` names the local files that are
 * currently pinned to `previousId` and would need re-pinning to adopt the
 * new revision (see `.zitadel/flows/README.md`).
 */
/**
 * Present on flow create/update actions whose `user_schema` pins a schema
 * revision that is superseded in the same run (a pending `revise`) or was
 * superseded by an interrupted earlier run. The executor rewrites
 * `user_schema` to the new revision id — `newId` when the revision already
 * exists (crash recovery), otherwise the id minted by this run's revise.
 */
export type FlowRepin = { previousId: string; schemaPath: string; newId?: string };

/**
 * A non-blocking finding from plan-time flow validation (severity
 * `warning` in `@zitadel/config/validate`). Rendered as `# warning:`
 * comment lines in the plan and `consola.warn`ed during apply; never
 * fails the run.
 */
export type SyncActionWarning = { rule: string; message: string };

export type SyncAction =
  | {
      kind: "create";
      path: string;
      syncer: ResourceSyncer;
      content: object;
      hash: string;
      repin?: FlowRepin;
      warnings?: ReadonlyArray<SyncActionWarning>;
    }
  | {
      kind: "update";
      path: string;
      syncer: ResourceSyncer;
      id: string;
      content: object;
      hash: string;
      oldContent: object | null;
      repin?: FlowRepin;
      warnings?: ReadonlyArray<SyncActionWarning>;
    }
  | {
      kind: "revise";
      path: string;
      syncer: ResourceSyncer;
      content: object;
      hash: string;
      previousId: string;
      oldContent: object | null;
      affectedPaths: ReadonlyArray<string>;
    }
  | { kind: "delete"; path: string; syncer: ResourceSyncer; id: string; oldContent: object | null }
  | { kind: "skip"; path: string; reason: "immutable" | "no-change" };
