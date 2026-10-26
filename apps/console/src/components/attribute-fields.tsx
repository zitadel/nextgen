import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { PathBreadcrumb } from "@/components/schema-fields-panel";
import { Badge } from "@/components/ui/badge";
import {
  type AttributeRow,
  attributeRows,
  attributesAt,
  capRows,
  countRows,
} from "@/lib/attribute-fields";
import { type UserSchema, resolveSchemaPath } from "@/lib/schema";
import { cn } from "@/lib/utils";

/**
 * How many rows the popover lists before it points to the user's page. Enough
 * for every built-in schema with room to spare (they define one to four
 * properties); a customer schema past it gets a short list and a link rather
 * than a popover taller than the screen.
 */
const ROW_CAP = 12;

/**
 * A user's attributes as a read-only list of labelled values: the Fields tab
 * of the Users list's attributes popover, beside the JSON and YAML of the same
 * document.
 *
 * Each object lists inline one level deep, as a heading over its own rows;
 * anything deeper is a row that opens it, and the breadcrumb walks back up,
 * the way the schema screen's field table drills into a schema
 * (`PathBreadcrumb`). Past `ROW_CAP` rows the list stops and links to the
 * user's page.
 */
export function AttributeFields({
  attributes,
  schema,
  userId,
}: {
  attributes: Record<string, unknown>;
  schema?: UserSchema;
  userId: string;
}) {
  const [path, setPath] = useState<string[]>([]);
  // A path goes stale only if the user changes underneath an open popover;
  // the root beats a list of nothing.
  const node = attributesAt(attributes, path);
  const at = node ? path : [];
  const rows = attributeRows(node ?? attributes, schema && resolveSchemaPath(schema, at));
  const total = countRows(rows);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {at.length > 0 && (
        <PathBreadcrumb path={at} onNavigate={setPath} rootLabel="Fields" label="Attribute path" />
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">No attributes.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs leading-4.5">
          <Rows rows={capRows(rows, ROW_CAP)} onOpen={(rel) => setPath([...at, ...rel])} />
        </dl>
      )}
      {total > ROW_CAP && (
        <Link
          to="/users/$userId"
          params={{ userId }}
          className="text-foreground self-start text-xs underline-offset-2 hover:underline"
        >
          View all {total} fields
        </Link>
      )}
    </div>
  );
}

function Rows({ rows, onOpen }: { rows: AttributeRow[]; onOpen: (path: string[]) => void }) {
  return rows.map((row) => <Row key={row.path.join(".")} row={row} onOpen={onOpen} />);
}

/**
 * One term and its description. A group's description is its own list, on the
 * parent's two columns (`subgrid`) so its labels line up under the parent's,
 * indented.
 */
function Row({ row, onOpen }: { row: AttributeRow; onOpen: (path: string[]) => void }) {
  if (row.kind === "group") {
    return (
      <>
        <dt className="text-foreground col-span-2 mt-1 truncate font-medium first:mt-0">
          {row.label}
        </dt>
        <dd className="col-span-2 grid grid-cols-subgrid">
          <dl className="col-span-2 grid grid-cols-subgrid gap-y-2 [&>dt]:pl-3">
            <Rows rows={row.rows} onOpen={onOpen} />
          </dl>
        </dd>
      </>
    );
  }
  const term = (
    <dt className="text-muted-foreground truncate" title={row.label}>
      {row.label}
    </dt>
  );
  if (row.kind === "drill") {
    return (
      <>
        {term}
        <dd>
          <button
            type="button"
            onClick={() => onOpen(row.path)}
            aria-label={`Open ${row.label}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-0.5 rounded-sm outline-none focus-visible:ring-[3px]"
          >
            {row.count} {row.count === 1 ? "field" : "fields"}
            <ChevronRight aria-hidden strokeWidth={1.5} className="size-3.5" />
          </button>
        </dd>
      </>
    );
  }
  if (row.kind === "list") {
    return (
      <>
        {term}
        <dd className="flex min-w-0 flex-wrap gap-1">
          {row.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a list's items may repeat, and never reorder here
            <Badge key={index} variant="secondary" className="max-w-full truncate font-normal">
              {item}
            </Badge>
          ))}
        </dd>
      </>
    );
  }
  return (
    <>
      {term}
      <dd
        className={cn(
          "min-w-0 break-words",
          row.empty ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {row.value}
      </dd>
    </>
  );
}
