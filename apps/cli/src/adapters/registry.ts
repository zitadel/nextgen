import type { FrameworkId } from "../detect/framework";
import type { FrameworkAdapter } from "./index";
import { NextAdapter } from "./next/adapter";

const adapters: Record<FrameworkId, FrameworkAdapter> = {
  next: new NextAdapter(),
};

/**
 * Returns the {@link FrameworkAdapter} for a detected {@link FrameworkId}.
 * Indexed by the closed `FrameworkId` union so every member is guaranteed
 * present in the registry, letting callers treat the result as non-nullable.
 */
export function getAdapter(id: FrameworkId): FrameworkAdapter {
  return adapters[id];
}
