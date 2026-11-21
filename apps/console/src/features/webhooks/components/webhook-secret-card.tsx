import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date";

import { rotateWebhookSecret } from "../api";
import { rotationInProgress, type Webhook } from "../model";
import { VERIFY_GUIDE_URL } from "./webhook-secret-dialog";

/** What a rotation does to the secret in use, in the confirmation and on the card. */
const GRACE = "The previous secret keeps working for 24 hours";

/**
 * The webhook's signing secret: what it is for, and its rotation. The secret
 * itself is never here. The server returns it when the webhook is created
 * and when it is rotated, and at no other time.
 *
 * Rotating issues a new secret and keeps the one it replaces valid for 24
 * hours, during which every delivery carries a signature for each. While
 * that is running the card says until when, and the confirmation says what
 * a second rotation costs: the older of the two stops at once.
 *
 * `onRotated` takes the new secret, for the dialog that shows it once.
 */
export function WebhookSecretCard({
  projectId,
  webhook,
  onRotated,
}: {
  projectId: string;
  webhook: Webhook;
  onRotated: (secret: string) => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const rotating = rotationInProgress(webhook);
  const until = rotating ? formatDateTime(webhook.previous_secret_expires_at) : undefined;

  return (
    <DetailSection
      title="Signing secret"
      action={
        <Button
          variant="secondary"
          size="sm"
          className={CARD_ACTION_BUTTON}
          onClick={() => setConfirming(true)}
        >
          Rotate secret
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Every delivery is signed with the webhook&rsquo;s secret, so your endpoint can check that
          a request came from this project:{" "}
          <a
            href={VERIFY_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            Verify a webhook&rsquo;s signature
          </a>
          . The secret is shown once, when the webhook is created and when it is rotated.
        </p>
        {until && (
          <p className="text-foreground">
            A rotation is in progress: the previous secret keeps working until {until}.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Rotate signing secret?"
        description={
          until
            ? `A new secret is issued and shown once. A rotation is already in progress: the secret it replaced, valid until ${until}, stops working at once, and the current one keeps working for 24 hours.`
            : `A new secret is issued and shown once. ${GRACE}, so your endpoint can switch without refusing a delivery.`
        }
        action="Rotate secret"
        fallback="Could not rotate the secret."
        onConfirm={async () => {
          await onRotated(await rotateWebhookSecret(projectId, webhook.id));
        }}
      />
    </DetailSection>
  );
}
