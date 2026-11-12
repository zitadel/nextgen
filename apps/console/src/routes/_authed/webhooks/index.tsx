import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus, Webhook as WebhookIcon } from "lucide-react";
import { useId, useState } from "react";

import { Page } from "@/components/layout";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_HEADER,
  RESOURCE_MENU_CELL_NARROW,
  RESOURCE_ROW_ICON,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { listWebhooks } from "@/features/webhooks/api";
import { AddWebhookSheet } from "@/features/webhooks/components/add-webhook-sheet";
import { WebhookSecretDialog } from "@/features/webhooks/components/webhook-secret-dialog";
import { WebhookStatusBadge } from "@/features/webhooks/components/webhook-status-badge";
import {
  describeEventTypes,
  LIMIT_REACHED,
  type Webhook,
  WEBHOOK_LIMIT,
  webhookState,
} from "@/features/webhooks/model";
import { formatRecent } from "@/lib/date";

/**
 * Webhooks: the endpoints the project's events are sent to (D41, root ADR
 * 088), on the shared resource table. The server POSTs each event a webhook
 * names to its URL, signed with the webhook's secret.
 *
 * A row is the endpoint with its note under it, what it receives, its state
 * and when it last took a delivery. The API has no status field: the state
 * is worked out from `enabled` and the two delivery times (`webhookState`).
 * A row opens the webhook's page, where it is edited, disabled, given a new
 * secret and deleted.
 *
 * **One page, no `Load more`.** A project holds at most ten webhooks. At ten
 * the screen says so and holds Add, rather than letting the drawer be filled
 * in for the server to refuse.
 *
 * **The secret is shown once, and kept nowhere.** Creating a webhook returns
 * its signing secret, which no later read does. It goes from the drawer into
 * this screen's state for `WebhookSecretDialog` and is dropped when the dialog
 * closes; the loader's data never holds it.
 *
 * **Actions show whatever the person may do**, as every list's do (D33): the
 * console has no permissions read, and the server refuses what is not allowed
 * in its own words, in the drawer or the dialog the action opened.
 */
export const Route = createFileRoute("/_authed/webhooks/")({
  // After Events, which shows the events these send; before Settings, the last.
  staticData: { scope: "project", nav: { label: "Webhooks", order: 10, icon: WebhookIcon } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => ({
    webhooks: await listWebhooks(requireProjectScope(deps.project)),
  }),
  component: WebhooksScreen,
});

function WebhooksScreen() {
  const { webhooks } = Route.useLoaderData();
  const router = useRouter();
  const limitId = useId();
  // The new webhook's secret, for the dialog and no longer than it is open.
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const full = webhooks.length >= WEBHOOK_LIMIT;

  return (
    <Page>
      <ResourceTitle
        action={
          <AddWebhookSheet
            onCreated={async (created) => {
              setSecret(created);
              await router.invalidate();
            }}
          >
            {/* `px-2.5!`: `Button`'s `has-[>svg]:px-3` out-specifies a plain `px-2.5`. */}
            <Button
              className="shrink-0 gap-1.5 px-2.5!"
              disabled={full}
              aria-describedby={full ? limitId : undefined}
            >
              <Plus aria-hidden />
              Add
            </Button>
          </AddWebhookSheet>
        }
      >
        Webhooks
      </ResourceTitle>

      {full && (
        <p id={limitId} className={`${RESOURCE_HEADER} text-muted-foreground mt-3 text-sm`}>
          {LIMIT_REACHED}
        </p>
      )}

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[38%]">Endpoint</ResourceHeadCell>
              <ResourceHeadCell>Events</ResourceHeadCell>
              <ResourceHeadCell>Status</ResourceHeadCell>
              <ResourceHeadCell>Last delivery</ResourceHeadCell>
              <ResourceMenuHead narrow />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {webhooks.length === 0 ? (
              <ResourceEmptyRow colSpan={5}>This project has no webhooks.</ResourceEmptyRow>
            ) : (
              webhooks.map((webhook) => <WebhookRow key={webhook.id} webhook={webhook} />)
            )}
          </TableBody>
        </Table>
      </div>

      <WebhookSecretDialog secret={secret} onClose={() => setSecret(undefined)} />
    </Page>
  );
}

/**
 * One webhook: its endpoint, with the note under it (D20's second line), what
 * it receives, its state and its last delivery. The whole row opens it.
 */
function WebhookRow({ webhook }: { webhook: Webhook }) {
  const navigate = useNavigate();
  const params = { webhookId: webhook.id };

  return (
    <ResourceRow onOpen={() => void navigate({ to: "/webhooks/$webhookId", params })}>
      <TableCell className={`${RESOURCE_CELL} text-sm`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <WebhookIcon aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          <span className="min-w-0">
            <Link
              to="/webhooks/$webhookId"
              params={params}
              className="text-foreground block truncate font-medium underline-offset-2 hover:underline"
            >
              {webhook.url}
            </Link>
            {webhook.description && (
              <span className="text-muted-foreground block truncate text-xs">
                {webhook.description}
              </span>
            )}
          </span>
        </span>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        {describeEventTypes(webhook.event_types)}
      </TableCell>
      <TableCell className={RESOURCE_CELL}>
        <WebhookStatusBadge state={webhookState(webhook)} />
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        {webhook.last_delivered_at ? formatRecent(webhook.last_delivered_at) : "Never"}
      </TableCell>
      <TableCell className={RESOURCE_MENU_CELL_NARROW}>
        <RowMenu name={webhook.url}>
          <DropdownMenuItem asChild>
            <Link to="/webhooks/$webhookId" params={params}>
              View webhook
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
