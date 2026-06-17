/**
 * One row in the local state file: the platform `id` returned at create time
 * and the content `hash` last successfully synced. Both fields are optional so
 * the engine can recover from partial writes.
 */
export type ResourceEntry = {
  id?: string;
  hash?: string;
  name?: string;
  status?: string;
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
 * file-content changes trigger an update or get skipped. Concrete syncers
 * call the orval-generated operations directly; bearer auth and base URL
 * come from `@zitadel/api/runtime/{auth,base-url}` module-globals
 * the command layer sets at boot.
 */
export interface ResourceSyncer {
  readonly kind: string;
  readonly directory: string;
  readonly mutable: boolean;
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
}

/**
 * Counts of the non-`skip` actions in a sync plan, used for the `plan` /
 * `apply --dry-run` JSON payload. Produced by `summarizePlan`.
 */
export type SyncPlanSummary = {
  creates: number;
  updates: number;
  deletes: number;
  total: number;
};

/**
 * One unit of work in a sync plan. The engine emits exactly one `SyncAction`
 * per resource file (or per state-only entry, for deletes). Discriminated by
 * `kind`; `oldContent` carries the platform's current value for diff rendering.
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
  | { kind: "delete"; path: string; syncer: ResourceSyncer; id: string; oldContent: object | null }
  | { kind: "skip"; path: string; reason: "immutable" | "no-change" };
