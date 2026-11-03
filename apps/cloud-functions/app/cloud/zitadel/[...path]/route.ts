import { checkBotId } from "botid/server";

import { forwardSignIn } from "@/sign-in";

// The sign-in widget's calls, forwarded to the server after BotID's check
// (src/sign-in.ts). checkBotId reads the Vercel Function's request, so it
// needs no argument here.
const forward = (request: Request) => forwardSignIn(request, () => checkBotId());

// In the server's region (fra1, repo-root vercel.json): every call here
// reads from it or forwards to it.
export const preferredRegion = "fra1";

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
