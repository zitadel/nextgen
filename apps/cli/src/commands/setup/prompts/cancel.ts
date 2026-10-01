import { bailOnCancel } from "../../../lib/prompt-cancel";

/**
 * Converts a clack cancellation (Ctrl-C) into a thrown `E_VALIDATION` rather
 * than a partial answer. Every prompt funnels its clack return value through
 * this so the wizard never proceeds with a sentinel or missing value.
 */
export function bail<T>(value: T | symbol): asserts value is T {
  bailOnCancel(value, "Setup");
}
