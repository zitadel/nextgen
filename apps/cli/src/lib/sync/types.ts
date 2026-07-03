/**
 * One row in the local state file: the platform `id` returned at create time
 * and the content `hash` last successfully synced. Both fields are optional so
 * the engine can recover from partial writes. `url` is recorded for revisioned
 * resources (today: schemas) so `apply` can name the URL currently pinned by
 * downstream files (today: flows) when a new revision supersedes it.
 */
export type ResourceEntry = {
  id?: string;
  hash?: string;
  name?: string;
  status?: string;
  url?: string;
};

/**
 * The persisted contents of `.zitadel/state.json`. Maps each managed file path
 * (relative to the project root) to its sync entry, plus the framework id
 * captured during `zitadel setup`.
 */
export type ZitadelState = {
  framework: string;
  resources: Record<string, ResourceEntry>;
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
   * Assert that a single on-disk file body is valid for this resource.
   * Throws `E_VALIDATION` (a `ZitadelError`) on the first invalid input.
   * The sync engine calls this for every file it reads, so a malformed
   * schema or flow fails the run before any platform mutation — `plan`
   * and `apply` both go through here.
   */
  validate(data: object): void;
  create(data: object): Promise<string>;
  update(id: string, data: object): Promise<void>;
  delete(id: string): Promise<void>;
  fetch?(id: string): Promise<object>;
  /**
   * Compose the URL a downstream resource (e.g. a flow's `user_schema`) would
   * use to reference this resource by server-assigned id. Implemented by
   * revisioned syncers; the loop uses it to record the resolved URL after
   * publishing a new revision, so subsequent runs can name the URL that
   * downstream files were pinned to before.
   */
  resolveUrl?(id: string): string;
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
 * currently pinned to `previousUrl` and would need re-pinning to adopt the
 * new revision (see `.zitadel/flows/README.md`).
 */
export type SyncAction =
  | { kind: "create"; path: string; syncer: ResourceSyncer; content: object; hash: string }
  | {
      kind: "update";
      path: string;
      syncer: ResourceSyncer;
      id: string;
      content: object;
      hash: string;
      oldContent: object | null;
    }
  | {
      kind: "revise";
      path: string;
      syncer: ResourceSyncer;
      content: object;
      hash: string;
      previousId: string;
      previousUrl?: string;
      oldContent: object | null;
      affectedPaths: ReadonlyArray<string>;
    }
  | { kind: "delete"; path: string; syncer: ResourceSyncer; id: string; oldContent: object | null }
  | { kind: "skip"; path: string; reason: "immutable" | "no-change" };
