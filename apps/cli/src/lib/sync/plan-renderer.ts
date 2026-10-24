import { createHash } from "node:crypto";

import { escapeControlCharacters } from "../api-client";
import { stableStringify } from "../json";
import type { ResourceSyncer, SyncAction, SyncActionWarning, SyncPlanSummary } from "./types.js";

/**
 * Count the non-`skip` actions in a {@link buildSyncPlan} result. Pure; the
 * single source of truth for the plan counts shared by the `plan` /
 * `apply --dry-run` JSON payload and {@link renderPlan}'s summary line.
 */
export function summarizePlan(actions: ReadonlyArray<SyncAction>): SyncPlanSummary {
  const active = actions.filter((a) => a.kind !== "skip");
  const moved = (a: SyncAction) => a.kind === "create" && a.movedFrom !== undefined;
  return {
    creates: active.filter((a) => a.kind === "create" && !moved(a)).length,
    updates: active.filter((a) => a.kind === "update").length,
    revisions: active.filter((a) => a.kind === "revise").length,
    deletes: active.filter((a) => a.kind === "delete").length,
    moves: active.filter(moved).length,
    unsupported_deletions: actions.filter(isUnsupportedDeletion).length,
    total: active.length,
  };
}

/** A removed file whose resource the platform cannot delete yet; planned as a skip. */
export type UnsupportedDeletion = Extract<
  SyncAction,
  { kind: "skip"; reason: "unsupported-deletion" }
>;

/** Whether an action is a removed file that will be kept on the platform. */
export function isUnsupportedDeletion(action: SyncAction): action is UnsupportedDeletion {
  return action.kind === "skip" && action.reason === "unsupported-deletion";
}

/** What to tell the developer about one removed file, in a plan and in an apply. */
export function unsupportedDeletionNote(action: UnsupportedDeletion): string {
  const note = action.syncer.deletionNote?.(action.path);
  if (note !== undefined) {
    return note;
  }
  return (
    `${action.path} was removed, but deleting ${action.syncer.kind} resources is not supported yet (#1013), ` +
    `so nothing was deleted on the platform. Restore the file if you did not mean to remove it.`
  );
}

/**
 * Collect the plan-time validation warnings across all actions, tagged
 * with the file they belong to. Feeds the `plan` / `apply --dry-run`
 * `--json` payload so agents can read warnings structurally.
 */
export function collectPlanWarnings(
  actions: ReadonlyArray<SyncAction>,
): Array<{ path: string; rule: string; message: string }> {
  const out: Array<{ path: string; rule: string; message: string }> = [];
  for (const action of actions) {
    for (const warning of warningsOf(action)) {
      out.push({ path: action.path, rule: warning.rule, message: warning.message });
    }
    if (isUnsupportedDeletion(action)) {
      out.push({
        path: action.path,
        rule: "unsupported-deletion",
        message: unsupportedDeletionNote(action),
      });
    }
  }
  return out;
}

/**
 * The warnings an action carries. Only the three kinds that upload a body can
 * have any: a `delete` has no content to judge, and a `skip` was never judged.
 */
function warningsOf(action: SyncAction): ReadonlyArray<SyncActionWarning> {
  return action.kind === "create" || action.kind === "update" || action.kind === "revise"
    ? (action.warnings ?? [])
    : [];
}

/**
 * One entry of the `changes` array in the `plan` / `apply` `--json`
 * payloads: which resource an action touches and how. `action` speaks the
 * envelope's public vocabulary (`revision`, matching the `revisions`
 * counter, not the internal `revise`). `id` is the platform id an
 * update/delete targets; `previous_id` is the revision being superseded.
 * The file path is the resource identity, mirroring {@link renderPlan}.
 */
export type PlanResourceChange = {
  kind: ResourceSyncer["kind"];
  action: "create" | "update" | "revision" | "delete" | "move";
  file: string;
  id?: string;
  previous_id?: string;
  /** For a move: the removed file the resource used to be in. */
  moved_from?: string;
};

/**
 * Enumerate the non-`skip` actions of a {@link buildSyncPlan} result as
 * envelope-ready {@link PlanResourceChange} rows. Pure; the structural
 * counterpart of {@link summarizePlan} — counts and rows always agree.
 */
export function enumeratePlanResources(actions: ReadonlyArray<SyncAction>): PlanResourceChange[] {
  const out: PlanResourceChange[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "create":
        out.push(
          action.movedFrom === undefined
            ? { kind: action.syncer.kind, action: "create", file: action.path }
            : {
                kind: action.syncer.kind,
                action: "move",
                file: action.path,
                moved_from: action.movedFrom,
              },
        );
        break;
      case "update":
        out.push({ kind: action.syncer.kind, action: "update", file: action.path, id: action.id });
        break;
      case "revise":
        out.push({
          kind: action.syncer.kind,
          action: "revision",
          file: action.path,
          previous_id: action.previousId,
        });
        break;
      case "delete":
        out.push({ kind: action.syncer.kind, action: "delete", file: action.path, id: action.id });
        break;
      case "skip":
        break;
    }
  }
  return out;
}

/**
 * Render a {@link buildSyncPlan} result as a human-readable Terraform-style
 * plan. TTY-aware: colors and bold are emitted only when `tty` is true.
 * Returns the empty-state message when every action is `skip`.
 *
 * @param actions - The action list produced by `buildSyncPlan`. Read-only;
 *   the function never mutates the input.
 * @param tty     - True when stdout is a TTY; controls ANSI emission.
 */
export function renderPlan(actions: ReadonlyArray<SyncAction>, tty: boolean): string {
  const active = actions.filter((a) => a.kind !== "skip");

  const unsupported = actions.filter(isUnsupportedDeletion);
  const unsupportedNote = unsupported.map((a) =>
    paint(`# ${unsupportedDeletionNote(a)}`, A.yellow, tty),
  );

  if (active.length === 0) {
    const headline =
      unsupported.length === 0
        ? "No changes. Your Zitadel configuration matches the current state."
        : `Nothing to apply, but ${unsupported.length} removed file${unsupported.length === 1 ? "" : "s"} cannot be deleted from the platform.`;
    return [paint(headline, A.bold, tty), ...unsupportedNote].join("\n");
  }

  const out: string[] = [];
  out.push(paint("Zitadel will perform the following actions:", A.bold, tty));

  for (const action of active) {
    out.push("");
    out.push(...renderBlock(action, tty));
  }

  out.push("");

  const { creates, updates, revisions, deletes, moves } = summarizePlan(actions);

  const parts: string[] = [];
  if (creates > 0) {
    parts.push(`${creates} to add`);
  }
  if (updates > 0) {
    parts.push(`${updates} to change`);
  }
  if (revisions > 0) {
    parts.push(`${revisions} new revision${revisions === 1 ? "" : "s"}`);
  }
  if (moves > 0) {
    parts.push(`${moves} moved`);
  }
  if (deletes > 0) {
    parts.push(`${deletes} to destroy`);
  }

  out.push(paint(`Plan: ${parts.join(", ")}.`, A.bold, tty));

  const warningCount = active.reduce((count, action) => count + warningsOf(action).length, 0);
  if (warningCount > 0) {
    out.push(
      paint(
        `Warnings: ${warningCount} (non-blocking — see the # warning lines above).`,
        A.yellow,
        tty,
      ),
    );
  }

  out.push(...unsupportedNote);
  return out.join("\n");
}

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
} as const;

function paint(text: string, code: string, tty: boolean): string {
  return tty ? `${code}${text}${A.reset}` : text;
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const KNOWN_AFTER_APPLY = "(known after apply)";

/**
 * Quote-escape a string value, then escape whatever could still drive the
 * terminal. The plan prints what the server stores, and `plan` and `apply`
 * read it verbatim so the diff sees the real bytes; this is
 * where it is made safe to print.
 */
function escapeString(s: string): string {
  return escapeControlCharacters(
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t"),
  );
}

/**
 * A field name as printed: a server-side key is as untrusted as a value.
 * Backslashes are doubled first, as `sanitizeResponse` does for keys, so a key
 * holding a raw ESC and one holding the literal text `\x1b` get two labels.
 */
function fieldLabel(key: string): string {
  return escapeControlCharacters(key.replaceAll("\\", "\\\\"), { keepLayout: false });
}

function fmtPrimitive(v: string | number | boolean | null): string {
  if (v === null) {
    return "null";
  }
  if (typeof v === "string" && v === KNOWN_AFTER_APPLY) {
    return KNOWN_AFTER_APPLY;
  }
  if (typeof v === "string") {
    return `"${escapeString(v)}"`;
  }
  return String(v);
}

/**
 * A multi-line string is a document, not a scalar: branding inlines a whole
 * `login.liquid` into `liquid_template`, and escaping 200 lines onto one
 * `"…\n…\n…"` line buries every real change in the same block. Such values
 * render as a summary (and, when they changed, as a line diff) instead.
 */
function isBlockString(v: unknown): v is string {
  return typeof v === "string" && v !== KNOWN_AFTER_APPLY && v.includes("\n");
}

/** Trailing-newline-insensitive line count: `"a\nb\n"` is two lines, not three. */
function lineCount(value: string): number {
  const lines = value.split("\n");
  return lines.length > 1 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

/** Short content fingerprint, so two summarised blocks can be told apart. */
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function blockSummary(value: string): string {
  return `(${plural(lineCount(value), "line")}, sha256:${shortHash(value)})`;
}

function unchangedBlockSummary(value: string): string {
  return `(unchanged, ${plural(lineCount(value), "line")}, sha256:${shortHash(value)})`;
}

/** {@link fmtPrimitive}, with multi-line strings summarised. */
function fmtScalar(v: string | number | boolean | null): string {
  return isBlockString(v) ? blockSummary(v) : fmtPrimitive(v);
}

/**
 * Indentation contract (matches Terraform exactly):
 *   prefixCol = column index of the +/-/~ character
 *   field content starts at prefixCol + 2  (one space gap after prefix)
 *   nested object/array content: prefixCol + 4 for the child prefixCol
 *   closing } or ]  : prefixCol + 2 columns of plain spaces, no prefix
 */
type ChangePrefix = "+" | "-" | "~" | " ";

function prefixAnsi(p: ChangePrefix): string {
  if (p === "+") {
    return A.green;
  }
  if (p === "-") {
    return A.red;
  }
  if (p === "~") {
    return A.yellow;
  }
  return "";
}

interface RenderCtx {
  tty: boolean;
  deleteMode: boolean;
}

function renderFields(
  obj: Record<string, unknown>,
  prefix: ChangePrefix,
  prefixCol: number,
  ctx: RenderCtx,
  lines: string[],
): void {
  const pad = " ".repeat(prefixCol);
  const ansi = prefixAnsi(prefix);
  const col = (s: string) => paint(s, ansi, ctx.tty);

  const keys = Object.keys(obj).sort();
  const maxLen = keys.reduce((m, k) => Math.max(m, fieldLabel(k).length), 0);

  for (const key of keys) {
    const val = obj[key];
    const pk = fieldLabel(key).padEnd(maxLen);

    if (isPrimitive(val)) {
      const formatted = fmtScalar(val);
      const suffix = ctx.deleteMode ? " -> null" : "";
      lines.push(col(`${pad}${prefix} ${pk} = ${formatted}${suffix}`));
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(col(`${pad}${prefix} ${pk} = []`));
      } else {
        lines.push(col(`${pad}${prefix} ${pk} = [`));
        renderArrayItems(val, prefix, prefixCol + 4, ctx, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}]`));
      }
    } else if (isPlainObject(val)) {
      if (Object.keys(val).length === 0) {
        lines.push(col(`${pad}${prefix} ${pk} = {}`));
      } else {
        lines.push(col(`${pad}${prefix} ${pk} = {`));
        renderFields(val, prefix, prefixCol + 4, ctx, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}}`));
      }
    }
  }
}

/**
 * Renders the items of an array. Unlike {@link renderFields}, primitive
 * elements never get a trailing ` -> null` suffix even under `deleteMode` —
 * Terraform only annotates scalar object-field removals that way, not array
 * items.
 */
function renderArrayItems(
  arr: ReadonlyArray<unknown>,
  prefix: ChangePrefix,
  prefixCol: number,
  ctx: RenderCtx,
  lines: string[],
): void {
  const pad = " ".repeat(prefixCol);
  const ansi = prefixAnsi(prefix);
  const col = (s: string) => paint(s, ansi, ctx.tty);

  for (const item of arr) {
    if (isPrimitive(item)) {
      const formatted = fmtScalar(item);
      lines.push(col(`${pad}${prefix} ${formatted},`));
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(col(`${pad}${prefix} [],`));
      } else {
        lines.push(col(`${pad}${prefix} [`));
        renderArrayItems(item, prefix, prefixCol + 4, ctx, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}],`));
      }
    } else if (isPlainObject(item)) {
      if (Object.keys(item).length === 0) {
        lines.push(col(`${pad}${prefix} {},`));
      } else {
        lines.push(col(`${pad}${prefix} {`));
        renderFields(item, prefix, prefixCol + 4, ctx, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}},`));
      }
    }
  }
}

/** Changed-line budget for one block-string diff, before the "more" trailer. */
const MAX_BLOCK_DIFF_LINES = 20;

/**
 * LCS cell budget (500 × 500 changed lines). Above it the middle section
 * renders as one remove/add block instead — quadratic DP over a pathological
 * template is not worth the memory, and a whole-block replace is still an
 * honest rendering. The shipped designs are under 200 lines *before* the
 * prefix/suffix trim, so real templates never come close.
 */
const MAX_LCS_CELLS = 250_000;

type LineOp = { kind: "same" | "del" | "add"; line: string };

function asLines(v: string | number | boolean | null): string[] {
  return typeof v === "string" ? v.split("\n") : [fmtPrimitive(v)];
}

/**
 * Line-level diff of two block strings. Common prefix and suffix are trimmed
 * first — a template edit touches one region, so this alone usually reduces
 * the problem to a handful of lines — and the remaining middle goes through
 * an LCS pass (or, past {@link MAX_LCS_CELLS}, renders as a wholesale
 * replacement).
 */
function diffLines(oldLines: readonly string[], newLines: readonly string[]): LineOp[] {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }

  const midOld = oldLines.slice(start, endOld);
  const midNew = newLines.slice(start, endNew);
  if (midOld.length * midNew.length > MAX_LCS_CELLS) {
    return [
      ...midOld.map((line): LineOp => ({ kind: "del", line })),
      ...midNew.map((line): LineOp => ({ kind: "add", line })),
    ];
  }
  return lcsDiff(midOld, midNew);
}

/** Classic LCS-length DP, walked back into an op list. */
function lcsDiff(a: readonly string[], b: readonly string[]): LineOp[] {
  const table: number[][] = [];
  // Reads past the filled edge are the recurrence's base case: an empty suffix, length 0.
  const cell = (i: number, j: number): number => table[i]?.[j] ?? 0;

  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    table[i] = row;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left === undefined || right === undefined) break;
    if (left === right) {
      ops.push({ kind: "same", line: left });
      i += 1;
      j += 1;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      ops.push({ kind: "del", line: left });
      i += 1;
    } else {
      ops.push({ kind: "add", line: right });
      j += 1;
    }
  }
  for (const line of a.slice(i)) ops.push({ kind: "del", line });
  for (const line of b.slice(j)) ops.push({ kind: "add", line });
  return ops;
}

/**
 * Render a changed block string as a header plus its changed lines. Context
 * lines are deliberately omitted: the file is on disk, and the plan's job is
 * to name what moved, not to reproduce the template.
 */
function renderBlockStringDiff(
  paddedKey: string,
  oldVal: string | number | boolean | null,
  newVal: string | number | boolean | null,
  prefixCol: number,
  tty: boolean,
  lines: string[],
): void {
  const pad = " ".repeat(prefixCol);
  const bodyPad = " ".repeat(prefixCol + 4);
  const changed = diffLines(asLines(oldVal), asLines(newVal)).filter((op) => op.kind !== "same");
  const total = typeof newVal === "string" ? lineCount(newVal) : 1;
  const fingerprints =
    typeof oldVal === "string" && typeof newVal === "string"
      ? `, sha256:${shortHash(oldVal)} -> sha256:${shortHash(newVal)}`
      : "";

  lines.push(
    paint(
      `${pad}~ ${paddedKey} = (${plural(changed.length, "line")} changed of ${total}${fingerprints})`,
      A.yellow,
      tty,
    ),
  );
  for (const op of changed.slice(0, MAX_BLOCK_DIFF_LINES)) {
    const del = op.kind === "del";
    const line = escapeControlCharacters(op.line);
    lines.push(paint(`${bodyPad}${del ? "-" : "+"} ${line}`, del ? A.red : A.green, tty));
  }
  const omitted = changed.length - MAX_BLOCK_DIFF_LINES;
  if (omitted > 0) {
    lines.push(`${bodyPad}  # (${plural(omitted, "more changed line")} not shown)`);
  }
}

/**
 * The keys that name an element of an array of objects. A flow's `steps` and
 * each step's `actions` are named by `name`, which the dialect requires to be
 * unique within its list; the others cover any later list of named objects.
 */
const ELEMENT_IDENTITY_KEYS = ["name", "id", "slug"] as const;

/**
 * The key that identifies every element of both arrays, or undefined when
 * there is none: every element must be an object carrying that key as a
 * string, unique within its array. Without one, elements can only be matched
 * by position, and a changed array renders as a whole remove + add.
 */
function elementIdentityKey(
  oldArr: ReadonlyArray<unknown>,
  newArr: ReadonlyArray<unknown>,
): string | undefined {
  const all = [...oldArr, ...newArr];
  if (all.length === 0 || !all.every(isPlainObject)) {
    return undefined;
  }
  return ELEMENT_IDENTITY_KEYS.find((key) =>
    [oldArr, newArr].every((arr) => {
      const ids = arr.map((item) => (item as Record<string, unknown>)[key]);
      return ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
    }),
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function hiddenNote(count: number, noun: string): string {
  return `# (${plural(count, `unchanged ${noun}`)} hidden)`;
}

/**
 * Render a changed array element by element, so one edit inside a long list
 * reads as one change rather than the whole list removed and added again.
 *
 * - Arrays of named objects (a flow's `steps`, a step's `actions`) are matched
 *   by {@link elementIdentityKey}. A changed element renders as `~ {` with only
 *   what changed in it, plus its name; added and removed elements render
 *   whole; unchanged ones collapse into a `# (N unchanged elements hidden)`
 *   line. An element that moved renders as removed and added.
 * - Arrays of scalars (`fields`, `required`, `scopes`) render every item, with
 *   `+` / `-` on the ones added or removed.
 * - Anything else (objects with no shared identity, nested arrays) falls back
 *   to a whole remove + add.
 */
function renderArrayDiff(
  paddedKey: string,
  oldArr: ReadonlyArray<unknown>,
  newArr: ReadonlyArray<unknown>,
  prefixCol: number,
  tty: boolean,
  lines: string[],
): void {
  const pad = " ".repeat(prefixCol);
  const itemCol = prefixCol + 4;
  const itemPad = " ".repeat(itemCol);
  const closePad = " ".repeat(prefixCol + 2);
  const yellow = (s: string) => paint(s, A.yellow, tty);
  const green = (s: string) => paint(s, A.green, tty);
  const red = (s: string) => paint(s, A.red, tty);
  const identity = elementIdentityKey(oldArr, newArr);

  const withinBudget = oldArr.length * newArr.length <= MAX_LCS_CELLS;

  if (identity !== undefined && withinBudget) {
    const idOf = (item: unknown) => (item as Record<string, string>)[identity] as string;
    const oldById = new Map(oldArr.map((item) => [idOf(item), item]));
    const newById = new Map(newArr.map((item) => [idOf(item), item]));

    lines.push(yellow(`${pad}~ ${paddedKey} = [`));
    let hidden = 0;
    const flushHidden = () => {
      if (hidden > 0) {
        lines.push(`${itemPad}  ${hiddenNote(hidden, "element")}`);
        hidden = 0;
      }
    };
    for (const op of lcsDiff(oldArr.map(idOf), newArr.map(idOf))) {
      const before = oldById.get(op.line) as Record<string, unknown>;
      const after = newById.get(op.line) as Record<string, unknown>;
      if (op.kind === "same" && sameValue(before, after)) {
        hidden += 1;
        continue;
      }
      flushHidden();
      if (op.kind === "same") {
        lines.push(yellow(`${itemPad}~ {`));
        renderDiff(before, after, itemCol + 4, tty, lines, { compact: true, identity });
        lines.push(yellow(`${" ".repeat(itemCol + 2)}},`));
      } else {
        const removed = op.kind === "del";
        renderArrayItems(
          [removed ? before : after],
          removed ? "-" : "+",
          itemCol,
          { tty, deleteMode: false },
          lines,
        );
      }
    }
    flushHidden();
    lines.push(yellow(`${closePad}]`));
    return;
  }

  if (withinBudget && [...oldArr, ...newArr].every(isPrimitive)) {
    const label = (item: unknown) => fmtScalar(item as string | number | boolean | null);
    lines.push(yellow(`${pad}~ ${paddedKey} = [`));
    for (const op of lcsDiff(oldArr.map(label), newArr.map(label))) {
      if (op.kind === "same") {
        lines.push(`${itemPad}  ${op.line},`);
      } else if (op.kind === "add") {
        lines.push(green(`${itemPad}+ ${op.line},`));
      } else {
        lines.push(red(`${itemPad}- ${op.line},`));
      }
    }
    lines.push(yellow(`${closePad}]`));
    return;
  }

  if (oldArr.length === 0) {
    lines.push(red(`${pad}- ${paddedKey} = []`));
  } else {
    lines.push(red(`${pad}- ${paddedKey} = [`));
    renderArrayItems(oldArr, "-", itemCol, { tty, deleteMode: false }, lines);
    lines.push(red(`${closePad}]`));
  }
  if (newArr.length === 0) {
    lines.push(green(`${pad}+ ${paddedKey} = []`));
  } else {
    lines.push(green(`${pad}+ ${paddedKey} = [`));
    renderArrayItems(newArr, "+", itemCol, { tty, deleteMode: false }, lines);
    lines.push(green(`${closePad}]`));
  }
}

/**
 * How {@link renderDiff} renders what did not change.
 *
 * `compact` hides unchanged attributes behind one `# (N unchanged attributes
 * hidden)` line, for the inside of a changed array element: there the point is
 * which element changed and how, and its untouched rest is noise. `identity`
 * names the attribute that is shown anyway, so the element can be recognised.
 */
type DiffOptions = { compact?: boolean; identity?: string };

/**
 * Walks both old and new objects, emitting Terraform-style change lines.
 * Returns true if any actual change line (+ / - / ~) was emitted.
 *
 * Edge cases:
 * - Changed arrays render element by element ({@link renderArrayDiff}).
 * - An unchanged array that holds objects collapses to a hidden-elements
 *   line: a flow's whole `steps` list is not context for a top-level edit.
 * - Nested objects recurse, and the outer key is only marked `~` if a child
 *   actually changed; unchanged children render with the neutral prefix.
 * - A value whose type changed (e.g. string → object) also renders as a
 *   remove + add pair.
 */
function renderDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefixCol: number,
  tty: boolean,
  lines: string[],
  options: DiffOptions = {},
): boolean {
  const allKeys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].sort();
  const unchanged = (key: string) =>
    Object.hasOwn(oldObj, key) && Object.hasOwn(newObj, key) && sameValue(oldObj[key], newObj[key]);
  const shown = options.compact
    ? allKeys.filter((key) => key === options.identity || !unchanged(key))
    : allKeys;
  const maxLen = shown.reduce((m, k) => Math.max(m, fieldLabel(k).length), 0);
  const pad = " ".repeat(prefixCol);
  let hasChanges = false;

  for (const key of shown) {
    const pk = fieldLabel(key).padEnd(maxLen);
    const hasOld = Object.hasOwn(oldObj, key);
    const hasNew = Object.hasOwn(newObj, key);
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!hasOld) {
      hasChanges = true;
      const col = (s: string) => paint(s, A.green, tty);
      if (isPrimitive(newVal)) {
        lines.push(col(`${pad}+ ${pk} = ${fmtScalar(newVal)}`));
      } else if (Array.isArray(newVal)) {
        lines.push(col(`${pad}+ ${pk} = [`));
        renderArrayItems(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}]`));
      } else if (isPlainObject(newVal)) {
        lines.push(col(`${pad}+ ${pk} = {`));
        renderFields(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}}`));
      }
    } else if (!hasNew) {
      hasChanges = true;
      const col = (s: string) => paint(s, A.red, tty);
      if (isPrimitive(oldVal)) {
        lines.push(col(`${pad}- ${pk} = ${fmtScalar(oldVal)} -> null`));
      } else if (Array.isArray(oldVal)) {
        lines.push(col(`${pad}- ${pk} = [`));
        renderArrayItems(oldVal, "-", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}]`));
      } else if (isPlainObject(oldVal)) {
        lines.push(col(`${pad}- ${pk} = {`));
        renderFields(oldVal, "-", prefixCol + 4, { tty, deleteMode: true }, lines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}}`));
      }
    } else if (isPrimitive(oldVal) && isPrimitive(newVal)) {
      if (oldVal === newVal) {
        lines.push(
          isBlockString(newVal)
            ? `${pad}  ${pk} = ${unchangedBlockSummary(newVal)}`
            : `${pad}  ${pk} = ${fmtPrimitive(newVal)}`,
        );
      } else if (isBlockString(oldVal) || isBlockString(newVal)) {
        hasChanges = true;
        renderBlockStringDiff(pk, oldVal, newVal, prefixCol, tty, lines);
      } else {
        hasChanges = true;
        const col = (s: string) => paint(s, A.yellow, tty);
        lines.push(col(`${pad}~ ${pk} = ${fmtPrimitive(oldVal)} -> ${fmtPrimitive(newVal)}`));
      }
    } else if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      // Key-order-insensitive equality: the server echoes objects in its own
      // field order while local files are stably sorted — that difference is
      // not a change.
      if (sameValue(oldVal, newVal)) {
        if (newVal.length === 0) {
          lines.push(`${pad}  ${pk} = []`);
        } else if (newVal.every(isPrimitive)) {
          lines.push(`${pad}  ${pk} = [`);
          renderArrayItems(newVal, " ", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        } else {
          lines.push(`${pad}  ${pk} = [`);
          lines.push(`${" ".repeat(prefixCol + 4)}  ${hiddenNote(newVal.length, "element")}`);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        }
      } else {
        hasChanges = true;
        renderArrayDiff(pk, oldVal, newVal, prefixCol, tty, lines);
      }
    } else if (isPlainObject(oldVal) && isPlainObject(newVal)) {
      const childLines: string[] = [];
      const childHasChanges = renderDiff(
        oldVal,
        newVal,
        prefixCol + 4,
        tty,
        childLines,
        options.compact ? { compact: true } : {},
      );
      if (childHasChanges) {
        hasChanges = true;
        const col = (s: string) => paint(s, A.yellow, tty);
        lines.push(col(`${pad}~ ${pk} = {`));
        lines.push(...childLines);
        lines.push(col(`${" ".repeat(prefixCol + 2)}}`));
      } else if (childLines.length > 0) {
        lines.push(`${pad}  ${pk} = {`);
        lines.push(...childLines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      } else {
        lines.push(`${pad}  ${pk} = {}`);
      }
    } else {
      hasChanges = true;
      const colR = (s: string) => paint(s, A.red, tty);
      const colA = (s: string) => paint(s, A.green, tty);
      if (isPrimitive(oldVal)) {
        lines.push(colR(`${pad}- ${pk} = ${fmtScalar(oldVal)} -> null`));
      }
      if (isPrimitive(newVal)) {
        lines.push(colA(`${pad}+ ${pk} = ${fmtScalar(newVal)}`));
      }
    }
  }

  const hidden = allKeys.length - shown.length;
  if (hidden > 0) {
    lines.push(`${pad}  ${hiddenNote(hidden, "attribute")}`);
  }
  return hasChanges;
}

/**
 * Column layout (matches Terraform's per-block format):
 *   BLOCK_COL = 2   — where the +/-/~ sits on the resource opening line
 *   FIELD_COL = 6   — where the +/-/~ sits on first-level field lines
 *   closing }      — at BLOCK_COL + 2 = 4, no prefix
 */
const BLOCK_COL = 2;
const FIELD_COL = 6;

function resourceName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Diff both sides in the syncer's canonical form so server-echoed noise
 * (empty `audience`, spelled-out meta-schema defaults) never renders as a
 * change the author didn't make. Rendering only — upload payloads stay raw.
 */
function normalized(
  syncer: Pick<ResourceSyncer, "normalize">,
  content: object,
): Record<string, unknown> {
  return (syncer.normalize?.(content) ?? content) as Record<string, unknown>;
}

/**
 * Renders one Terraform-style resource block for a single `SyncAction`.
 *
 * Per-case notes:
 * - **create**: a synthetic `id = (known after apply)` is injected into the
 *   rendered fields so it sorts alphabetically alongside the real keys.
 * - **delete**: when `oldContent` is null (the fetch failed), the body
 *   collapses to a single `- id = "<id>" -> null` line.
 * - **update**: when `oldContent` is null (no read endpoint for this
 *   resource kind), the field diff is replaced with a placeholder
 *   "field diff unavailable" line.
 * - **skip**: omitted from the output entirely, matching Terraform's
 *   default of not showing no-change resources.
 */
function renderBlock(action: SyncAction, tty: boolean): string[] {
  const lines: string[] = [];
  const blkPad = " ".repeat(BLOCK_COL);
  const closePad = " ".repeat(BLOCK_COL + 2);

  switch (action.kind) {
    case "create": {
      if (action.movedFrom !== undefined && action.oldContent !== undefined) {
        // The platform already holds the resource, so show what changes in it
        // the way an update does, under a header that says where it came from.
        const [, ...diff] = renderBlock(
          {
            kind: "update",
            path: action.path,
            syncer: action.syncer,
            id: "",
            content: action.content,
            hash: action.hash,
            oldContent: action.oldContent,
            ...(action.warnings ? { warnings: action.warnings } : {}),
          },
          tty,
        );
        return [
          paint(
            `${blkPad}# ${action.path} will take over the ${action.syncer.kind} that was in ${action.movedFrom}`,
            A.bold,
            tty,
          ),
          ...diff,
        ];
      }
      const header =
        action.movedFrom === undefined
          ? `${blkPad}# ${action.path} will be created`
          : `${blkPad}# ${action.path} will take over the ${action.syncer.kind} that was in ${action.movedFrom}`;
      const opening = `${blkPad}+ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.green, tty));

      const display: Record<string, unknown> = {
        id: KNOWN_AFTER_APPLY,
        ...(action.content as Record<string, unknown>),
      };
      if (action.repin) {
        // The executor POSTs this flow with the new revision id, not the
        // stale pin still in the file — render what will actually be sent.
        display.user_schema = action.repin.newId ?? KNOWN_AFTER_APPLY;
      }
      renderFields(display, "+", FIELD_COL, { tty, deleteMode: false }, lines);
      lines.push(`${closePad}}`);
      renderWarnings(action.warnings, blkPad, tty, lines);
      break;
    }

    case "delete": {
      const header = `${blkPad}# ${action.path} will be destroyed`;
      const opening = `${blkPad}- resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.red, tty));

      if (action.oldContent) {
        const display: Record<string, unknown> = {
          id: action.id,
          ...(action.oldContent as Record<string, unknown>),
        };
        renderFields(display, "-", FIELD_COL, { tty, deleteMode: true }, lines);
      } else {
        lines.push(paint(`${" ".repeat(FIELD_COL)}- id = "${action.id}" -> null`, A.red, tty));
      }
      lines.push(`${closePad}}`);
      break;
    }

    case "update": {
      const headerSuffix = action.repin ? " (re-pin user_schema)" : "";
      const header = `${blkPad}# ${action.path} will be updated in-place${headerSuffix}`;
      const opening = `${blkPad}~ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.yellow, tty));

      // A repin update ships with `user_schema` rewritten to the revision id
      // the revise mints (or already minted, for crash recovery) — render the
      // content the executor will actually PUT.
      const newContent = action.repin
        ? {
            ...normalized(action.syncer, action.content),
            user_schema: action.repin.newId ?? KNOWN_AFTER_APPLY,
          }
        : normalized(action.syncer, action.content);

      if (action.oldContent) {
        renderDiff(normalized(action.syncer, action.oldContent), newContent, FIELD_COL, tty, lines);
      } else if (action.repin) {
        lines.push(
          paint(
            `${" ".repeat(FIELD_COL)}~ user_schema = "${action.repin.previousId}" -> ${action.repin.newId ? `"${action.repin.newId}"` : KNOWN_AFTER_APPLY}`,
            A.yellow,
            tty,
          ),
        );
      } else {
        lines.push(
          `${" ".repeat(FIELD_COL)}  # (field diff unavailable — no read endpoint for ${action.syncer.kind})`,
        );
      }
      lines.push(`${closePad}}`);
      renderWarnings(action.warnings, blkPad, tty, lines);
      break;
    }

    case "revise": {
      const headerSuffix = action.repin ? " (re-pin user_schema)" : "";
      const header = `${blkPad}# ${action.path} will publish a new revision${headerSuffix}`;
      const opening = `${blkPad}~ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.yellow, tty));

      // A repin revision ships with `user_schema` rewritten to the revision
      // id the schema revise mints (or already minted, for crash recovery) —
      // render the content the executor will actually POST.
      const newWithId: Record<string, unknown> = {
        id: KNOWN_AFTER_APPLY,
        ...normalized(action.syncer, action.content),
        ...(action.repin ? { user_schema: action.repin.newId ?? KNOWN_AFTER_APPLY } : {}),
      };
      if (action.oldContent) {
        const oldWithId: Record<string, unknown> = {
          id: action.previousId,
          ...normalized(action.syncer, action.oldContent),
        };
        renderDiff(oldWithId, newWithId, FIELD_COL, tty, lines);
      } else if (action.repin) {
        lines.push(
          paint(
            `${" ".repeat(FIELD_COL)}~ user_schema = "${action.repin.previousId}" -> ${action.repin.newId ? `"${action.repin.newId}"` : KNOWN_AFTER_APPLY}`,
            A.yellow,
            tty,
          ),
        );
      } else {
        lines.push(
          `${" ".repeat(FIELD_COL)}  # (field diff unavailable — no read endpoint for ${action.syncer.kind})`,
        );
      }
      lines.push(`${closePad}}`);
      renderWarnings(action.warnings, blkPad, tty, lines);
      if (action.affectedPaths.length > 0) {
        lines.push(
          paint(
            `${blkPad}# user_schema will be re-pinned to the new revision ${KNOWN_AFTER_APPLY} in:`,
            A.yellow,
            tty,
          ),
        );
        for (const path of action.affectedPaths) {
          lines.push(paint(`${blkPad}#   - ${path}`, A.yellow, tty));
        }
      }
      break;
    }

    case "skip":
      break;
  }

  return lines;
}

/**
 * Emit one yellow `# warning:` comment line per plan-time validation
 * warning, below the action's closing brace (same channel as the revise
 * re-pin announcement). Warnings never block the plan.
 */
function renderWarnings(
  warnings: ReadonlyArray<{ message: string }> | undefined,
  blkPad: string,
  tty: boolean,
  lines: string[],
): void {
  for (const warning of warnings ?? []) {
    lines.push(paint(`${blkPad}# warning: ${warning.message}`, A.yellow, tty));
  }
}
