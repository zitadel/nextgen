import type { PlatformClient } from "../api/client.js";

/**
 * One row in the local state file: the platform `id` returned at create time
 * and the content `hash` last successfully synced. Both fields are optional so
 * the engine can recover from partial writes.
 */
export type ResourceEntry = {
  id?: string;
  hash?: string;
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
 * (file-private to the module) translate the generic `data: object` payload
 * into the resource-specific envelope and dispatch to the matching `client.*`
 * method.
 */
export interface ResourceSyncer {
  readonly kind: string;
  readonly directory: string;
  readonly mutable: boolean;
  create(client: PlatformClient, data: object): Promise<string>;
  update(client: PlatformClient, id: string, data: object): Promise<void>;
  delete(client: PlatformClient, id: string): Promise<void>;
  fetch?(client: PlatformClient, id: string): Promise<object>;
}

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
