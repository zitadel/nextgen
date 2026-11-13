import { wakeQueue } from "@/vercel/queue";
import { receiveWake } from "@/webhook-wake";

// The server's wake hook for project webhooks (src/webhook-wake.ts). In the
// server's region (fra1, repo-root vercel.json): a queue is regional, and
// its consumer calls the server.
export const preferredRegion = "fra1";

export const POST = (request: Request) => receiveWake(request, wakeQueue());
