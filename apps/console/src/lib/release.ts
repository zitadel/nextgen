import type {
  GetReleaseById200,
  GetReleaseById200PointersItem,
  GetReleaseById200PointersItemKind,
} from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";
import { flowDisplayName, humanise } from "./flow-definition";
import { type UserSchema, schemaDisplayName } from "./schema";

/**
 * Display helpers for the release screens.
 *
 * A release pins pointers, not content: each `(kind, handle, revision_id)`
 * names a revision the per-kind read endpoints serve. The detail screen shows
 * the document behind each pointer, so it resolves them here.
 */

/** `GET /releases/{release_id}`. */
export type Release = GetReleaseById200;

/** One pinned revision. */
export type ReleasePointer = GetReleaseById200PointersItem;

export type ReleasePointerKind = GetReleaseById200PointersItemKind;

/** The two states a release has: `revoked_at` is set or it is not. */
export type ReleaseStatus = "active" | "revoked";

export function releaseStatus(release: { revoked_at: string | null }): ReleaseStatus {
  return release.revoked_at ? "revoked" : "active";
}

/**
 * The pointer kinds in the order the detail lists them, with the heading over
 * each group and what the document viewer's footer calls one document.
 */
export const POINTER_KINDS: readonly {
  kind: ReleasePointerKind;
  label: string;
  noun: string;
}[] = [
  { kind: "schema", label: "User schemas", noun: "schema" },
  { kind: "flow_definition", label: "Login flows", noun: "definition" },
  { kind: "branding", label: "Branding", noun: "branding" },
  { kind: "idp", label: "Identity providers", noun: "connection" },
];

/** A pointer with the revision it names read, or not. */
export interface ResolvedPointer {
  kind: ReleasePointerKind;
  handle: string;
  revisionId: string;
  /** The document's own name where it has one, else the handle as a label. */
  name: string;
  /** `undefined` when the revision could not be read for this caller. */
  document: unknown;
}

/**
 * Reads the revision a pointer names.
 *
 * A read that fails costs the pointer its document and its name, not the
 * screen: the release is still what the operator came for, and the handle
 * still says which resource the pointer pins.
 *
 * Schema ids are unique per project only, so that read names the selected
 * project; the flow and branding reads take the revision id alone.
 */
export async function resolvePointer(
  pointer: ReleasePointer,
  projectId: string,
): Promise<ResolvedPointer> {
  const base = { kind: pointer.kind, handle: pointer.handle, revisionId: pointer.revision_id };
  try {
    switch (pointer.kind) {
      case "schema": {
        const body = await api.getSchemaById(pointer.revision_id, { project_id: projectId });
        const schema = body.schema as UserSchema;
        return { ...base, name: schemaDisplayName(schema, pointer.handle), document: schema };
      }
      case "flow_definition": {
        const entry = await api.getFlowDefinition(pointer.revision_id);
        return {
          ...base,
          name: flowDisplayName(entry.flow_definition),
          document: entry.flow_definition,
        };
      }
      case "branding": {
        const body = await api.getBrandingById(pointer.revision_id);
        return { ...base, name: humanise(pointer.handle), document: body.branding };
      }
      case "idp": {
        const body = await api.getIdpRevisionById(pointer.revision_id, { project_id: projectId });
        return { ...base, name: humanise(pointer.handle), document: body.definition };
      }
    }
  } catch {
    // Fall through to the unresolved shape.
  }
  return { ...base, name: humanise(pointer.handle), document: undefined };
}

/** A group of the detail's pointer list: one per kind that the release pins. */
export interface PointerGroup {
  kind: ReleasePointerKind;
  label: string;
  noun: string;
  pointers: ResolvedPointer[];
}

/**
 * Pointers by kind, in {@link POINTER_KINDS} order, each group sorted by name.
 * A kind the release does not pin has no group rather than an empty one.
 */
export function groupPointers(pointers: ResolvedPointer[]): PointerGroup[] {
  return POINTER_KINDS.flatMap(({ kind, label, noun }) => {
    const members = pointers
      .filter((pointer) => pointer.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
    return members.length === 0 ? [] : [{ kind, label, noun, pointers: members }];
  });
}

/** The first ten characters of a commit sha, as `git log --abbrev` prints it. */
export function shortSha(sha: string): string {
  return sha.slice(0, 10);
}
