import { createHash, timingSafeEqual } from "node:crypto";

import type { WakeQueue, WakeSchedule, WebhookWake } from "./ports";
import { failure, json } from "./request";
import { passProtection } from "./zitadel";

/**
 * The hosted cloud's wake-up for project webhooks (root ADR 090 §4). The
 * server runs only while it serves a request, so it keeps no timer: when a
 * project has events to deliver it calls `receiveWake` (its
 * `events.webhooks.wake` hook), which puts a message on a queue, and the
 * queue calls `deliverWake`, which calls the server's delivery path for that
 * project. A failed delivery's retry is the same message, delayed.
 *
 * A wake-up carries no event. The server's events table and each webhook's
 * cursor decide what is sent, so a message lost, doubled or late changes
 * when, never what; the hourly cron job (repo-root vercel.json) delivers
 * whatever a lost one left.
 */

/** The server's delivery path and the parameter that keeps a round to one project. */
const TRIGGER_PATH = "/cron/events-webhooks";
const TRIGGER_PROJECT = "project_id";

/** A project id as the server mints them: what may go into a queue key and a query. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The longest a wake-up is delayed: the server's longest wait between two attempts. */
const MAX_DELAY_SECONDS = 3600;

/** How long past its delay a wake-up is retried before the hourly round is left to it. */
const RETRY_SECONDS = 3600;

/**
 * The server's round may take four and a half minutes
 * (`webhookTriggerTimeout`); the call gives up a little before the function
 * does, and the queue delivers the message again.
 */
const DELIVER_TIMEOUT_MS = 285_000;

/**
 * When a wake-up received at `now` is delivered: at the end of the second it
 * is due in, never before.
 *
 * The queue drops a second message with the key of one it holds, also after
 * that one was delivered. So a key must not be reused for an event stored
 * after its message went out: the message of a second goes out when the
 * second is over, and whatever is stored later gets the next second's key.
 */
export function wakeSchedule(projectId: string, now: number, notBefore?: number): WakeSchedule {
  const due = Math.min(Math.max(now, notBefore ?? now), now + MAX_DELAY_SECONDS * 1000);
  const second = Math.floor(due / 1000) + 1;
  const delay = Math.max(1, Math.ceil((second * 1000 - now) / 1000));
  return {
    delay_seconds: delay,
    idempotency_key: `${projectId}:${second}`,
    retention_seconds: delay + RETRY_SECONDS,
  };
}

/**
 * The server's wake hook: `POST` of `{ project_id, not_before? }` with
 * `WEBHOOK_WAKE_SECRET` as its bearer token. Answers 202 once the queue has
 * the message. Without the secret in the environment the hook is not live,
 * and the server is told so.
 */
export async function receiveWake(
  request: Request,
  queue: WakeQueue,
  now: number = Date.now(),
): Promise<Response> {
  const secret = process.env.WEBHOOK_WAKE_SECRET;
  if (!secret) {
    return failure(503, "cloud.not_live", "The webhook wake-up is not turned on here.");
  }
  if (!bearerIs(request, secret)) {
    return failure(401, "cloud.wake_unauthorized", "Only the server's wake hook calls this.");
  }
  const body: unknown = await request.json().catch(() => undefined);
  const wake = wakeOf(body);
  if (!wake) return failure(400, "cloud.invalid_wake", "Name the project by its id.");
  const notBefore = (body as { not_before?: unknown }).not_before;
  let due: number | undefined;
  if (notBefore !== undefined) {
    due = typeof notBefore === "string" ? Date.parse(notBefore) : Number.NaN;
    if (Number.isNaN(due)) {
      return failure(400, "cloud.invalid_wake", "not_before is an RFC 3339 time.");
    }
  }
  const schedule = wakeSchedule(wake.project_id, now, due);
  try {
    await queue.publish(wake, schedule);
  } catch (error) {
    // The server logs the refusal and leaves the hook alone for a while; the
    // next wake-up or the hourly round delivers.
    console.error(`webhook wake: publishing for ${wake.project_id} failed: ${String(error)}`);
    return failure(503, "cloud.queue_unavailable", "The wake-up could not be queued.");
  }
  return json({ project_id: wake.project_id, delay_seconds: schedule.delay_seconds }, 202);
}

/**
 * The queue's consumer: calls the server's delivery path for the project,
 * with `CRON_SECRET` as the hourly cron job does. Returning acknowledges the
 * message; a throw has the queue deliver it again. A message that names no
 * project is acknowledged, since no retry would mend it.
 */
export async function deliverWake(message: unknown): Promise<void> {
  const wake = wakeOf(message);
  if (!wake) {
    console.error("webhook wake: dropped a message that names no project");
    return;
  }
  const secret = process.env.CRON_SECRET;
  if (!secret)
    throw new Error("CRON_SECRET is not set: the server's trigger would refuse the call.");
  const url = new URL(TRIGGER_PATH, zitadelOrigin());
  url.searchParams.set(TRIGGER_PROJECT, wake.project_id);
  const answer = await fetch(url, {
    method: "POST",
    headers: passProtection(new Headers({ authorization: `Bearer ${secret}` })),
    signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
  });
  if (!answer.ok) {
    throw new Error(`The server answered POST ${TRIGGER_PATH} with ${answer.status}.`);
  }
}

/**
 * Where the consumer reaches the server. The queue's call carries no public
 * origin to take it from, as an RPC's request does (`zitadelServer`), so it
 * is the deployment's own: the production domain in production, else the
 * deployment's URL. The local loops name the server in `CLOUD_ZITADEL_URL`.
 */
function zitadelOrigin(): string {
  if (process.env.CLOUD_ZITADEL_URL) return process.env.CLOUD_ZITADEL_URL;
  const host =
    (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    process.env.VERCEL_URL;
  if (!host) throw new Error("No URL of the Zitadel server: set CLOUD_ZITADEL_URL.");
  return `https://${host}`;
}

function wakeOf(value: unknown): WebhookWake | undefined {
  const id = (value as { project_id?: unknown } | null)?.project_id;
  return typeof id === "string" && PROJECT_ID.test(id) ? { project_id: id } : undefined;
}

/** Compares digests, so the time taken says nothing about the secret, its length included. */
function bearerIs(request: Request, secret: string): boolean {
  const [scheme, token] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(secret));
}
