import { handleRpc } from "@/rpc";

// The console's add-on calls (src/contract.ts), answered from src/routes.ts.
// In the server's region (fra1, repo-root vercel.json): every call here
// reads from it or forwards to it.
export const preferredRegion = "fra1";

export const GET = handleRpc;
export const POST = handleRpc;
export const PUT = handleRpc;
