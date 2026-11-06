import { useCallback, useState } from "react";

/** The pinned properties of each schema, by schema id. */
export type ColumnPins = Record<string, string[]>;

/**
 * Pinned columns live in the viewer's browser, per project: a pin is a viewing
 * preference, not project configuration, and schema ids are unique per project
 * only.
 */
const PINS_STORAGE_KEY = "zl-console-users-columns";

function pinsStorageKey(projectId: string): string {
  return `${PINS_STORAGE_KEY}:${projectId}`;
}

/**
 * The viewer's pinned columns for a project. Nothing is pinned when storage is
 * unavailable (privacy mode, a blocked origin) or holds something unreadable.
 */
export function readColumnPins(projectId: string): ColumnPins {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(pinsStorageKey(projectId)) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const pins: ColumnPins = {};
    for (const [schemaId, keys] of Object.entries(stored)) {
      if (!Array.isArray(keys)) continue;
      pins[schemaId] = keys.filter((key): key is string => typeof key === "string");
    }
    return pins;
  } catch {
    return {};
  }
}

/** Persists the viewer's pinned columns. A failed write keeps them for this visit only. */
export function writeColumnPins(projectId: string, pins: ColumnPins): void {
  try {
    localStorage.setItem(pinsStorageKey(projectId), JSON.stringify(pins));
  } catch {
    /* storage unavailable: the pins last until the page is left */
  }
}

/**
 * The viewer's pinned columns for the selected project, kept in their browser
 * (`readColumnPins`). A toggle takes effect at once and is persisted when it
 * can be; without storage it lasts until the page is left.
 */
export function useColumnPins(
  projectId: string,
): [ColumnPins, (schemaId: string, key: string) => void] {
  const [state, setState] = useState(() => ({ projectId, pins: readColumnPins(projectId) }));
  // Switching project swaps in that project's pins rather than carrying over
  // another project's: schema ids are unique per project only. Read once, as
  // the render that sees the new project adjusts the state.
  if (state.projectId !== projectId) {
    setState({ projectId, pins: readColumnPins(projectId) });
  }

  const toggle = useCallback(
    (schemaId: string, key: string) => {
      const current = state.pins[schemaId] ?? [];
      const pins = {
        ...state.pins,
        [schemaId]: current.includes(key)
          ? current.filter((pinned) => pinned !== key)
          : [...current, key],
      };
      writeColumnPins(state.projectId, pins);
      setState({ projectId: state.projectId, pins });
    },
    [state],
  );

  return [state.pins, toggle];
}
