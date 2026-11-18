import { addon } from "@/addon";

/**
 * The console's custom events, as docs/product-analytics-events.yaml defines
 * them. The console hands them to the build's add-on (`src/addon`): the hosted
 * cloud's sends them to Vercel Web Analytics. Every other build, the one the
 * Go server embeds included, has none that takes them, so they go nowhere.
 */
type Events = {
  copied_command: { page: "projects"; snippet: "setup" };
  // Root ADR 086 §9. Never the token, the link, the metadata or the
  // invitation's id: the journey id is random and names no resource.
  invitation_created: InvitationEvent;
  invitation_accepted: InvitationEvent;
  invitation_rejected: InvitationEvent;
};

/** `role` is the type and its role combined: `project_editor`. */
type InvitationEvent = { role: string; invitation_journey_id: string };

/** Reports `event`; the add-on adds the header every console event carries. */
export function trackEvent<E extends keyof Events>(event: E, properties: Events[E]): void {
  addon.track?.(event, properties);
}
