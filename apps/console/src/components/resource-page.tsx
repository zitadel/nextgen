import { Link, type LinkProps } from "@tanstack/react-router";
import { Button } from "@zitadel/ui-react";
import type { ReactNode } from "react";

/** Page title row with an optional trailing action (e.g. a Create button). */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-zl-text-secondary-gray">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/** A stubbed "create" action (forms land per-resource in a later issue). */
export function CreateButtonStub({ label }: { label: string }) {
  return (
    <Button hierarchy="primary" size="small" disabled leading={<span aria-hidden>+</span>}>
      {label}
    </Button>
  );
}

/** Underlined in-table link to a detail route. */
export function TableLink(props: LinkProps & { children: ReactNode }) {
  return (
    <Link
      {...props}
      className="text-zl-text-primary-white underline underline-offset-2"
    />
  );
}

// Shared table look. Kept as named constants so the (verbose) utility strings
// live in one place and Tailwind's scanner still sees full literals.
const TABLE_WRAP = "overflow-hidden rounded-lg border border-zl-border-default-gray-100";
const TABLE =
  "w-full border-collapse text-sm [&_tbody_tr:last-child_td]:border-0 [&_tbody_tr:last-child_th]:border-0";
const CELL = "border-b border-zl-border-default-gray-100 px-4 py-3 text-left";
const HEAD_CELL = `${CELL} bg-zl-surface-default-primary-gray text-xs font-normal uppercase tracking-wide text-zl-text-secondary-gray`;
const ROW_LABEL = `${CELL} font-normal text-zl-text-secondary-gray`;

export interface Column<TRow> {
  header: string;
  cell: (row: TRow) => ReactNode;
}

/**
 * Minimal token-styled table with a built-in empty state. Loading and error
 * states are handled by the route's pending/error boundaries (Console
 * ADR 0001), so this component only renders the "rows vs empty" decision.
 */
export function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "Nothing here yet.",
}: {
  columns: Column<TRow>[];
  rows: TRow[];
  getRowKey: (row: TRow) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zl-text-secondary-gray">{emptyMessage}</p>;
  }

  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={HEAD_CELL}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.header} className={CELL}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Key/value detail table (label column + value column). */
export function KeyValueTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <th scope="row" className={ROW_LABEL}>
                {key}
              </th>
              <td className={CELL}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
