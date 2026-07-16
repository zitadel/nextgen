import { consola } from "consola";

import { validateFlowDefinition, type FlowValidationIssue } from "@zitadel/config/validate";

import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import type { ResourceEntry, SyncAction } from "./types.js";

/**
 * Pre-flight semantic validation for every flow this plan uploads,
 * mirroring the server-side `ValidateFlowDefinition` (see
 * `@zitadel/config/validate`). Runs inside `buildSyncPlan`, so `plan`
 * reports the violations the server would only reveal on apply — and
 * `apply` fails before any platform mutation instead of half-applied
 * (a schema revision would otherwise publish before the flow update
 * fails).
 *
 * Only actions that upload a flow (create/update, including repin-forced
 * updates) are validated: an unchanged flow is never re-judged, so a
 * validator behavior change cannot break an already-applied project.
 *
 * Warning-severity issues ANNOTATE the actions in place (`action.warnings`)
 * for plan rendering — `actions` is deliberately typed mutable because the
 * caller (`buildSyncPlan`, which owns the array it just built) expects the
 * annotations. Error-severity issues aggregate into one E_VALIDATION
 * carrying every violation.
 *
 * Escape hatch: setting `ZITADEL_SKIP_FLOW_VALIDATION` skips the check —
 * insurance against a port bug rejecting something the server accepts.
 */
export function validatePlannedFlows(opts: {
  actions: SyncAction[];
  scannedContents: ReadonlyMap<string, object>;
  stateResources: Readonly<Record<string, ResourceEntry>>;
}): void {
  if (process.env.ZITADEL_SKIP_FLOW_VALIDATION) {
    consola.warn("Flow validation skipped (ZITADEL_SKIP_FLOW_VALIDATION is set)");
    return;
  }

  const failures: Array<{ path: string; issue: FlowValidationIssue }> = [];
  let anyRepin = false;

  // The default-swap warning needs plan-wide context: a project's very
  // first flow becoming the default is expected, an additional one
  // silently taking over /login is the footgun.
  const flowCreatePaths = opts.actions
    .filter((a) => a.kind === "create" && a.syncer.kind === "flow")
    .map((a) => a.path);
  const trackedFlowPaths = Object.keys(opts.stateResources).filter((path) =>
    path.startsWith(`${FLOWS_DIR}/`),
  );

  for (const action of opts.actions) {
    if (action.kind !== "create" && action.kind !== "update") {
      continue;
    }
    if (action.syncer.kind !== "flow") {
      continue;
    }

    const issues = validateFlowDefinition(
      action.content,
      resolveSchemaContent(action, opts.scannedContents, opts.stateResources),
    );
    const warnings = issues.filter((issue) => issue.severity === "warning");
    if (warnings.length > 0) {
      action.warnings = warnings.map(({ rule, message }) => ({ rule, message }));
    }
    for (const issue of issues) {
      if (issue.severity === "error") {
        failures.push({ path: action.path, issue });
        anyRepin ||= action.repin !== undefined;
      }
    }

    const swapWarning = defaultSwapWarning(action, flowCreatePaths, trackedFlowPaths);
    if (swapWarning !== undefined) {
      action.warnings = [...(action.warnings ?? []), swapWarning];
    }
  }

  if (failures.length === 0) {
    return;
  }

  const noun = failures.length === 1 ? "issue" : "issues";
  throw new ZitadelError(
    "E_VALIDATION",
    `Flow validation failed (${failures.length} ${noun}):\n` +
      failures.map(({ path, issue }) => `  - ${path}: ${issue.message}`).join("\n"),
    {
      hint:
        "These are the same rules the server enforces on apply. Fix the flow definition(s) and re-run plan." +
        (anyRepin
          ? " A failing flow is adopting an edited schema revision — update its steps[].fields to match the edited schema (or restore the removed/renamed properties)."
          : ""),
      details: {
        issues: failures.map(({ path, issue }) => ({
          path,
          rule: issue.rule,
          message: issue.message,
          ...(issue.step === undefined ? {} : { step: issue.step }),
        })),
      },
    },
  );
}

/**
 * Warn when applying a NEW active, unscoped flow into a project that
 * already has flows: the engine's default selection is newest-unscoped-
 * wins (ties broken by id), so this flow silently becomes what
 * `<zitadel-login>` renders for its purposes unless the widget pins a
 * `flow-name`. Deliberately engine-level rather than a validator rule:
 * the verdict depends on the action kind and the rest of the plan/state,
 * which `validateFlowDefinition` never sees. A project's first flow is
 * exempt — becoming the default is the point of creating it.
 */
function defaultSwapWarning(
  action: Extract<SyncAction, { kind: "create" | "update" }>,
  flowCreatePaths: readonly string[],
  trackedFlowPaths: readonly string[],
): { rule: string; message: string } | undefined {
  if (action.kind !== "create") {
    return undefined; // updates keep their created_at; the default cannot move
  }
  const body = action.content as {
    status?: unknown;
    purposes?: Record<string, unknown>;
    audience?: { team_ids?: unknown[]; app_ids?: unknown[] };
  };
  if (body.status !== "active") {
    return undefined;
  }
  const scoped =
    (body.audience?.team_ids?.length ?? 0) > 0 || (body.audience?.app_ids?.length ?? 0) > 0;
  if (scoped) {
    return undefined;
  }
  const purposes = Object.keys(body.purposes ?? {});
  if (purposes.length === 0) {
    return undefined;
  }
  const otherFlows =
    trackedFlowPaths.filter((path) => path !== action.path).length +
    flowCreatePaths.filter((path) => path !== action.path).length;
  if (otherFlows === 0) {
    return undefined;
  }
  return {
    rule: "warn/default-flow-swap",
    message:
      `once applied, this flow becomes the new default for ${humanList(purposes)}: ` +
      `pages that do not explicitly set flow-name on <zitadel-login> will start rendering it. ` +
      `If that is not intended, scope it with "audience" or set flow-name on the pages that should use it.`,
  };
}

/** ["login", "register"] → "login and register" (Oxford-free prose list). */
function humanList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Locate the local content of the schema a flow's `user_schema` pins.
 * A repin action already names the schema file (the pin is adopting that
 * file's next/new revision); otherwise the pinned id is looked up in
 * state and its file body taken from this scan. Unresolvable refs (e.g.
 * an un-substituted `${USER_SCHEMA_URL}` placeholder or a server-side
 * schema not tracked locally) return undefined — flow-local rules still
 * run, schema-dependent rules are skipped.
 */
function resolveSchemaContent(
  action: Extract<SyncAction, { kind: "create" | "update" }>,
  scannedContents: ReadonlyMap<string, object>,
  stateResources: Readonly<Record<string, ResourceEntry>>,
): object | undefined {
  if (action.repin) {
    return scannedContents.get(action.repin.schemaPath);
  }
  const ref = (action.content as { user_schema?: unknown }).user_schema;
  if (typeof ref !== "string" || ref === "") {
    return undefined;
  }
  for (const [path, entry] of Object.entries(stateResources)) {
    if (entry.id === ref) {
      return scannedContents.get(path);
    }
  }
  consola.debug(`flow validation: no local schema for user_schema ${ref}; flow-local rules only`);
  return undefined;
}
