import { z } from "zod";

import { GetInvitationParams } from "@/lib/backend/schemas";

/**
 * An invitation id as the API spells one, trimmed as a prompt would take it.
 * `get`, `cancel` and `create --replaces` each refuse with wording of their own.
 */
export const invitationIdSchema = z.string().trim().pipe(GetInvitationParams.shape.id);
