import { DetailAccordion, DetailAccordionItem } from "@/components/detail-accordion";
import { DETAIL_VALUE, DETAIL_VALUE_EMPTY, DetailRow, DetailRows } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { OriginLink } from "@/components/origin-link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { type ApplicationClient, clientTypeLabel, grantTypeLabel } from "../model";

/**
 * An application's OAuth clients: an accordion row per client, named by its
 * slug, that opens to the client's settings and its part of the stored
 * document. The first client starts open: most applications have one, and its
 * `client_id` is what a person opens the screen for.
 *
 * Read-only: a client is written by `POST /applications` or a deploy, never
 * here.
 *
 * The document has no CLI hint. Every application the API returns today was
 * registered through `POST /applications`, which a deploy does not revise, so
 * "edit locally, then deploy" would be wrong for it. The hint belongs on an
 * application a release declares, once the response says which is which.
 */
export function ApplicationClients({ clients }: { clients: ApplicationClient[] }) {
  return (
    <DetailRow align="control" label={<h3>Clients</h3>}>
      <DetailAccordion defaultValue={clients.slice(0, 1).map((client) => client.slug)}>
        {clients.map((client) => (
          <DetailAccordionItem key={client.slug} value={client.slug} title={client.slug}>
            <ClientRows client={client} />
            {/* The document never carries a secret: the API shows one once,
                when it creates the client. */}
            <DocumentViewer document={client} noun="client" cliHint={false} />
          </DetailAccordionItem>
        ))}
      </DetailAccordion>
    </DetailRow>
  );
}

/**
 * A client's settings as labelled rows. They sit in the Clients row's value
 * column, so they stack on that column's width rather than the viewport's.
 */
function ClientRows({ client }: { client: ApplicationClient }) {
  const redirectUris = client.redirect_uris ?? [];
  return (
    <DetailRows container>
      {/* Left out when the client has another name: the row's title is its slug. */}
      {client.name && (
        <DetailRow label="Name">
          <span className={DETAIL_VALUE}>{client.name}</span>
        </DetailRow>
      )}
      <DetailRow label="Client ID">
        {client.client_id ? (
          <span className={cn(DETAIL_VALUE, "font-mono text-xs leading-5")}>
            {client.client_id}
          </span>
        ) : (
          <span className={DETAIL_VALUE_EMPTY}>—</span>
        )}
      </DetailRow>
      <DetailRow align="center" label="Type">
        <Badge variant="secondary">{clientTypeLabel(client.type)}</Badge>
      </DetailRow>
      {/* Unset reads as third-party: that is what the API takes it to mean
          for an application registered through it. */}
      <DetailRow label="First-party">
        <span className={DETAIL_VALUE}>{client.first_party ? "Yes" : "No"}</span>
      </DetailRow>
      <DetailRow align="center" label="Grant types">
        <span className="flex min-w-0 flex-wrap gap-2">
          {client.grant_types.map((grantType) => (
            <Badge key={grantType} variant="secondary">
              {grantTypeLabel(grantType)}
            </Badge>
          ))}
        </span>
      </DetailRow>
      <DetailRow align={redirectUris.length > 0 ? "control" : "start"} label="Redirect URIs">
        {redirectUris.length > 0 ? (
          // 8px between the 24px links, as the frame stacks them.
          <ul className="flex min-w-0 flex-col gap-2">
            {redirectUris.map((uri) => (
              <li key={uri} className="flex min-w-0">
                <OriginLink origin={uri} />
              </li>
            ))}
          </ul>
        ) : (
          <span className={DETAIL_VALUE_EMPTY}>—</span>
        )}
      </DetailRow>
    </DetailRows>
  );
}
