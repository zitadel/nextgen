import { start } from "workflow/api";

import { failure, json } from "@/request";
import { NotLiveError, currentSystems } from "@/systems";
import { syncEntitlements } from "@/workflows/sync-entitlements";

/** The events after which a team may do something else than before. */
const CHANGES_ENTITLEMENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * Stripe's webhooks (root ADR 084 §6). Answered at once: the work is a
 * workflow, which reads Stripe's current state, so a redelivered or
 * reordered event ends the same. Every other event is acknowledged and
 * ignored, which keeps `invoice.created` from holding up finalization.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const systems = currentSystems();
    const event = await systems.stripe.parseWebhook(
      await request.text(),
      request.headers.get("stripe-signature"),
    );
    if (!event) return failure(400, "cloud.signature_invalid", "The signature does not verify.");
    if (CHANGES_ENTITLEMENTS.has(event.type)) await start(syncEntitlements, [event.customer_id]);
    return json({ received: event.id });
  } catch (error) {
    if (error instanceof NotLiveError) return failure(503, "cloud.not_live", error.message);
    throw error;
  }
}
