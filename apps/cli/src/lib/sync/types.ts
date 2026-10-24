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
/**
 * A fetch failure the planner must not degrade into "no diff".
 *
 * Fetching old content is best effort: a resource the server cannot hand back
 * just plans without a before/after, which is right for a timeout, a 404, or an
 * endpoint that does not exist yet. It is wrong for a refusal that exists to
 * protect the developer — a syncer that stopped because the response would have
 * put a credential in the preview must stop the plan, not quietly lose the
 * diff and leave the server's behaviour unreported.
 *
 * Wrapping rather than flagging: the planner cannot otherwise tell this apart
 * from the ordinary failures it is right to swallow, and a `ZitadelError` alone
 * does not say which it is.
 */
export class FatalFetchError extends Error {
  readonly reason: Error;

  constructor(reason: Error) {
    super(reason.message);
    this.name = "FatalFetchError";
    this.reason = reason;
  }
}

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
   * and `apply` both go through here. `path` is the file's project-relative
   * path, for messages that name it.
   */
  validate(data: object, path?: string): void;
  /**
   * Create the resource on the platform, answering with its id. What the
   * server stored is not returned: the sync loop never writes it back, and
   * the local file stays as written.
   */
  create(data: object): Promise<{ id: string }>;
  /**
   * Apply the local body to the tracked resource.
   *
   * `id` in the result is the resource the write actually landed on, for a
   * syncer whose write is addressed by something in the document rather than by
   * the tracked id — a connection is addressed by its `slug`, so editing that
   * slug names a different connection and the server answers with a different
   * id. Reporting it keeps state describing what the server did rather than
   * what the caller assumed. Omit it when the write cannot change identity.
   */
  update(id: string, data: object): Promise<{ id?: string }>;
  delete(id: string): Promise<void>;
  /**
   * `"unsupported"` when the platform cannot delete this resource yet. A file
   * removed locally is then reported by `plan` and `apply` and never sent, and
   * its state entry stays so the report repeats until the file is restored.
   */
  readonly deletion?: "unsupported";
  /**
   * Checks that need the platform, run for every create and update before any
   * mutation, given the file `path`. It answers with the id of the resource a create would revise, when one already holds its identity, so the planner can tell a moved file from a new one. `old` is the stored body of an update (null for a create, or
   * when it could not be read). Throws to stop the plan.
   */
  /** What names a stored resource, for matching a removed file to the resource it kept. */
  identityOf?(stored: object): string | undefined;
  preflight?(
    path: string,
    data: object,
    old: object | null,
  ): Promise<{ id: string; definition: object } | undefined>;
  fetch?(id: string): Promise<object>;
  /**
   * Reduce a body to its canonical comparison form: strip server-echoed
   * noise (empty `audience`) and spelled-out meta-schema defaults
   * (`x-audit`, a connection's `pkce_enabled` et al) so hashing and diff
   * rendering treat semantically identical bodies as identical, and a field
   * the file leaves out reads as the server's default rather than as a
   * change — the server applies those defaults itself. Comparison only:
   * uploads send the file as written.
   */
  normalize?(data: object): object;
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
  /** Files that moved: the same resource, under a new file name. */
  moves: number;
  /** Removed files whose resource cannot be deleted yet; not part of `total`. */
  unsupported_deletions: number;
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
 * Present on flow create/update/revise actions whose `user_schema` pins a
 * schema revision that is superseded in the same run (a pending `revise`) or
 * was superseded by an interrupted earlier run. The executor rewrites
 * `user_schema` to the new revision id — `newId` when the revision already
 * exists (crash recovery), otherwise the id minted by this run's revise.
 */
export type FlowRepin = { previousId: string; schemaPath: string; newId?: string };

/**
 * A non-blocking plan-time finding: a flow-validation issue of severity
 * `warning` (`@zitadel/config/validate`), or a branding asset URL the
 * probe could not fetch (`asset-probe.ts`). Rendered as `# warning:`
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
      /**
       * The removed file this one replaces: the platform already holds the
       * resource, so the write revises it rather than creating another.
       */
      movedFrom?: string;
      /** For a move: what the platform stores, so the plan can show what changes. */
      oldContent?: object;
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
      repin?: FlowRepin;
      warnings?: ReadonlyArray<SyncActionWarning>;
    }
  | { kind: "delete"; path: string; syncer: ResourceSyncer; id: string; oldContent: object | null }
  | { kind: "skip"; path: string; reason: "immutable" | "no-change" }
  | {
      kind: "skip";
      path: string;
      reason: "unsupported-deletion";
      syncer: ResourceSyncer;
      id: string;
    };
