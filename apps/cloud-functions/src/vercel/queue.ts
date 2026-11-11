import { send } from "@vercel/queue";

import { recordingWakeQueue } from "../mock";
import type { WakeQueue } from "../ports";

/**
 * The topic of the wake-ups. Its consumer is the route repo-root vercel.json
 * names for it (`app/queues/webhook-wake/route.ts`).
 */
export const WAKE_TOPIC = "webhook-wake";

/**
 * Vercel Queues as the wake-up queue. The SDK publishes with the function's
 * OIDC token, in the function's region and pinned to its deployment, which
 * is where the queue calls the consumer.
 */
export function vercelWakeQueue(): WakeQueue {
  return {
    async publish(wake, schedule) {
      await send(WAKE_TOPIC, wake, {
        delaySeconds: schedule.delay_seconds,
        idempotencyKey: schedule.idempotency_key,
        retentionSeconds: schedule.retention_seconds,
      });
    },
  };
}

/**
 * The queue of the webhook wake-ups (root ADR 089 §4). On Vercel it is
 * Vercel Queues, in production too: the queue is ours, not a third party's,
 * and `WEBHOOK_WAKE_SECRET` is what turns its route on. Anywhere else
 * nothing would call a consumer back, so the recorder of `src/mock.ts` takes
 * the message, and the local server's own timer delivers.
 */
export function wakeQueue(): WakeQueue {
  return process.env.VERCEL ? vercelWakeQueue() : recordingWakeQueue();
}
