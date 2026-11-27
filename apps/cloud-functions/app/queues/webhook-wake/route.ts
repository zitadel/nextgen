import { handleCallback } from "@vercel/queue";

import { deliverWake } from "@/webhook-wake";

// The consumer of the wake-up queue (src/webhook-wake.ts), which repo-root
// vercel.json subscribes to the topic. Outside /cloud/, as the Workflow SDK's
// routes are: only the queue calls it, and no rewrite leads here.
export const preferredRegion = "fra1";

// The server's round may take four and a half minutes.
export const maxDuration = 300;

export const POST = handleCallback((message) => deliverWake(message));
