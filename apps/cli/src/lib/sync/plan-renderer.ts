import { stableStringify } from "../json";
import type { ResourceSyncer, SyncAction, SyncPlanSummary } from "./types.js";

/**
 * Count the non-`skip` actions in a {@link buildSyncPlan} result. Pure; the
 * single source of truth for the plan counts shared by the `plan` /
 * `apply --dry-run` JSON payload and {@link renderPlan}'s summary line.
 */
export function summarizePlan(actions: ReadonlyArray<SyncAction>): SyncPlanSummary {
  const active = actions.filter((a) => a.kind !== "skip");
  return {
    creates: active.filter((a) => a.kind === "create").length,
    updates: active.filter((a) => a.kind === "update").length,
    revisions: active.filter((a) => a.kind === "revise").length,
    deletes: active.filter((a) => a.kind === "delete").length,
    total: active.length,
  };
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
    if (action.kind !== "create" && action.kind !== "update") {
      continue;
    }
    for (const warning of action.warnings ?? []) {
      out.push({ path: action.path, rule: warning.rule, message: warning.message });
    }
  }
  return out;
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
  action: "create" | "update" | "revision" | "delete";
  file: string;
  id?: string;
  previous_id?: string;
};

/**
 * Enumerate the non-`skip` actions of a {@link buildSyncPlan} result as
 * envelope-ready {@link PlanResourceChange} rows. Pure; the structural
 * counterpart of {@link summarizePlan} — counts and rows always agree.
 */
export function enumeratePlanResources(
  actions: ReadonlyArray<SyncAction>,
): PlanResourceChange[] {
  const out: PlanResourceChange[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "create":
        out.push({ kind: action.syncer.kind, action: "create", file: action.path });
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

  const { creates, updates, revisions, deletes } = summarizePlan(actions);

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
  if (deletes > 0) {
    parts.push(`${deletes} to destroy`);
  }

  out.push(paint(`Plan: ${parts.join(", ")}.`, A.bold, tty));

  const warningCount = active.reduce(
    (count, action) =>
      count +
      ((action.kind === "create" || action.kind === "update") && action.warnings
        ? action.warnings.length
        : 0),
    0,
  );
  if (warningCount > 0) {
    out.push(
      paint(
        `Warnings: ${warningCount} (non-blocking — see the # warning lines above).`,
        A.yellow,
        tty,
      ),
    );
  }

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

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
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
      const formatted = fmtPrimitive(item);
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

/**
 * Walks both old and new objects, emitting Terraform-style change lines.
 * Returns true if any actual change line (+ / - / ~) was emitted.
 *
 * Edge cases:
 * - Changed arrays render as a full remove + full add (no LCS diff).
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
      hasChanges = true;
      const col = (s: string) => paint(s, A.green, tty);
      if (isPrimitive(newVal)) {
        lines.push(col(`${pad}+ ${pk} = ${fmtPrimitive(newVal)}`));
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
        lines.push(col(`${pad}- ${pk} = ${fmtPrimitive(oldVal)} -> null`));
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
        lines.push(`${pad}  ${pk} = ${fmtPrimitive(newVal)}`);
      } else {
        hasChanges = true;
        const col = (s: string) => paint(s, A.yellow, tty);
        lines.push(col(`${pad}~ ${pk} = ${fmtPrimitive(oldVal)} -> ${fmtPrimitive(newVal)}`));
      }
    } else if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      // Key-order-insensitive equality: the server echoes objects in its own
      // field order while local files are stably sorted — that difference is
      // not a change.
      if (stableStringify(oldVal) === stableStringify(newVal)) {
        if (newVal.length === 0) {
          lines.push(`${pad}  ${pk} = []`);
        } else {
          lines.push(`${pad}  ${pk} = [`);
          renderArrayItems(newVal, " ", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(`${" ".repeat(prefixCol + 2)}]`);
        }
      } else {
        hasChanges = true;
        const colR = (s: string) => paint(s, A.red, tty);
        const colA = (s: string) => paint(s, A.green, tty);
        if (oldVal.length === 0) {
          lines.push(colR(`${pad}- ${pk} = []`));
        } else {
          lines.push(colR(`${pad}- ${pk} = [`));
          renderArrayItems(oldVal, "-", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(colR(`${" ".repeat(prefixCol + 2)}]`));
        }
        if (newVal.length === 0) {
          lines.push(colA(`${pad}+ ${pk} = []`));
        } else {
          lines.push(colA(`${pad}+ ${pk} = [`));
          renderArrayItems(newVal, "+", prefixCol + 4, { tty, deleteMode: false }, lines);
          lines.push(colA(`${" ".repeat(prefixCol + 2)}]`));
        }
      }
    } else if (isPlainObject(oldVal) && isPlainObject(newVal)) {
      const childLines: string[] = [];
      const childHasChanges = renderDiff(oldVal, newVal, prefixCol + 4, tty, childLines);
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
        lines.push(colR(`${pad}- ${pk} = ${fmtPrimitive(oldVal)} -> null`));
      }
      if (isPrimitive(newVal)) {
        lines.push(colA(`${pad}+ ${pk} = ${fmtPrimitive(newVal)}`));
      }
    }
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
      const header = `${blkPad}# ${action.path} will be created`;
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
      const header = `${blkPad}# ${action.path} will publish a new revision`;
      const opening = `${blkPad}~ resource "${action.syncer.kind}" "${resourceName(action.path)}" {`;
      lines.push(paint(header, A.bold, tty));
      lines.push(paint(opening, A.yellow, tty));

      if (action.oldContent) {
        const oldWithId: Record<string, unknown> = {
          id: action.previousId,
          ...normalized(action.syncer, action.oldContent),
        };
        const newWithId: Record<string, unknown> = {
          id: KNOWN_AFTER_APPLY,
          ...normalized(action.syncer, action.content),
        };
        renderDiff(oldWithId, newWithId, FIELD_COL, tty, lines);
      } else {
        lines.push(
          `${" ".repeat(FIELD_COL)}  # (field diff unavailable — no read endpoint for ${action.syncer.kind})`,
        );
      }
      lines.push(`${closePad}}`);
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
