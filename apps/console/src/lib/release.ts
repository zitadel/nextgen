import type {
  GetReleaseById200,
  GetReleaseById200PointersItem,
  GetReleaseById200PointersItemKind,
  ListReleases200ReleasesItem,
} from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";
import { flowDisplayName, humanise } from "./flow-definition";
import { type PolicySetting, policyDisplayName, policyDocument, policySettings } from "./policy";
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
  { kind: "policy", label: "Policies", noun: "policy" },
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
  /** A policy's settings, summarised above its document; other kinds have none. */
  settings?: PolicySetting[];
}

/**
 * Reads the revision a pointer names.
 *
 * A read that fails costs the pointer its document and its name, not the
 * screen: the release is still what the operator came for, and the handle
 * still says which resource the pointer pins.
 *
 * Schema, identity provider and policy ids are unique per project only, so
 * those reads name the selected project; the flow and branding reads take the
 * revision id alone.
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
      case "policy": {
        const revision = await api.getPolicyRevision(pointer.revision_id, {
          project_id: projectId,
        });
        return {
          ...base,
          name: policyDisplayName(pointer.handle),
          document: policyDocument(revision),
          settings: policySettings(revision),
        };
      }
    }
  } catch {
    // Fall through to the unresolved shape.
  }
  return { ...base, name: unresolvedName(pointer), document: undefined };
}

/**
 * The name a pointer has without its revision. A policy's handle is its
 * operation, so the row reads the same whether or not the read succeeded;
 * every other kind falls back to its handle.
 */
function unresolvedName(pointer: ReleasePointer): string {
  return pointer.kind === "policy" ? policyDisplayName(pointer.handle) : humanise(pointer.handle);
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

/** One entry of `GET /releases`: a release without its pointers. */
export type ReleaseSummary = ListReleases200ReleasesItem;

/** The most `GET /releases` hands back per page. */
const RELEASE_PAGE_SIZE = 100;

/**
 * The project's releases that can still be deployed: every page, newest
 * first, without the revoked ones. The list has no filter by state, and a
 * project's releases are a few pages at most.
 */
export async function listDeployableReleases(projectId: string): Promise<ReleaseSummary[]> {
  const releases: ReleaseSummary[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.listReleases({
      project_id: projectId,
      limit: RELEASE_PAGE_SIZE,
      page_token: pageToken,
    });
    releases.push(...page.releases);
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);
  return releases.filter((release) => release.revoked_at === null);
}

/** `POST /releases/{id}/revoke` refuses with this while an origin serves the release. */
export const RELEASE_IN_USE = "rel.in_use";

/**
 * Revokes the release, so it is never served again. Already revoked, the
 * server answers with the release unchanged; still served by an origin, it
 * refuses with {@link RELEASE_IN_USE}.
 */
export function revokeRelease(projectId: string, releaseId: string) {
  return api.revokeRelease(releaseId, { project_id: projectId });
}
