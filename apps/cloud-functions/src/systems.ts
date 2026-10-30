import { mockSystems } from "./mock";
import type { Systems } from "./ports";

/** Production asked for a system that only exists as a mock so far. */
export class NotLiveError extends Error {
  constructor() {
    super("The cloud's functions only answer from mocks so far (root ADR 084 §9).");
    this.name = "NotLiveError";
  }
}

let systems: Systems | undefined;

/**
 * The systems this deployment talks to (root ADR 084 §2). Only the mocks
 * exist yet; the live adapters replace them system by system. Production
 * refuses to answer from them, since billing no one and dropping tickets
 * would look like it worked.
 */
export function currentSystems(): Systems {
  if (process.env.VERCEL_ENV === "production") throw new NotLiveError();
  systems ??= mockSystems();
  return systems;
}
