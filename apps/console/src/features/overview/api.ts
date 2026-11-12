import { api } from "@/api/zitadel";
import { type Deployment, livePrimaryDeployment } from "@/features/deployments/deployment";
import { listRecentEvents } from "@/features/events/api";
import type { ProjectEvent } from "@/features/events/model";
import { describeError } from "@/lib/api-error";

/**
 * Reads behind a project's Overview (D35): the project, what its primary
 * origins serve now, and its newest audit events.
 *
 * The project read is the page's: without it there is nothing to head the
 * page with, so its failure is the page's. Each card's read fails on its own
 * and says so in its card, as the password policy's does on Settings, since a
 * person who may not read deployments or events still has the rest to see.
 */

/** How many events the activity card lists before it hands over to Events. */
const RECENT_EVENTS = 5;

/** A card's read: what it shows, or why it shows nothing. */
export type CardRead<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

type OverviewProject = Awaited<ReturnType<typeof api.getProject>>;

interface ProjectOverview {
  project: OverviewProject;
  /** The deployment the primary origins serve, `undefined` while none does. */
  live: CardRead<Deployment | undefined>;
  /** The newest audit events, newest first. */
  activity: CardRead<ProjectEvent[]>;
}

export async function loadProjectOverview(projectId: string): Promise<ProjectOverview> {
  const [project, live, activity] = await Promise.all([
    api.getProject(projectId),
    settle(livePrimaryDeployment(projectId), "What is live could not be read."),
    settle(listRecentEvents(projectId, RECENT_EVENTS), "Recent activity could not be read."),
  ]);
  return { project, live, activity };
}

function settle<T>(read: Promise<T>, fallback: string): Promise<CardRead<T>> {
  return read.then(
    (value): CardRead<T> => ({ value }),
    (cause: unknown): CardRead<T> => ({ error: describeError(cause, fallback) }),
  );
}
