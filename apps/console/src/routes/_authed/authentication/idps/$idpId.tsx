import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { Fragment } from "react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import {
  DETAIL_BODY,
  DETAIL_VALUE,
  DETAIL_VALUE_EMPTY,
  DetailHeader,
  DetailRow,
  DetailRows,
  DetailSection,
} from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { SUBSECTION_HEADING } from "@/components/typography";
import { CopyButton } from "@/components/ui/copy-button";
import { formatDate } from "@/lib/date";
import { fetchAllFlows } from "@/features/flow-definitions/api";
import { flowDisplayName } from "@/features/flow-definitions/model";
import {
  flowsUsingIdp,
  type IdpReference,
  idpClientId,
  schemasUsingIdp,
} from "@/features/authentication/model";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { fetchAllSchemas } from "@/features/schemas/api";

export const Route = createFileRoute("/_authed/authentication/idps/$idpId")({
  staticData: { scope: "project", resource: "identity provider" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    // "Used by" has no API: it is every schema and flow whose latest revision
    // names the slug, read from the full lists.
    const [idp, schemas, flows] = await Promise.all([
      api.getIdp(params.idpId, { project_id: projectId }),
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
  },
  component: IdpDetail,
});

/**
 * One identity provider connection: its key values, what references it, and
 * the stored document. No create, edit or delete — connections are applied
 * through the CLI (#998), which the document viewer's footer names.
 */
function IdpDetail() {
  const { idp, schemas, flows } = Route.useLoaderData();
  const clientId = idpClientId(idp.definition);

  return (
    <Page>
      <DetailHeader
        icon={Shield}
        title={idp.definition.display_name}
        meta={
          <>
            <MetaValue label="Connection ID" value={idp.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(idp.created_at)} />
          </>
        }
      />

      <DetailSection title="Provider details" className={DETAIL_BODY}>
        {/* Two columns at `lg`, 40px apart as drawn; the document stacks
            under the details below it. */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-stretch">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <DetailRows>
              <DetailRow label="Slug">
                <span className={DETAIL_VALUE}>{idp.slug}</span>
              </DetailRow>
              <DetailRow align={clientId ? "control" : "start"} label="Client ID">
                {clientId ? (
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Shown as written: a `${{ VAR }}` reference stays a
                        reference — the value differs per environment. */}
                    <span className={DETAIL_VALUE}>{clientId}</span>
                    <CopyButton value={clientId} label="Copy Client ID" className="shrink-0" />
                  </span>
                ) : (
                  <span className={DETAIL_VALUE_EMPTY}>—</span>
                )}
              </DetailRow>
            </DetailRows>

            <section aria-labelledby="idp-used-by" className="flex flex-col gap-2">
              <h3 id="idp-used-by" className={SUBSECTION_HEADING}>
                Used by
              </h3>
              <DetailRows>
                <DetailRow label="User schemas">
                  <References items={schemas} to="schema" />
                </DetailRow>
                <DetailRow label="Login flows">
                  <References items={flows} to="flow" />
                </DetailRow>
              </DetailRows>
            </section>
          </div>

          {/* `client_secret` is always a `${{ VAR }}` reference (the document
              schema rejects a literal), so the stored document is safe to show
              whole. */}
          <DocumentViewer document={idp.definition} noun="connection" />
        </div>
      </DetailSection>
    </Page>
  );
}

/** Comma-separated links to what references the connection, or `Not used`. */
function References({ items, to }: { items: IdpReference[]; to: "schema" | "flow" }) {
  if (items.length === 0) return <span className={DETAIL_VALUE_EMPTY}>Not used</span>;
  return (
    <span className={`flex flex-wrap ${DETAIL_VALUE}`}>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 && <span className="mr-1">,</span>}
          {to === "schema" ? (
            <Link
              to="/schemas/$schemaId"
              params={{ schemaId: item.id }}
              className="underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
          ) : (
            <Link
              to="/flow-definitions/$definitionId"
              params={{ definitionId: item.id }}
              className="underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
          )}
        </Fragment>
      ))}
    </span>
  );
}
