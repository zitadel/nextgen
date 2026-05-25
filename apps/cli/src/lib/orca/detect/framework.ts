import { detectFramework as baseDetectFramework } from "../../../detect/framework";
import type { FrameworkDetection } from "../../../detect/framework";

/**
 * Attempts to detect the framework in use without throwing.
 * Returns `null` if no supported framework is found, rather than raising an error.
 * Used by the Orca orchestrator to decide whether to scaffold or patch.
 */
export async function tryDetectFramework(cwd: string): Promise<FrameworkDetection | null> {
  try {
    return await baseDetectFramework(cwd);
  } catch {
    return null;
  }
}
