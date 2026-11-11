import { Link } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { MetaCard, MetaRule, MetaValue } from "@/components/detail-meta";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { Page } from "@/components/layout";
import { SECTION_HEADING } from "@/components/typography";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import type { IdpDetailData } from "@/features/authentication/load";
import { type IdpReference, idpClientId } from "@/features/authentication/model";
import { formatDate } from "@/lib/date";

/**
 * The page a login flow that uses the connection opens: the project's, or the
 * root's Login flows in the reserved platform project (D41).
 */
export type FlowDetailRoute =
  | "/flow-definitions/$definitionId"
  | "/settings/login-flows/$definitionId";

/** The classes of a "Used by" name that opens its page. */
const REFERENCE_LINK = "underline-offset-2 hover:underline";

/**
 * One identity provider connection: its key values, what references it, and
 * the stored document. No create, edit or delete — connections are applied
 * through the CLI (#998), which the document viewer's footer names.
 *
 * Drawn for the selected project, and at the root for the reserved platform
 * project (D41). The route names where "Used by" opens: the root shows no
 * user schemas (D41), so there it passes no `schemaDetail` and their names
 * read as text.
 */
export function IdpDetailScreen({
  idp,
  schemas,
  flows,
  schemaDetail,
  flowDetail,
}: IdpDetailData & {
  /** Where a user schema opens; without it, its name is text. */
  schemaDetail?: "/schemas/$schemaId";
  /** Where a login flow opens; without it, its name is text. */
  flowDetail?: FlowDetailRoute;
}) {
  const clientId = idpClientId(idp.definition);

  return (
    <Page inset="panel">
      <DetailPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Shield} title={idp.definition.display_name} />
          <MetaCard bordered={false}>
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
                <References
                  items={schemas}
                  link={
                    schemaDetail &&
                    ((item) => (
                      <Link
                        to={schemaDetail}
                        params={{ schemaId: item.id }}
                        className={REFERENCE_LINK}
                      >
                        {item.name}
                      </Link>
                    ))
                  }
                />
              </Row>
              <Row label="Login flows">
                <References
                  items={flows}
                  link={
                    flowDetail &&
                    ((item) => (
                      <Link
                        to={flowDetail}
                        params={{ definitionId: item.id }}
                        className={REFERENCE_LINK}
                      >
                        {item.name}
                      </Link>
                    ))
                  }
                />
              </Row>
            </Section>
          </div>

          {/* `client_secret` is always a `${{ VAR }}` reference (the document
              schema rejects a literal), so the stored document is safe to show
              whole. */}
          <DocumentViewer document={idp.definition} noun="connection" />
        </div>
      </DetailPanel>
    </Page>
  );
}

/** An eyebrow over label/value rows, each row followed by a hairline. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>{title}</h2>
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

/**
 * Comma-separated names of what references the connection, each drawn by
 * `link` where one is given and as text otherwise, or `Not used`.
 */
function References({
  items,
  link,
}: {
  items: IdpReference[];
  link?: (item: IdpReference) => ReactNode;
}) {
  if (items.length === 0) return <span className="text-muted-foreground">Not used</span>;
  return (
    <span className="flex min-w-0 flex-wrap">
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 && <span className="mr-1">,</span>}
          {link ? link(item) : <span>{item.name}</span>}
        </Fragment>
      ))}
    </span>
  );
}
