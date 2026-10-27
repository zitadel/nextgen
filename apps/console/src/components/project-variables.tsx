import { CLI_VARIABLE_SET, CliCommand } from "@/components/cli-hint";
import { DetailSection } from "@/components/detail-page";
import { PANEL_BODY_CELL, PANEL_HEAD_CELL } from "@/components/typography";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { api } from "@/api/zitadel";

type Variables = Awaited<ReturnType<typeof api.getVariables>>;
/** One kind's value: a scalar, or the mark that a secret is held. */
type Value = NonNullable<Variables[string]["primary"]>;

/** Cells past the name are inset 16px; the name sits on the content edge. */
const CELL = `${PANEL_BODY_CELL} h-14 px-4 first:pl-0`;
const HEAD = `${PANEL_HEAD_CELL} h-14 px-4 first:pl-0`;

/**
 * The project's variables and secrets, read-only: one row per name, with the
 * value each kind holds.
 *
 * **Primary and preview are independent.** Nothing falls back between kinds
 * (ADR 069), so a name can hold a value for one and not the other, and the
 * table shows each kind for itself rather than copying one into the other.
 *
 * **A secret is never shown or copied.** The API returns it as `{secret:
 * true}`, so the cell says only that one is configured. A plain value is shown
 * in full, with a copy.
 *
 * **Writing is the CLI's.** The design draws no add, edit or remove, so only
 * the empty state says where a value comes from.
 *
 * **A row's type is per name, not per kind.** `Secret` when every kind held
 * is a secret, `Variable` when none is, and `Mixed` when a name holds a
 * plain value for one kind and a secret for the other, which the API allows.
 */
export function ProjectVariables({ variables }: { variables: Variables }) {
  const rows = toRows(variables);
  return (
    <DetailSection
      title="Variables and Secrets"
      titleId="project-variables"
      className="mt-4"
      role="region"
      aria-labelledby="project-variables"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No variables have been set. Set one with <CliCommand>{CLI_VARIABLE_SET}</CliCommand>.
        </p>
      ) : (
        // Fixed columns in the design's proportions, so a long value widens
        // nothing: it truncates in its cell.
        <Table className="table-fixed text-sm">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className={cn(HEAD, "w-[26%]")}>Name</TableHead>
              <TableHead className={cn(HEAD, "w-[21%]")}>Type</TableHead>
              <TableHead className={cn(HEAD, "w-[21%]")}>Primary</TableHead>
              <TableHead className={HEAD}>Preview</TableHead>
            </TableRow>
          </TableHeader>
          {/* The last row keeps its rule: the design closes the table with one. */}
          <TableBody className="[&_tr:last-child]:border-b">
            {rows.map((row) => (
              <TableRow key={row.name} className="border-border hover:bg-transparent">
                <TableCell className={cn(CELL, "text-foreground")}>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{row.name}</span>
                    <CopyButton
                      value={row.name}
                      label={`Copy ${row.name}`}
                      size="icon-xs"
                      className="size-4 shrink-0"
                    />
                  </span>
                </TableCell>
                <TableCell className={cn(CELL, "text-muted-foreground")}>{row.type}</TableCell>
                <TableCell className={CELL}>
                  <ValueCell name={row.name} kind="primary" value={row.primary} />
                </TableCell>
                <TableCell className={CELL}>
                  <ValueCell name={row.name} kind="preview" value={row.preview} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DetailSection>
  );
}

interface VariableRow {
  name: string;
  /** `Variable`, `Secret`, or `Mixed` when the kinds differ. */
  type: string;
  primary?: Value;
  preview?: Value;
}

/** The names in order, each with what it holds per kind. */
function toRows(variables: Variables): VariableRow[] {
  return Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { primary, preview }]) => ({
      name,
      type: typeOf(primary, preview),
      primary,
      preview,
    }));
}

function typeOf(primary: Value | undefined, preview: Value | undefined): string {
  const held = [primary, preview].filter((value) => value !== undefined);
  const secrets = held.filter(isSecret).length;
  if (secrets === 0) return "Variable";
  return secrets === held.length ? "Secret" : "Mixed";
}

function isSecret(value: Value | undefined): boolean {
  return typeof value === "object" && value !== null && value.secret === true;
}

/**
 * One kind's cell: the value with a copy, `Configured` for a secret, and
 * `Not configured` for a kind holding nothing under the name.
 */
function ValueCell({ name, kind, value }: { name: string; kind: string; value?: Value }) {
  if (value === undefined) {
    return <span className="text-muted-foreground">Not configured</span>;
  }
  if (isSecret(value)) {
    return <span className="text-foreground">Configured</span>;
  }
  const text = String(value);
  return (
    <span className="flex items-center gap-1.5 text-foreground">
      <span className="truncate">{text}</span>
      <CopyButton
        value={text}
        label={`Copy ${name} ${kind} value`}
        size="icon-xs"
        className="size-4 shrink-0"
      />
    </span>
  );
}
