import type { SyncAction } from "./loop.js";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function paint(text: string, code: string, tty: boolean): string {
  return tty ? `${code}${text}${A.reset}` : text;
}

// ─── Value formatting ─────────────────────────────────────────────────────────

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const KNOWN_AFTER_APPLY = "(known after apply)";

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function fmtPrimitive(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "string" && v === KNOWN_AFTER_APPLY) return KNOWN_AFTER_APPLY;
  if (typeof v === "string") return `"${escapeString(v)}"`;
  return String(v);
}

// ─── Field rendering ──────────────────────────────────────────────────────────
//
// Indentation contract (matches Terraform exactly):
//   prefixCol = column index of the +/-/~ character
//   field content starts at prefixCol + 2  (one space gap after prefix)
//   nested object/array content: prefixCol + 4 for the child prefixCol
//   closing } or ]  : prefixCol + 2 columns of plain spaces, no prefix

type ChangePrefix = "+" | "-" | "~" | " ";

function prefixAnsi(p: ChangePrefix): string {
  if (p === "+") return A.green;
  if (p === "-") return A.red;
  if (p === "~") return A.yellow;
  return "";
}

interface RenderCtx {
  tty: boolean;
  deleteMode: boolean; // append " -> null" to leaf primitives
}

// Collect lines into an array; caller joins with "\n".
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
  const maxLen = keys.reduce((m, k) => Math.max(m, k.length), 0);

  for (const key of keys) {
    const val = obj[key];
    const pk = key.padEnd(maxLen);

    if (isPrimitive(val)) {
      const formatted = fmtPrimitive(val);
      const suffix = ctx.deleteMode ? " -> null" : "";
      lines.push(col(`${pad}${prefix} ${pk} = ${formatted}${suffix}`));
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(col(`${pad}${prefix} ${pk} = []`));
      } else {
        lines.push(col(`${pad}${prefix} ${pk} = [`));
        renderArrayItems(val, prefix, prefixCol + 4, ctx, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}]`);
      }
    } else if (isPlainObject(val)) {
      if (Object.keys(val).length === 0) {
        lines.push(col(`${pad}${prefix} ${pk} = {}`));
      } else {
        lines.push(col(`${pad}${prefix} ${pk} = {`));
        renderFields(val, prefix, prefixCol + 4, ctx, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      }
    }
  }
}

function renderArrayItems(
  arr: unknown[],
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
      const formatted = fmtPrimitive(item);
      // Terraform never appends " -> null" to array elements — only to object
      // field removals. Strip deleteMode here regardless of context.
      lines.push(col(`${pad}${prefix} ${formatted},`));
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(col(`${pad}${prefix} [],`));
      } else {
        lines.push(col(`${pad}${prefix} [`));
        renderArrayItems(item, prefix, prefixCol + 4, ctx, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}],`);
      }
    } else if (isPlainObject(item)) {
      if (Object.keys(item).length === 0) {
        lines.push(col(`${pad}${prefix} {},`));
      } else {
        lines.push(col(`${pad}${prefix} {`));
        renderFields(item, prefix, prefixCol + 4, ctx, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}},`);
      }
    }
  }
}

// ─── Update diff ──────────────────────────────────────────────────────────────
//
// Walk both old and new objects. Per-field:
//   unchanged  →  " " prefix, show current value
//   changed    →  "~" prefix, show old -> new
//   added      →  "+" prefix
//   removed    →  "-" prefix

// Returns true if any actual change line (+ / - / ~) was emitted.
function renderDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefixCol: number,
  tty: boolean,
  lines: string[],
): boolean {
  const allKeys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].sort();
  const maxLen = allKeys.reduce((m, k) => Math.max(m, k.length), 0);
  const pad = " ".repeat(prefixCol);
  let hasChanges = false;

  for (const key of allKeys) {
    const pk = key.padEnd(maxLen);
    const hasOld = Object.prototype.hasOwnProperty.call(oldObj, key);
    const hasNew = Object.prototype.hasOwnProperty.call(newObj, key);
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!hasOld) {
      // Added
      hasChanges = true;
      const col = (s: string) => paint(s, A.green, tty);
      if (isPrimitive(newVal)) {
        lines.push(col(`${pad}+ ${pk} = ${fmtPrimitive(newVal)}`));
      } else if (Array.isArray(newVal)) {
        lines.push(col(`${pad}+ ${pk} = [`));
        renderArrayItems(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}]`);
      } else if (isPlainObject(newVal)) {
        lines.push(col(`${pad}+ ${pk} = {`));
        renderFields(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      }
    } else if (!hasNew) {
      // Removed
      hasChanges = true;
      const col = (s: string) => paint(s, A.red, tty);
      if (isPrimitive(oldVal)) {
        lines.push(col(`${pad}- ${pk} = ${fmtPrimitive(oldVal)} -> null`));
      } else if (Array.isArray(oldVal)) {
        lines.push(col(`${pad}- ${pk} = [`));
        // Array items never get " -> null" — only scalar object fields do
        renderArrayItems(oldVal, "-", prefixCol + 4, { tty, deleteMode: false }, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}]`);
      } else if (isPlainObject(oldVal)) {
        lines.push(col(`${pad}- ${pk} = {`));
        renderFields(oldVal, "-", prefixCol + 4, { tty, deleteMode: true }, lines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      }
    } else if (isPrimitive(oldVal) && isPrimitive(newVal)) {
      if (oldVal === newVal) {
        // Unchanged primitive
        lines.push(`${pad}  ${pk} = ${fmtPrimitive(newVal)}`);
      } else {
        // Changed primitive
        hasChanges = true;
        const col = (s: string) => paint(s, A.yellow, tty);
        lines.push(col(`${pad}~ ${pk} = ${fmtPrimitive(oldVal)} -> ${fmtPrimitive(newVal)}`));
      }
    } else if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) {
        // Deeply equal — show as unchanged for context, no diff noise
        if (newVal.length === 0) {
          lines.push(`${pad}  ${pk} = []`);
        } else {
          lines.push(`${pad}  ${pk} = [`);
          renderArrayItems(newVal, " ", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        }
      } else {
        // Changed — show full remove then full add (LCS diff is out of scope)
        hasChanges = true;
        const colR = (s: string) => paint(s, A.red, tty);
        const colA = (s: string) => paint(s, A.green, tty);
        if (oldVal.length === 0) {
          lines.push(colR(`${pad}- ${pk} = []`));
        } else {
          lines.push(colR(`${pad}- ${pk} = [`));
          renderArrayItems(oldVal, "-", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        }
        if (newVal.length === 0) {
          lines.push(colA(`${pad}+ ${pk} = []`));
        } else {
          lines.push(colA(`${pad}+ ${pk} = [`));
          renderArrayItems(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        }
      }
    } else if (isPlainObject(oldVal) && isPlainObject(newVal)) {
      // Recurse into nested object diff; only mark as ~ if a child actually changed
      const childLines: string[] = [];
      const childHasChanges = renderDiff(oldVal, newVal, prefixCol + 4, tty, childLines);
      if (childHasChanges) {
        hasChanges = true;
        const col = (s: string) => paint(s, A.yellow, tty);
        lines.push(col(`${pad}~ ${pk} = {`));
        lines.push(...childLines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      } else if (childLines.length > 0) {
        lines.push(`${pad}  ${pk} = {`);
        lines.push(...childLines);
        lines.push(`${" ".repeat(prefixCol + 2)}}`);
      } else {
        lines.push(`${pad}  ${pk} = {}`);
      }
    } else {
      // Type changed (e.g. string → object) — show as remove + add
      hasChanges = true;
      const colR = (s: string) => paint(s, A.red, tty);
      const colA = (s: string) => paint(s, A.green, tty);
      if (isPrimitive(oldVal)) {
        lines.push(colR(`${pad}- ${pk} = ${fmtPrimitive(oldVal)} -> null`));
      }
      if (isPrimitive(newVal)) {
        lines.push(colA(`${pad}+ ${pk} = ${fmtPrimitive(newVal)}`));
      }
    }
  }

  return hasChanges;
}

// ─── Block rendering ──────────────────────────────────────────────────────────
//
// Matches Terraform's per-block layout:
//
//   # path/to/file.json will be created
//   + resource "kind" "filename" {
//       + field = value
//     }
//
// Column layout:
//   BLOCK_COL = 2   (where the +/-/~ sits on the resource opening line)
//   FIELD_COL = 6   (where the +/-/~ sits on first-level field lines)
//   CLOSE_OFF = 2   (closing } is at block_col + 2 = 4, no prefix)

const BLOCK_COL = 2;
const FIELD_COL = 6;

function resourceName(path: string): string {
  return path.split("/").pop() ?? path;
}

function renderBlock(action: SyncAction, tty: boolean): string[] {
  const lines: string[] = [];
  const blkPad = " ".repeat(BLOCK_COL);
  const closePad = " ".repeat(BLOCK_COL + 2);

  switch (action.kind) {
    case "create": {
      const header = `${blkPad}# ${action.path} will be created`;
      const opening = `${blkPad}+ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.green, tty));

      // Inject id = (known after apply) so it sorts alphabetically with the rest
      const display: Record<string, unknown> = {
        id: KNOWN_AFTER_APPLY,
        ...(action.content as Record<string, unknown>),
      };
      renderFields(display, "+", FIELD_COL, { tty, deleteMode: false }, lines);
      lines.push(`${closePad}}`);
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
        // Couldn't fetch from API — show only the id
        lines.push(paint(`${" ".repeat(FIELD_COL)}- id = "${action.id}" -> null`, A.red, tty));
      }
      lines.push(`${closePad}}`);
      break;
    }

    case "update": {
      const header = `${blkPad}# ${action.path} will be updated in-place`;
      const opening = `${blkPad}~ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.yellow, tty));

      if (action.oldContent) {
        renderDiff(
          action.oldContent as Record<string, unknown>,
          action.content as Record<string, unknown>,
          FIELD_COL,
          tty,
          lines,
        );
      } else {
        // No GET endpoint for this resource type — can't show field diff
        lines.push(
          `${" ".repeat(FIELD_COL)}  # (field diff unavailable — no read endpoint for ${action.syncer.kind})`,
        );
      }
      lines.push(`${closePad}}`);
      break;
    }

    case "skip":
      // Skips are not shown — same as Terraform's default behaviour
      break;
  }

  return lines;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderPlan(actions: SyncAction[], tty: boolean): string {
  const active = actions.filter((a) => a.kind !== "skip");

  if (active.length === 0) {
    return paint(
      "No changes. Your Zitadel configuration matches the current state.",
      A.bold,
      tty,
    );
  }

  const out: string[] = [];
  out.push(paint("Zitadel will perform the following actions:", A.bold, tty));

  for (const action of active) {
    out.push("");
    out.push(...renderBlock(action, tty));
  }

  out.push("");

  const creates = active.filter((a) => a.kind === "create").length;
  const updates = active.filter((a) => a.kind === "update").length;
  const deletes = active.filter((a) => a.kind === "delete").length;

  const parts: string[] = [];
  if (creates > 0) parts.push(`${creates} to add`);
  if (updates > 0) parts.push(`${updates} to change`);
  if (deletes > 0) parts.push(`${deletes} to destroy`);

  out.push(paint(`Plan: ${parts.join(", ")}.`, A.bold, tty));
  return out.join("\n");
}
