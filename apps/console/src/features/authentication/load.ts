import { api } from "@/api/zitadel";
import { fetchAllFlows } from "@/features/flow-definitions/api";
import { flowDisplayName } from "@/features/flow-definitions/model";
import { fetchAllSchemas } from "@/features/schemas/api";
import type { SchemaEntry } from "@/features/schemas/model";

import { fetchAllIdps } from "./api";
import { flowsUsingIdp, type IdpConnection, type IdpReference, schemasUsingIdp } from "./model";

/** What the Authentication screen's tabs show. */
export interface AuthenticationData {
  schemas: SchemaEntry[];
  /** `null` without `idp.read`. */
  idps: IdpConnection[] | null;
}

/**
 * Reads a project's Authentication screen: for the selected project's, and
 * for the root's of the reserved platform project (D41), which share it.
 */
export async function loadAuthentication(projectId: string): Promise<AuthenticationData> {
  // The whole project's schemas and connections: both tabs join the two on
  // the slug, and no API answers that join directly. The connections are
  // also the Identity providers list, so it is not paged.
  const [schemas, idps] = await Promise.all([fetchAllSchemas(projectId), fetchAllIdps(projectId)]);
  return { schemas, idps };
}

/** What an identity provider's page shows: the connection and what references it. */
export interface IdpDetailData {
  idp: IdpConnection;
  schemas: IdpReference[];
  flows: IdpReference[];
}

/**
 * Reads one identity provider's page, in the selected project or at the root
 * in the reserved platform project (D41).
 */
export async function loadIdpDetail(projectId: string, idpId: string): Promise<IdpDetailData> {
  // "Used by" has no API: it is every schema and flow whose latest revision
  // names the slug, read from the full lists.
  const [idp, schemas, flows] = await Promise.all([
    api.getIdpById(idpId, { project_id: projectId }),
    fetchAllSchemas(projectId),
    fetchAllFlows(projectId),
  ]);
  return {
    idp,
    schemas: schemasUsingIdp(idp.slug, schemas),
    flows: flowsUsingIdp(idp.slug, flows).map(
      (entry): IdpReference => ({ id: entry.id, name: flowDisplayName(entry.flow_definition) }),
    ),
  };
}
