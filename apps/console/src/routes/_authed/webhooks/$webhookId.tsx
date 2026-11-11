import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DETAIL_CARD, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { WebhookDeliveryCard } from "@/features/webhooks/components/webhook-delivery-card";
import { WebhookDetailsCard } from "@/features/webhooks/components/webhook-details-card";
import { WebhookSecretCard } from "@/features/webhooks/components/webhook-secret-card";
import { WebhookSecretDialog } from "@/features/webhooks/components/webhook-secret-dialog";
import { WebhookStatusBadge } from "@/features/webhooks/components/webhook-status-badge";
import { rotationInProgress, webhookState } from "@/features/webhooks/model";
import { formatDate, formatDateTime } from "@/lib/date";

/**
 * One webhook: a resource inside Webhooks, on the resource detail shell, as a
 * team is inside Teams. The sidebar keeps the project's list with Webhooks
 * marked.
 *
 * Its cards, in the order they are reached for: how delivery is doing, with
 * the button that stops and starts it; the endpoint, the note and the
 * events, with their Save; the signing secret's rotation; and the delete.
 *
 * **The secret is shown once, and kept nowhere.** A rotation returns the new
 * secret, which no later read does. It goes into this screen's state for
 * `WebhookSecretDialog` and is dropped when the dialog closes; the loader's
 * data, which a reload reads again, never holds it.
 */
export const Route = createFileRoute("/_authed/webhooks/$webhookId")({
  staticData: { scope: "project", resource: "webhook" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    return {
      projectId,
      webhook: await api.getWebhook(params.webhookId, { project_id: projectId }),
    };
  },
  component: WebhookDetail,
});

function WebhookDetail() {
  const { projectId, webhook } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  // The rotated secret, for the dialog and no longer than it is open.
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const reload = () => router.invalidate();

  return (
    <Page>
      <DetailHeader
        icon={WebhookIcon}
        title={webhook.url}
        status={<WebhookStatusBadge state={webhookState(webhook)} />}
        subtitle={webhook.description || undefined}
        meta={
          <>
            <MetaValue label="Webhook ID" value={webhook.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(webhook.created_at)} />
          </>
        }
      />

      {/* The page owns the 16px between its cards. */}
      <div className={`${DETAIL_BODY} flex flex-col gap-4`}>
        <WebhookDeliveryCard projectId={projectId} webhook={webhook} onChanged={reload} />
        <WebhookDetailsCard
          // The draft starts over from what was saved, and outlives a reload
          // that changed none of it (enabling, a rotation).
          key={[webhook.id, webhook.url, webhook.description, ...webhook.event_types].join("\n")}
          projectId={projectId}
          webhook={webhook}
          onSaved={reload}
        />
        <WebhookSecretCard
          projectId={projectId}
          webhook={webhook}
          onRotated={async (rotated) => {
            setSecret(rotated);
            await reload();
          }}
        />

        <Card className={DETAIL_CARD}>
          <CardContent className="flex flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-4">
              <h2 className="text-foreground font-serif text-base leading-none">Delete webhook</h2>
              <p className="text-muted-foreground text-[13px] leading-[19px]">
                Stops every delivery to this endpoint, including events not yet sent, and ends its
                signing secret. This can&rsquo;t be undone.
              </p>
            </div>
            {/* `lg` for the design's 40px height, at the 10px inset. */}
            <Button
              variant="destructive"
              size="lg"
              className="shrink-0 px-2.5"
              onClick={() => setDeleting(true)}
            >
              Delete webhook
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete webhook?"
        description={`Events are no longer sent to ${webhook.url}, including those not yet delivered, and its signing secret stops being valid. This cannot be undone.`}
        action="Delete webhook"
        fallback="Could not delete the webhook."
        onConfirm={async () => {
          await api.deleteWebhook(webhook.id, { project_id: projectId });
          // From the root-mounted toaster, so it outlives this screen.
          toast.success("Webhook deleted");
          await navigate({ to: "/webhooks" });
        }}
      />

      <WebhookSecretDialog
        secret={secret}
        note={
          rotationInProgress(webhook)
            ? `The previous secret keeps working until ${formatDateTime(webhook.previous_secret_expires_at)}.`
            : undefined
        }
        onClose={() => setSecret(undefined)}
      />
    </Page>
  );
}
