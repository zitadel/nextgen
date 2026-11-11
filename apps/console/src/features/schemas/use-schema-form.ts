import { useCallback, useMemo, useState } from "react";

import { errorFieldNames } from "@/lib/api-error";
import {
  type ObjectDraft,
  pathOfNamedField,
  type SchemaFormMode,
  validateDraft,
} from "./schema-form";
import type { ObjectField } from "@/features/schemas/model";

/** A value the input cannot read back, such as a partly cleared date. */
const UNREADABLE_MESSAGE = "Enter a complete date.";
/** A field the server's message named. The message itself stays beside the action. */
const REFUSED_MESSAGE = "The server refused this value.";

interface FormState {
  root: ObjectField;
  initial: ObjectDraft;
  draft: ObjectDraft;
  /** Fields changed since they last lost focus, whose blur reveals their error. */
  edited: Set<string>;
  /** Fields showing their error; each leaves once it has none left to show. */
  revealed: Set<string>;
  unreadable: Set<string>;
  refused: Set<string>;
  /** Errors a submit revealed: focus goes to the first, so none is also announced. */
  revealedBySubmit: Set<string>;
  /** Counts submit attempts; a new one moves focus to the first invalid field. */
  attempts: number;
}

function freshState(root: ObjectField, initial: ObjectDraft): FormState {
  return {
    root,
    initial,
    draft: initial,
    edited: new Set(),
    revealed: new Set(),
    unreadable: new Set(),
    refused: new Set(),
    revealedBySubmit: new Set(),
    attempts: 0,
  };
}

function withEntry(set: Set<string>, entry: string): Set<string> {
  return set.has(entry) ? set : new Set(set).add(entry);
}

function withoutEntry(set: Set<string>, entry: string): Set<string> {
  if (!set.has(entry)) return set;
  const next = new Set(set);
  next.delete(entry);
  return next;
}

/** A set without a path and the groups around it: editing a child answers its group. */
function withoutPathAndAncestors(set: Set<string>, path: string): Set<string> {
  const next = new Set([...set].filter((entry) => entry !== path && !path.startsWith(`${entry}.`)));
  return next.size === set.size ? set : next;
}

/** A set without a path and whatever sits under it. */
function withoutSubtree(set: Set<string>, path: string): Set<string> {
  const next = new Set([...set].filter((entry) => entry !== path && !entry.startsWith(`${path}.`)));
  return next.size === set.size ? set : next;
}

function isAtOrUnder(entry: string, path: string): boolean {
  return entry === path || entry.startsWith(`${path}.`);
}

/** What the rendered fields need from their form. */
export interface SchemaFormControls {
  mode: SchemaFormMode;
  /** Inside an array, which is written whole: `null` is an answer there on edit too. */
  inArray?: boolean;
  /** The error a field shows now: when it was revealed by a blur or a submit. */
  errorFor: (path: string) => string | undefined;
  /**
   * Whether what it shows reaches a screen reader another way, so it must not be
   * a second alert: a refusal's mark by the server's own message, and a submit's
   * error by focus moving to the first of them, which describes itself.
   */
  isSilentError: (path: string) => boolean;
  /** Whether a group around this field was refused, which makes the field invalid too. */
  inRefusedGroup: (path: string) => boolean;
  /** Whether this field or one inside it shows an error now, which a closed group must not hide. */
  showsErrorWithin: (path: string) => boolean;
  /** Whether this field or one inside it would stop a submit, shown yet or not. */
  hasProblemWithin: (path: string) => boolean;
  /** Records an edit, and hides what the server said about the old value. */
  noteEdit: (path: string) => void;
  /** A blur: reveals the field's error if it was edited. */
  noteBlur: (path: string) => void;
  /** Reveals a field's error at once, for a control with no typing to wait out. */
  reveal: (path: string) => void;
  noteUnreadable: (path: string, unreadable: boolean) => void;
  /** Forgets a removed row: nothing renders it, so nothing may stand in its name. */
  forget: (path: string) => void;
  attempts: number;
}

/**
 * A schema form's draft and the timing of its errors: on blur after an edit and on
 * submit, then live while they are corrected.
 *
 * Starts over whenever `root` or `initial` changes identity: another schema was
 * picked, or a save reloaded the user.
 */
export function useSchemaForm(root: ObjectField, initial: ObjectDraft, mode: SchemaFormMode) {
  const [state, setState] = useState(() => freshState(root, initial));
  let current = state;
  if (state.root !== root || state.initial !== initial) {
    current = freshState(root, initial);
    setState(current);
  }

  const errors = useMemo(() => {
    const found = validateDraft(
      current.root,
      current.draft,
      mode,
      mode === "edit" ? current.initial : undefined,
    );
    for (const path of current.unreadable) found.set(path, UNREADABLE_MESSAGE);
    return found;
  }, [current.root, current.draft, current.initial, current.unreadable, mode]);

  // Corrected: a later slip here waits for a blur, like any other field's.
  const corrected = [...current.revealed].filter((path) => !errors.has(path));
  if (corrected.length > 0) {
    current = {
      ...current,
      revealed: new Set([...current.revealed].filter((path) => errors.has(path))),
    };
    setState(current);
  }

  const setDraft = useCallback((draft: ObjectDraft) => {
    setState((previous) => ({ ...previous, draft }));
  }, []);

  /** Reveals every error, and says whether there are none to stop a submit. */
  const attemptSubmit = useCallback(() => {
    setState((previous) => ({
      ...previous,
      revealed: new Set([...previous.revealed, ...errors.keys()]),
      revealedBySubmit: new Set(errors.keys()),
      attempts: previous.attempts + 1,
    }));
    return errors.size === 0;
  }, [errors]);

  /** Marks the fields a failed request's response named, on top of its message. */
  const applyServerError = useCallback((cause: unknown) => {
    const names = errorFieldNames(cause);
    setState((previous) => ({
      ...previous,
      refused: new Set(
        names.flatMap((name) => pathOfNamedField(previous.root, previous.draft, name) ?? []),
      ),
      // In a long form the field may be scrolled away from the submit button.
      attempts: previous.attempts + 1,
    }));
  }, []);

  const { revealed, refused, revealedBySubmit, attempts } = current;
  const controls = useMemo<SchemaFormControls>(
    () => ({
      mode,
      errorFor: (path) => {
        const error = errors.get(path);
        if (error && revealed.has(path)) return error;
        return refused.has(path) ? REFUSED_MESSAGE : undefined;
      },
      isSilentError: (path) =>
        revealedBySubmit.has(path) ||
        (refused.has(path) && !(errors.has(path) && revealed.has(path))),
      inRefusedGroup: (path) => [...refused].some((entry) => path.startsWith(`${entry}.`)),
      showsErrorWithin: (path) =>
        [...refused, ...[...errors.keys()].filter((entry) => revealed.has(entry))].some((entry) =>
          isAtOrUnder(entry, path),
        ),
      hasProblemWithin: (path) =>
        [...refused, ...errors.keys()].some((entry) => isAtOrUnder(entry, path)),
      noteEdit: (path) =>
        setState((previous) => ({
          ...previous,
          edited: withEntry(previous.edited, path),
          refused: withoutPathAndAncestors(previous.refused, path),
          revealedBySubmit: withoutEntry(previous.revealedBySubmit, path),
        })),
      noteBlur: (path) =>
        setState((previous) =>
          previous.edited.has(path)
            ? { ...previous, revealed: withEntry(previous.revealed, path) }
            : previous,
        ),
      reveal: (path) =>
        setState((previous) => ({
          ...previous,
          revealed: withEntry(previous.revealed, path),
          refused: withoutPathAndAncestors(previous.refused, path),
          revealedBySubmit: withoutEntry(previous.revealedBySubmit, path),
        })),
      noteUnreadable: (path, unreadable) =>
        setState((previous) => ({
          ...previous,
          edited: unreadable ? withEntry(previous.edited, path) : previous.edited,
          unreadable: unreadable
            ? withEntry(previous.unreadable, path)
            : withoutEntry(previous.unreadable, path),
        })),
      forget: (path) =>
        setState((previous) => ({
          ...previous,
          edited: withoutSubtree(previous.edited, path),
          revealed: withoutSubtree(previous.revealed, path),
          revealedBySubmit: withoutSubtree(previous.revealedBySubmit, path),
          unreadable: withoutSubtree(previous.unreadable, path),
          refused: withoutSubtree(previous.refused, path),
        })),
      attempts,
    }),
    [mode, errors, revealed, refused, attempts],
  );

  return { draft: current.draft, setDraft, attemptSubmit, applyServerError, controls };
}
