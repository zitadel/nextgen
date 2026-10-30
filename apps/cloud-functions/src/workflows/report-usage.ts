import type { UsageRecord, UsageWindow } from "../ports";
import { currentSystems } from "../systems";

/**
 * How many complete hours a run reports. The cron fires hourly and Stripe
 * counts a re-sent hour once (its `identifier`), so two missed runs lose
 * nothing and a doubled one adds nothing.
 */
export const HOURS_PER_RUN = 3;

/**
 * Every team's usage of the last complete hours before `until`, read from
 * Zitadel and sent to Stripe's meters (root ADR 084 §6). Pulled as counts,
 * never pushed per sign-in. `until` comes from the cron route, so a replayed
 * run reports the same hours.
 */
export async function reportUsage(until: string): Promise<void> {
  "use workflow";
  for (const hour of lastHours(until, HOURS_PER_RUN)) {
    const records = await readUsage(hour);
    if (records.length > 0) await sendUsage(records);
  }
}

/** The `count` complete UTC hours before `until`, oldest first. */
export function lastHours(until: string, count: number): UsageWindow[] {
  const end = new Date(until);
  end.setUTCMinutes(0, 0, 0);
  const hours: UsageWindow[] = [];
  for (let offset = count; offset > 0; offset--) {
    const start = new Date(end.getTime() - offset * 3_600_000);
    hours.push({
      start: start.toISOString(),
      end: new Date(start.getTime() + 3_600_000).toISOString(),
    });
  }
  return hours;
}

async function readUsage(hour: UsageWindow): Promise<UsageRecord[]> {
  "use step";
  return currentSystems().zitadel.usage(hour);
}

async function sendUsage(records: UsageRecord[]): Promise<void> {
  "use step";
  await currentSystems().stripe.reportUsage(records);
}
