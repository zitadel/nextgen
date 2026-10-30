import { failure } from "./request";
import { routes } from "./routes";
import { workflowRuntime } from "./runtime";
import { NotLiveError } from "./systems";

/** Answers `/cloud/api/*` from the route table, by method and path. */
export async function handleRpc(request: Request): Promise<Response> {
  const route = routes[`${request.method} ${new URL(request.url).pathname}`];
  if (!route) return failure(404, "cloud.not_found", "The cloud's functions have no such call.");
  try {
    return await route(request, workflowRuntime());
  } catch (error) {
    if (error instanceof NotLiveError) return failure(503, "cloud.not_live", error.message);
    throw error;
  }
}
