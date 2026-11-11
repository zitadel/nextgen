import { api } from "@/api/zitadel";
import { errorCode } from "@/lib/api-error";

import type { ProjectUsage, UsagePeriod } from "./model";

/** Reads the project's usage of the period by day; `usage.disabled` is an answer, not an error. */
export async function readProjectUsage(
  projectId: string,
  period: UsagePeriod,
): Promise<ProjectUsage> {
  try {
    const usage = await api.getUsage({
      project_id: projectId,
      from: period.from,
      to: period.to,
      granularity: "day",
    });
    return { counted: true, usage };
  } catch (cause) {
    if (errorCode(cause) === "usage.disabled") return { counted: false };
    throw cause;
  }
}
