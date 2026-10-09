import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { api } from "@/api/zitadel";
import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { DETAIL_PANEL_PAGE } from "@/components/layout";
import { EYEBROW } from "@/components/typography";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/lib/date";
import { flowDisplayName } from "@/lib/flow-definition";
import {
  fetchAllFlows,
  fetchAllSchemas,
  flowsUsingIdp,
  type IdpReference,
  idpClientId,
  schemasUsingIdp,
} from "@/lib/idp";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";

export const Route = createFileRoute("/_authed/authentication/idps/$idpId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    // "Used by" has no API: it is every schema and flow whose latest revision
    // names the slug, read from the full lists.
    const [idp, schemas, flows] = await Promise.all([
      api.getIdpById(params.idpId, { project_id: projectId }),
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
    <div className={DETAIL_PANEL_PAGE}>
      <DetailPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Shield} title={idp.definition.display_name} />
          <MetaCard>
            <MetaValue label="Connection ID" value={idp.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(idp.created_at)} />
          </MetaCard>
        </div>

        <Separator />

        {/* Two columns at `lg`, 40px apart as drawn; the document stacks
            under the details below it. */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-stretch">
          <div className="flex min-w-0 flex-1 flex-col gap-10">
            <Section title="Provider details">
              <Row label="Slug">
                <span className="truncate">{idp.slug}</span>
              </Row>
              <Row label="Client ID">
                {clientId ? (
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Shown as written: a `${{ VAR }}` reference stays a
                        reference — the value differs per environment. */}
                    <span className="truncate">{clientId}</span>
                    <CopyButton value={clientId} label="Copy Client ID" className="shrink-0" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
            </Section>

            <Section title="Used by">
              <Row label="User schemas">
                <References items={schemas} to="schema" />
              </Row>
              <Row label="Login flows">
                <References items={flows} to="flow" />
              </Row>
            </Section>
          </div>

          {/* `client_secret` is always a `${{ VAR }}` reference (the document
              schema rejects a literal), so the stored document is safe to show
              whole. */}
          <DocumentViewer document={idp.definition} noun="connection" />
        </div>
      </DetailPanel>
    </div>
  );
}

/** An eyebrow over label/value rows, each row followed by a hairline. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className={EYEBROW}>{title}</h2>
      {children}
    </section>
  );
}

/** A 200px muted label and its value, then the rule beneath them. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-7 items-center gap-4 py-1 text-sm leading-5">
        <span className="w-32 shrink-0 font-medium text-muted-foreground sm:w-[200px]">
          {label}
        </span>
        <div className="flex min-w-0 flex-1 text-foreground">{children}</div>
      </div>
      <Separator />
    </>
  );
}

/** Comma-separated links to what references the connection, or `Not used`. */
function References({ items, to }: { items: IdpReference[]; to: "schema" | "flow" }) {
  if (items.length === 0) return <span className="text-muted-foreground">Not used</span>;
  return (
    <span className="flex min-w-0 flex-wrap">
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
