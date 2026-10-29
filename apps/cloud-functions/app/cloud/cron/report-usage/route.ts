import { start } from "workflow/api";

import { failure, json } from "@/request";
import { NotLiveError, currentSystems } from "@/systems";
import { reportUsage } from "@/workflows/report-usage";

/**
 * Vercel Cron, hourly (repo-root vercel.json): starts the usage report for
 * the hours before now (root ADR 083 §6). Cron runs in production only and
 * may skip or repeat a run; the report re-sends recent hours, so neither
 * matters.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return failure(401, "cloud.cron_unauthorized", "Only Vercel Cron starts this.");
  }
  try {
    currentSystems();
    const run = await start(reportUsage, [new Date().toISOString()]);
    return json({ run_id: run.runId });
  } catch (error) {
    if (error instanceof NotLiveError) return failure(503, "cloud.not_live", error.message);
    throw error;
  }
}
