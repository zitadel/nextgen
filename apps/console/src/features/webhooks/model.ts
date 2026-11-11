import type {
  CreateWebhookBody,
  ListWebhooks200DataItem,
  UpdateWebhookBody,
} from "@zitadel/api/generated/model";

import { errorFieldNames, errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/date";

/** A project's webhook, as `GET /webhooks` and `GET /webhooks/{id}` return it: never with its secret. */
export type Webhook = ListWebhooks200DataItem;

/** How many webhooks a project holds at most; one more answers `webhook.limit_reached`. */
export const WEBHOOK_LIMIT = 10;

/** What the list says, and why Add is held, once a project holds {@link WEBHOOK_LIMIT}. */
export const LIMIT_REACHED = `This project has ${WEBHOOK_LIMIT} webhooks, the most it can hold. Delete one to add another.`;

/** The one entry that stands for every event type. */
export const ALL_EVENT_TYPES = "*";

/**
 * A webhook's state. The API has no status field (it would restate three
 * others), so this is where it is worked out:
 *
 * - `disabled`: `enabled` is off, and its last attempt had not failed.
 * - `stopped`: `enabled` is off and its last attempt failed, which is how
 *   the server leaves a webhook it gave up on (3 days of failures, or a `410`).
 * - `failing`: its last attempt failed, and the server is retrying.
 * - `active`: it delivers, or has had nothing to deliver yet.
 */
export type WebhookState = "active" | "failing" | "disabled" | "stopped";

type Delivery = Pick<Webhook, "enabled" | "last_delivered_at" | "last_error_at">;

/**
 * Whether the webhook's last attempt failed: `last_error_at` is later than
 * `last_delivered_at`, or set while nothing was delivered yet. A later success
 * does not clear `last_error_at`, so it is compared and never read on its own.
 */
export function lastAttemptFailed(webhook: Omit<Delivery, "enabled">): boolean {
  if (webhook.last_error_at === null) return false;
  if (webhook.last_delivered_at === null) return true;
  return Date.parse(webhook.last_error_at) > Date.parse(webhook.last_delivered_at);
}

export function webhookState(webhook: Delivery): WebhookState {
  const failed = lastAttemptFailed(webhook);
  if (!webhook.enabled) return failed ? "stopped" : "disabled";
  return failed ? "failing" : "active";
}

/** A state as the list and the webhook's page name it. */
export const STATE_LABEL: Record<WebhookState, string> = {
  active: "Active",
  failing: "Failing",
  disabled: "Disabled",
  stopped: "Disabled after repeated failures",
};

/**
 * The failed attempt behind a failing or stopped webhook, in one sentence:
 * when it was, and the status the endpoint answered with, or that it did not
 * answer (`last_error_status` is `null` for a refused connection and for a
 * timeout alike). `undefined` while the last attempt did not fail.
 */
export function lastError(
  webhook: Pick<Webhook, "last_delivered_at" | "last_error_at" | "last_error_status">,
): string | undefined {
  if (!lastAttemptFailed(webhook) || webhook.last_error_at === null) return undefined;
  const answer =
    webhook.last_error_status === null
      ? "got no response"
      : `was answered with ${webhook.last_error_status}`;
  return `The attempt on ${formatDateTime(webhook.last_error_at)} ${answer}.`;
}

/**
 * What a webhook receives, in a cell: `All events` for `*`, one type by its
 * name, and several by their number, which the webhook's page lists.
 */
export function describeEventTypes(eventTypes: readonly string[]): string {
  if (eventTypes.includes(ALL_EVENT_TYPES)) return "All events";
  return eventTypes.length === 1 ? (eventTypes[0] ?? "") : `${eventTypes.length} event types`;
}

/** Whether a rotation is in progress: the secret it replaced still signs deliveries. */
export function rotationInProgress(
  webhook: Pick<Webhook, "previous_secret_expires_at">,
  now: Date = new Date(),
): webhook is { previous_secret_expires_at: string } {
  const expires = webhook.previous_secret_expires_at;
  return expires !== null && Date.parse(expires) > now.getTime();
}

/** A webhook as its form holds it. */
export interface WebhookDraft {
  url: string;
  description: string;
  /** `All events`, in place of a selection; the selection is kept for a change of mind. */
  all: boolean;
  types: string[];
}

export const EMPTY_DRAFT: WebhookDraft = { url: "", description: "", all: true, types: [] };

export function draftOf(
  webhook: Pick<Webhook, "url" | "description" | "event_types">,
): WebhookDraft {
  const all = webhook.event_types.includes(ALL_EVENT_TYPES);
  return {
    url: webhook.url,
    description: webhook.description,
    all,
    types: all ? [] : [...webhook.event_types],
  };
}

function draftEventTypes(draft: WebhookDraft): string[] {
  return draft.all ? [ALL_EVENT_TYPES] : draft.types;
}

/** Whether the draft can be sent: it names a URL, and all events or at least one type. */
export function isComplete(draft: WebhookDraft): boolean {
  return draft.url.trim() !== "" && (draft.all || draft.types.length > 0);
}

export function createBody(draft: WebhookDraft): CreateWebhookBody {
  const description = draft.description.trim();
  return {
    url: draft.url.trim(),
    event_types: draftEventTypes(draft),
    ...(description !== "" && { description }),
  };
}

/**
 * The fields the draft changes, and nothing else: the server checks the
 * types it is sent against those it writes, so a webhook that still lists a
 * retired type keeps saving its URL. `undefined` when nothing changed, since
 * the server refuses an empty body.
 */
export function updateBody(
  webhook: Pick<Webhook, "url" | "description" | "event_types">,
  draft: WebhookDraft,
): UpdateWebhookBody | undefined {
  const body: UpdateWebhookBody = {};
  const url = draft.url.trim();
  const description = draft.description.trim();
  const eventTypes = draftEventTypes(draft);
  if (url !== webhook.url) body.url = url;
  if (description !== webhook.description) body.description = description;
  if (!sameTypes(eventTypes, webhook.event_types)) body.event_types = eventTypes;
  return Object.keys(body).length > 0 ? body : undefined;
}

function sameTypes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((type) => b.includes(type));
}

/** The form's fields a refusal can land on. */
export type WebhookField = "url" | "description" | "event_types";

/** A refused save: the server's message, and the field it names when it names one of the form's. */
export interface WebhookRefusal {
  message: string;
  field?: WebhookField;
}

const FIELDS: readonly WebhookField[] = ["url", "description", "event_types"];

/**
 * A failed create or update, for the form: the server's own message (ADR
 * 030), on the field its details name. `webhook.invalid` names the one field
 * its check stopped at, an entry of the list as `event_types[2]`; a body the
 * contract itself refuses names its fields the same way. A refusal that names
 * none of the form's fields, the limit among them, belongs to the form.
 */
export function webhookRefusal(cause: unknown, fallback: string): WebhookRefusal {
  const message = errorMessage(cause, fallback);
  const named = errorFieldNames(cause).map((name) => name.replace(/\[.*$/, ""));
  const field = FIELDS.find((known) => named.includes(known));
  return field ? { message, field } : { message };
}
