import { api } from "@/api/zitadel";

import { createBody, type Webhook, WEBHOOK_LIMIT, type WebhookDraft } from "./model";

/**
 * Every webhook of the project, newest first. One page: a project holds at
 * most {@link WEBHOOK_LIMIT}, so there is nothing to load after it.
 */
export async function listWebhooks(projectId: string): Promise<Webhook[]> {
  const page = await api.listWebhooks({ project_id: projectId, limit: WEBHOOK_LIMIT });
  return page.data;
}

/**
 * A new webhook's signing secret, or a rotated one's: the one value of
 * either response a caller keeps. The server returns it this once, so it goes
 * straight to the dialog that shows it (`WebhookSecretDialog`) and is held
 * nowhere else: not with the webhook the loader reads, not in the URL.
 */
export async function createWebhook(projectId: string, draft: WebhookDraft): Promise<string> {
  const created = await api.createWebhook(createBody(draft), { project_id: projectId });
  return created.secret;
}

/** As {@link createWebhook}: the new secret alone. The previous one signs for 24 hours more. */
export async function rotateWebhookSecret(projectId: string, webhookId: string): Promise<string> {
  const rotated = await api.rotateWebhookSecret(webhookId, { project_id: projectId });
  return rotated.secret;
}
